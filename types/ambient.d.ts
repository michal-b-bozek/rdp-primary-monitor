// SPDX-License-Identifier: MIT
// Ambient GJS / GNOME Shell types for `tsc` (dev only, never shipped): `gi://…` and
// `resource:///org/gnome/shell/…` imports, and the GJS globals (`global`, `log`, …).
// Pinned to GNOME Shell 49 (@girs/gnome-shell 49.x) — the oldest supported release.
import '@girs/gjs'
import '@girs/gjs/dom'
import '@girs/gnome-shell/ambient'
import '@girs/gnome-shell/extensions/global'
