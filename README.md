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
- On disconnect, each moved window returns to its original monitor, position, size and
  maximized, fullscreen or minimized state, if that monitor still exists. Windows opened
  during the session stay where GNOME puts them.
- With no virtual monitor present, the extension does nothing.

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
mise run check            # all quality gates
```

`mise tasks` lists every task. Commits follow
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/); `mise run check`
verifies them.

## Project

- **Licence:** MIT; the text is in [LICENSE](LICENSE).
- **Changes:** see [CHANGELOG](CHANGELOG.md).
