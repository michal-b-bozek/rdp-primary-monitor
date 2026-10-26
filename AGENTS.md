# RDP Primary Monitor

GNOME Shell extension (`rdp-primary-monitor@michal-b-bozek.github.io`, GNOME Shell 49 and 50, MIT)
that makes a Desktop Sharing RDP client's virtual monitor primary while it is connected. Behaviour:
[README.md](README.md) and [docs/design.md](docs/design.md). Plain ESM JavaScript; Node and pnpm
exist only for lint, format and type-checking.

Ground rules:

- **No host changes without asking.** Running anything in the user's live GNOME session —
  installing or enabling the extension, D-Bus calls that change the display configuration,
  test scripts — needs the user's go-ahead first.
- **Never touch `~/.config/monitors.xml`.** The extension applies temporary configurations only;
  tests must check that it is left untouched.
- **Sanitized fixtures only.** The repo is public: replace monitor serial numbers, hostnames and
  usernames in captured `GetCurrentState` output with neutral placeholders before committing it.
- **Extension review rules apply to all shipped code.** No work at module import time, full
  cleanup in `disable()`, async D-Bus only. ESLint catches import-time work and `*_sync` calls
  in `src/` (its limits are in `eslint.config.js`); `disable()` is checked by review and by hand
  in the test VMs.
- **Every file is REUSE-compliant** (`mise run spdx:check`);
  [docs/development.md](docs/development.md) says which files take the SPDX header and which
  `REUSE.toml` covers.
- **Read the ADR log** (`docs/architecture/decisions/`) before reopening a design question.
