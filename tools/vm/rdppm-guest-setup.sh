#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# rdppm-guest-setup — runs inside a test VM, never on the host. The kickstart installs it as
# /usr/local/libexec/rdppm-guest-setup with an autostart entry; at tester's first GNOME login it
# turns on Desktop Sharing over RDP (extend mode comes from the system dconf defaults) with
# the credentials vm:build generated, then deletes the credentials file and its autostart
# entry. Diagnostics go to stderr, which the session journal keeps.
set -euo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

readonly CREDENTIALS="${HOME}/.config/rdppm/rdp-credentials"
readonly AUTOSTART="${HOME}/.config/autostart/rdppm-guest-setup.desktop"
readonly TLS_DIR="${HOME}/.local/share/gnome-remote-desktop"

main() {
  if [[ ! -f "${CREDENTIALS}" ]]; then
    printf 'rdppm-guest-setup: no %s, nothing to do\n' "${CREDENTIALS}" >&2
    return 0
  fi
  local user='' password=''
  # A short file fails `read`; the check below reports it.
  {
    IFS= read -r user && IFS= read -r password
  } < "${CREDENTIALS}" || true
  if [[ -z "${user}" || -z "${password}" ]]; then
    printf 'rdppm-guest-setup: malformed %s\n' "${CREDENTIALS}" >&2
    return 65
  fi

  mkdir -p -- "${TLS_DIR}"
  if [[ ! -f "${TLS_DIR}/rdp-tls.crt" ]]; then
    (
      umask 077
      openssl req -x509 -newkey rsa:4096 -nodes -days 3650 -subj '/CN=rdppm-test-vm' \
        -keyout "${TLS_DIR}/rdp-tls.key" -out "${TLS_DIR}/rdp-tls.crt"
    )
  fi

  # gnome-remote-desktop checks the pair after each of these two calls, so the first one logs
  # "RDP server certificate is invalid"; the error is harmless once both are set.
  grdctl rdp set-tls-cert "${TLS_DIR}/rdp-tls.crt"
  grdctl rdp set-tls-key "${TLS_DIR}/rdp-tls.key"
  grdctl rdp set-credentials "${user}" "${password}"
  grdctl rdp disable-view-only
  grdctl rdp enable
  systemctl --user enable --now gnome-remote-desktop.service

  rm -f -- "${CREDENTIALS}" "${AUTOSTART}"
  printf 'rdppm-guest-setup: Desktop Sharing (RDP) enabled for %s\n' "${user}" >&2
}

main "$@"
