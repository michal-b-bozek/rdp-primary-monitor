# RDP Primary Monitor

A GNOME Shell extension for a multi-monitor workstation used remotely through GNOME Desktop
Sharing. While an RDP client is connected in `extend` mode, it makes the client's virtual monitor
primary and moves normal application windows onto it. When the client disconnects, it puts each
moved window back.

## Why

In `extend` mode the primary monitor stays a physical one, so the top bar, the Alt+Tab switcher,
notifications and the open windows stay on screens the remote user cannot see. In my use, making
the virtual monitor primary by hand in Settings → Displays did not persist from one remote session
to the next. GNOME Remote Desktop 50 has no option for it
([requested upstream in 2022](https://gitlab.gnome.org/GNOME/gnome-remote-desktop/-/issues/133)),
and Remote Login gives the client a separate session, not the one running at the workstation.

## Behaviour

- On connect, the virtual monitor becomes primary as a temporary display configuration;
  `~/.config/monitors.xml` is never modified.
- Normal application windows move to it.
- On disconnect, each moved window returns to its original workspace, monitor, position, size and
  maximized, fullscreen or minimized state, if that monitor still exists. Windows opened during the
  session stay where GNOME puts them.
- If the user makes another monitor primary during a session, the extension stands aside until the
  client disconnects.
- With no virtual monitor present, the extension changes nothing.

## About this project

A personal tool, written for my workstation and shared as-is. It is not on extensions.gnome.org,
and I don't plan to submit it there:

- The code was written entirely with an AI coding assistant (Claude Code). I am not a JavaScript
  or GNOME Shell developer, so I could not defend it in an extensions.gnome.org review.
- There is no support or roadmap. It runs daily on my workstation with GNOME Shell 50; CI checks
  it against GNOME Shell 49 and 50.
- You are welcome to use, fork or republish it under the [MIT licence](LICENSE).

## Requirements

- GNOME Shell 49 or 50, Wayland session.
- GNOME Desktop Sharing (RDP) with
  `gsettings set org.gnome.desktop.remote-desktop.rdp screen-share-mode extend`.

## Install

From a clone, with [mise](https://mise.jdx.dev/):

```sh
mise trust mise.toml && mise run ext:install
```

Then log out and in. Without mise, `gnome-extensions pack src --extra-source=lib`, then
`gnome-extensions install` the zip, log out and in, and enable it in the Extensions app.

## Settings

The preferences can turn off making the monitor primary or putting windows back, and limit moving
windows to the current workspace or turn it off. Hidden settings set the timings and turn on debug
lines in the journal; `gsettings` needs the installed schema directory:

```sh
ext=~/.local/share/gnome-shell/extensions/rdp-primary-monitor@michal-b-bozek.github.io
gsettings --schemadir "$ext/schemas" \
  set org.gnome.shell.extensions.rdp-primary-monitor debug-logging true
```

Every key, with its default and range:
[the schema](src/schemas/org.gnome.shell.extensions.rdp-primary-monitor.gschema.xml).

## More

- How it works, state by state: [docs/design.md](docs/design.md); why:
  [architecture decision records](docs/architecture/decisions/).
- Development, tests and test VMs: [docs/development.md](docs/development.md); before a release:
  [manual test protocol](docs/testing.md).
- Changes: [CHANGELOG](CHANGELOG.md).
- Licence: [MIT](LICENSE); every file is [REUSE](https://reuse.software/)-compliant.
