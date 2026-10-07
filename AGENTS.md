# RDP Primary Monitor

GNOME Shell extension (`rdp-primary-monitor@michal-b-bozek.github.io`, GNOME Shell 49 and 50,
MIT). When a GNOME Desktop Sharing RDP client connects in `extend` mode, it makes the
virtual monitor primary as a _temporary_ Mutter configuration and gathers windows onto it; on
disconnect it restores every gathered window to its original monitor and geometry. The extension
ships as plain ESM JavaScript; Node and pnpm exist only for lint, format and type-checking.
Pre-release: the extension code is not written yet.

Ground rules for this repo:

- **No host changes without asking.** Running anything in the user's live GNOME session —
  installing or enabling the extension, D-Bus calls that change the display configuration,
  test scripts — needs the user's go-ahead first.
- **Never touch `~/.config/monitors.xml`.** The extension applies temporary configurations only;
  tests must check that it is left untouched.
- **Sanitized fixtures only.** The repo is meant to go public: replace monitor serial numbers,
  hostnames and usernames in captured `GetCurrentState` output with neutral placeholders before
  committing it.
- **Extension review rules apply to all shipped code.** No work at module import time, full
  cleanup in `disable()`, async D-Bus only, SPDX header
  (`// SPDX-License-Identifier: MIT`) in every source file.
