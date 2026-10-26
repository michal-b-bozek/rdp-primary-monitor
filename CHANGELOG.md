# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- cocogitto inserts each release below this separator (cog bump); keep it. -->
- - -
## [0.1.0] - 2026-10-26

### Added

- Make an RDP client's virtual monitor primary while it is connected (GNOME Desktop Sharing in `extend` mode), as a temporary configuration that leaves `~/.config/monitors.xml` untouched.
- Move normal application windows onto the client's monitor at connect, keeping their maximized, fullscreen and minimized state.
- Put each moved window back on its monitor, in its position, size and state, when the client disconnects, if that monitor is still there (also after a dock renamed its connector); windows on the primary monitor get their workspace back too.
- Keep the windows on the client's monitor through a screen lock where the RDP connection survives it; on stock GNOME 49 and 50 the lock ends the RDP session and the windows are put back at unlock.
- Stand aside when another monitor is made primary during a session.
- Preferences to turn off making the monitor primary, moving windows or putting them back, and to move only the current workspace's windows.
- Support for GNOME Shell 49 and 50.

- - -

[Unreleased]: https://github.com/michal-b-bozek/rdp-primary-monitor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/michal-b-bozek/rdp-primary-monitor/releases/tag/v0.1.0
