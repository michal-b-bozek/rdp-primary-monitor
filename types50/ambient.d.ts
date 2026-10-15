// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
// Ambient GJS / GNOME Shell types for the GNOME Shell 50 tsc run (tsconfig.gnome50.json; dev
// only, never shipped). Pinned to GNOME Shell 50 through the @girs/gnome-shell-50 alias.
// Kept out of types/: one program must never load both ambient files (see tsconfig.gnome50.json).
import '@girs/gjs'
import '@girs/gjs/dom'
import '@girs/gnome-shell-50/ambient'
import '@girs/gnome-shell-50/extensions/global'
