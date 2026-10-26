# Development

[mise](https://mise.jdx.dev/) pins the dev tools and runs every task; `mise tasks` lists them.
Nothing from npm ships in the extension.

```sh
mise trust mise.toml      # once per clone
mise install              # pinned tools
mise run deps:install     # pinned npm dev dependencies
mise run hooks:install    # git hooks: secrets, lint, format, commit messages
mise run check            # every quality gate
```

Some tasks use host tools that mise cannot pin:

| Task                    | Host tool              | Fedora package       |
| ----------------------- | ---------------------- | -------------------- |
| `test`                  | `gjs`, `dbus-daemon`   | `gjs`, `dbus-daemon` |
| `test`, `schemas:check` | `glib-compile-schemas` | `glib2`              |
| `pack`, `ext:install`   | `gnome-extensions`     | `gnome-shell`        |
| `ext:install`           | `gsettings`            | `glib2`              |
| `spdx:check`            | libmagic (for `reuse`) | `file-libs`          |

- **Tests** are `tests/**/*.test.js`, run by `tests/run.js`. The D-Bus tests start a private
  `dbus-daemon` and never touch the session bus.
- **Types:** `typecheck` checks the sources against the GNOME Shell 49 and 50 types in separate
  runs; ESLint's type-aware rules see the 49 types only. An API only one release has goes through
  a JSDoc `Partial<…>` cast and a `typeof` check
  ([ADR-0006](architecture/decisions/0006-plain-javascript-checked-with-typescript.md)).
- **Licence headers:** a new file starts with the `SPDX-FileCopyrightText` and
  `SPDX-License-Identifier` lines. Markdown, plain JSON, generated files and fixtures are covered
  by [REUSE.toml](../REUSE.toml) instead. `reuse` installs only on the platforms named next to its
  pin in `mise.toml`, so `check` passes only there.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/);
  `check` verifies them.
- **Trying a change:** `mise run ext:install`, then log out and in. It replaces the installed
  copy, adds the extension to `enabled-extensions` and stops if user extensions are turned off.

## Test VMs

The `vm:*` tasks build disposable Fedora 43 (GNOME 49) and Fedora 44 (GNOME 50) VMs with Desktop
Sharing in `extend` mode, in the unprivileged libvirt session. They need KVM, with no VirtualBox
VM running, and these Fedora packages: `libvirt-daemon-kvm`, `libvirt-client`, `virt-install`,
`passt`, `openssh-clients`, `openssl` and `freerdp`.

```sh
mise run vm:build f43     # install from the Fedora mirrors; ends powered off
mise run vm:start f43     # boot and wait for Desktop Sharing
mise run vm:connect f43   # RDP client window; the guest gains a virtual monitor
```

Before a release, run the [manual test protocol](testing.md).
