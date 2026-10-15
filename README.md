# RDP Primary Monitor

A GNOME Shell extension for people who work remotely through GNOME Desktop Sharing on a
multi-monitor workstation.

**Status: pre-release.** Nothing is installable yet and no release has been published: the
repository holds the project setup while the extension code is being written.

When an RDP client connects in `extend` mode, the extension will make the client's virtual
monitor the primary one and move normal application windows onto it. When the client
disconnects, it will return each moved window to where it was.

## Why

In Desktop Sharing's `extend` mode, the primary monitor stays a physical one. The top bar, the
Alt+Tab switcher and notifications appear on screens the remote user cannot see, and windows stay
there too. Making the virtual monitor primary by hand in Settings → Displays works, but in our
use the setting has not persisted reliably from one remote session to the next.

## Planned behaviour

- On connect, the virtual monitor (vendor `MetaVendor`, product `Virtual remote monitor`) becomes
  primary as a temporary display configuration. `~/.config/monitors.xml` is never modified.
- Normal application windows move to it, from all workspaces or only the current one.
- On disconnect, each moved window returns to its original workspace, monitor, position, size and
  maximized, fullscreen or minimized state, if that monitor still exists. Windows opened during the
  session stay where GNOME puts them.
- If the user makes another monitor primary during a session, the extension stands aside until the
  client disconnects.
- With no virtual monitor present, the extension changes nothing.
- The preferences can turn off making the monitor primary or putting windows back, and limit moving
  windows to the current workspace or turn it off.

How it works, state by state: [docs/design.md](docs/design.md). The reasons behind it are recorded
in the [architecture decision records](docs/architecture/decisions/).

## Settings

The preferences window shows the three settings above. Hidden settings set the timings and turn on
debug lines in the journal. The schema is installed with the extension, so `gsettings` needs its
directory:

```sh
ext=~/.local/share/gnome-shell/extensions/rdp-primary-monitor@michal-b-bozek.github.io
gsettings --schemadir "$ext/schemas" \
  set org.gnome.shell.extensions.rdp-primary-monitor debug-logging true
```

Every key, with its default and range, is in
[the schema](src/schemas/org.gnome.shell.extensions.rdp-primary-monitor.gschema.xml).

## Requirements

- GNOME Shell 49 or 50, Wayland session.
- GNOME Desktop Sharing (RDP) with
  `gsettings set org.gnome.desktop.remote-desktop.rdp screen-share-mode extend`.

## Development

The dev tools are pinned in `mise.toml` and `package.json`; nothing from npm ships in the
extension.

```sh
mise trust mise.toml      # once per clone
mise install              # pinned tools
mise run deps:install     # pinned npm dev dependencies (before the first check)
mise run hooks:install    # git hooks (lefthook): secrets, lint, format, commit messages
mise run check            # all quality gates
```

`mise run schemas:check` (part of `check`) uses `glib-compile-schemas`, and `mise run pack`, which
writes the extension zip to `build/`, uses `gnome-extensions`; both come from the host (Fedora:
`glib2` and `gnome-shell`), not from mise. `mise run spdx:check` (part of `check`) runs
[`reuse lint`](https://reuse.software/), which needs the host's libmagic (Fedora: `file-libs`). A
new file carries the `SPDX-FileCopyrightText` and `SPDX-License-Identifier` lines at the top,
unless it is Markdown, plain JSON, generated or a fixture, which [REUSE.toml](REUSE.toml) covers
instead (add a path there if none of its patterns matches the file). `reuse` installs only on
the platforms named next to its pin in `mise.toml`, so `mise run check` passes only there.
`mise run typecheck` checks the sources against the GNOME Shell 49 and 50 types in
two separate runs (`typecheck:49`, `typecheck:50`); ESLint's type-aware rules see the 49 types only.
An API that only one of the two releases has is used through a JSDoc cast to a type that declares
it optional (`/** @type {Partial<…>} */ (object)`) and a `typeof` check on it, as
[ADR-0006](docs/architecture/decisions/0006-plain-javascript-checked-with-typescript.md) says.
`mise tasks` lists every task. Commits follow
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/); `mise run check`
verifies them.

### Test VMs

The `vm:*` tasks build disposable Fedora 43 (GNOME 49) and Fedora 44 (GNOME 50) VMs with
Desktop Sharing in `extend` mode, in the unprivileged libvirt session. They need a Linux host
with KVM and these host packages, named as on Fedora, which mise does not manage:
`libvirt-daemon-kvm` (libvirt's QEMU driver and QEMU), `libvirt-client`, `virt-install`,
`passt`, `openssh-clients`, `openssl` and `freerdp`. KVM is unavailable while a VirtualBox VM is
running.

```sh
mise run vm:build f43     # install from the Fedora mirrors; ends powered off
mise run vm:start f43     # boot and wait for Desktop Sharing
mise run vm:connect f43   # RDP client window; the guest gains a virtual monitor
```

## Project

- **Licence:** MIT; the text is in [LICENSE](LICENSE). Every file's licence is declared in the
  [REUSE](https://reuse.software/) format (in its header or in REUSE.toml), and
  [LICENSES/](LICENSES) holds the same text for REUSE tooling.
- **Changes:** see [CHANGELOG](CHANGELOG.md).
