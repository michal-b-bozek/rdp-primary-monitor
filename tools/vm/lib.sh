# shellcheck shell=bash
# SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
# SPDX-License-Identifier: MIT
# Sourced by the vm:* mise tasks. Every helper works on rdppm-* domains only, so other session
# VMs are never touched. Needs a Linux host (libvirt session, passt), GNU coreutils and
# bash >= 4.4.

if [[ -n "${__RDPPM_VM_LIB_SH:-}" ]]; then return 0; fi
readonly __RDPPM_VM_LIB_SH=1

readonly RDPPM_LIBVIRT_URI="qemu:///session"
# The XDG spec says to ignore a relative XDG_STATE_HOME; build and destroy rm -rf below it.
if [[ "${XDG_STATE_HOME:-}" == /* ]]; then
  readonly RDPPM_STATE_ROOT="${XDG_STATE_HOME}/rdp-primary-monitor/vms"
else
  readonly RDPPM_STATE_ROOT="${HOME}/.local/state/rdp-primary-monitor/vms"
fi
# shellcheck disable=SC2034  # read by the sourcing task
readonly RDPPM_RDP_USER="rdppm"

# rdppm_vm_resolve <id> — set the RDPPM_VM_* globals for one test VM.
rdppm_vm_resolve() {
  case "$1" in
    f43)
      RDPPM_VM_RELEASE=43
      RDPPM_VM_OSINFO=fedora43
      RDPPM_VM_RDP_PORT=13349
      RDPPM_VM_SSH_PORT=13249
      ;;
    f44)
      RDPPM_VM_RELEASE=44
      # osinfo-db has no fedora44 entry yet.
      RDPPM_VM_OSINFO=fedora-unknown
      RDPPM_VM_RDP_PORT=13350
      RDPPM_VM_SSH_PORT=13250
      ;;
    *)
      printf 'error: unknown test VM %q (expected f43 or f44)\n' "$1" >&2
      return 2
      ;;
  esac
  RDPPM_VM_NAME="rdppm-$1"
  RDPPM_VM_STATE_DIR="${RDPPM_STATE_ROOT}/${RDPPM_VM_NAME}"
  # The installer boots from this tree and the kickstart installs from it.
  RDPPM_VM_INSTALL_TREE="https://dl.fedoraproject.org/pub/fedora/linux/releases/${RDPPM_VM_RELEASE}/Everything/x86_64/os/"
  # shellcheck disable=SC2034  # read by the sourcing task
  readonly RDPPM_VM_RELEASE RDPPM_VM_OSINFO RDPPM_VM_RDP_PORT RDPPM_VM_SSH_PORT RDPPM_VM_NAME \
    RDPPM_VM_STATE_DIR RDPPM_VM_INSTALL_TREE
}

rdppm_virsh() {
  virsh --quiet --connect "${RDPPM_LIBVIRT_URI}" "$@"
}

# Sets RDPPM_VM_EXISTS. Never read its failure as "not built": build and destroy delete the VM's
# state on that answer. Call it as a plain command under set -e, or pass the status on with
# `|| return`.
rdppm_vm_lookup() {
  local names name
  names="$(rdppm_virsh list --all --name)" || return 70
  RDPPM_VM_EXISTS=false
  while IFS= read -r name; do
    if [[ "${name}" == "${RDPPM_VM_NAME}" ]]; then RDPPM_VM_EXISTS=true; fi
  done <<< "${names}"
}

rdppm_vm_require_exists() {
  rdppm_vm_lookup || return
  if [[ "${RDPPM_VM_EXISTS}" != "true" ]]; then
    printf 'error: %s does not exist; build it with: mise run vm:build %s\n' \
      "${RDPPM_VM_NAME}" "${RDPPM_VM_NAME#rdppm-}" >&2
    return 66
  fi
}

rdppm_vm_state() {
  rdppm_virsh domstate "${RDPPM_VM_NAME}" || return 70
}

rdppm_vm_is_off() {
  local state
  state="$(rdppm_vm_state)" || return 70
  [[ "${state}" == "shut off" ]]
}

# A guest that finished shutting down in the meantime counts as success.
rdppm_vm_force_off() {
  local err
  if err="$(rdppm_virsh destroy "${RDPPM_VM_NAME}" 2>&1 > /dev/null)"; then return 0; fi
  # shellcheck disable=SC2310  # a predicate decides whether the failure matters
  if rdppm_vm_is_off; then return 0; fi
  printf 'error: could not power off %s: %s\n' "${RDPPM_VM_NAME}" "${err}" >&2
  return 75
}

# Without the build's ssh key every ssh probe fails the same way a booting guest does.
rdppm_vm_require_ssh_key() {
  if [[ ! -r "${RDPPM_VM_STATE_DIR}/ssh-key" ]]; then
    printf 'error: no ssh key in %s; rebuild the VM (vm:destroy, then vm:build %s)\n' \
      "${RDPPM_VM_STATE_DIR}" "${RDPPM_VM_NAME#rdppm-}" >&2
    return 66
  fi
}

rdppm_vm_require_running() {
  rdppm_vm_require_exists || return
  local state
  state="$(rdppm_vm_state)" || return 70
  if [[ "${state}" != "running" ]]; then
    printf 'error: %s is %s; start it with: mise run vm:start %s\n' \
      "${RDPPM_VM_NAME}" "${state}" "${RDPPM_VM_NAME#rdppm-}" >&2
    return 69
  fi
}

rdppm_require_cmd() {
  local cmd
  for cmd in "$@"; do
    if ! command -v "${cmd}" > /dev/null; then
      printf 'error: %s not found on PATH\n' "${cmd}" >&2
      return 127
    fi
  done
}

# The one place the ssh trust settings (the build's key and known_hosts) live.
rdppm_vm_ssh_raw() {
  ssh -p "${RDPPM_VM_SSH_PORT}" -i "${RDPPM_VM_STATE_DIR}/ssh-key" \
    -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
    -o UserKnownHostsFile="${RDPPM_VM_STATE_DIR}/known_hosts" \
    -l tester "$@"
}

# rdppm_vm_ssh <command>... — ssh joins the arguments with spaces for the guest shell, so quote
# for that shell. `--` stops a guest command starting with `-` being read as an ssh option.
rdppm_vm_ssh() {
  rdppm_vm_ssh_raw -o BatchMode=yes -o ConnectTimeout=5 -o ServerAliveInterval=5 \
    -o ServerAliveCountMax=3 -- 127.0.0.1 "$@"
}

# For polling, where failures are expected. Readiness is probed over ssh, never by TCP: passt
# accepts a forwarded connection before the guest listens. -n keeps a probe from reading the
# terminal.
rdppm_vm_ssh_quiet() {
  rdppm_vm_ssh_raw -n -q -o BatchMode=yes -o ConnectTimeout=5 -o ServerAliveInterval=5 \
    -o ServerAliveCountMax=3 -- 127.0.0.1 "$@" 2> /dev/null
}

# rdppm_vm_wait_ssh <timeout-seconds>
rdppm_vm_wait_ssh() {
  local timeout="$1" started="${SECONDS}"
  until rdppm_vm_ssh_quiet true; do
    if ((SECONDS - started >= timeout)); then
      printf 'error: %s not reachable over ssh (127.0.0.1:%s) after %ss\n' \
        "${RDPPM_VM_NAME}" "${RDPPM_VM_SSH_PORT}" "${timeout}" >&2
      # One more attempt with ssh's own error visible (a refused key, for example).
      # shellcheck disable=SC2310  # the probe only shows the error; the status is 69 either way
      rdppm_vm_ssh true || true
      return 69
    fi
    sleep 3
  done
}
