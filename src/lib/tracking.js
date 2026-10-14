// SPDX-License-Identifier: MIT
/**
 * The placement record's link to the Shell: a record whose timers are GLib
 * timeouts and whose read is `gather.js`, and the window signals that feed
 * it. The caller reports monitor bursts and checks, Idle and the lock, as the
 * state machine moves.
 */

import GLib from 'gi://GLib'

import { isNormalWindow, presentMonitors, readWindow } from './gather.js'
import { PlacementRecord } from './placement.js'

/** @import Meta from 'gi://Meta' */

/**
 * The window signals that mean its placement may have changed (docs/design.md,
 * The placement record), plus type and taskbar changes, which can make a
 * window one the record holds or drops. `workspace-changed` also covers
 * sticking and unsticking (Mutter's `set_workspace_state`). `@satisfies`
 * checks the names, except after `notify::`, which the types leave open.
 */
const CHANGE_SIGNALS =
  /** @satisfies {readonly (keyof Meta.Window.SignalSignatures)[]} */ (
    /** @type {const} */ ([
      'position-changed',
      'size-changed',
      'workspace-changed',
      'notify::maximized-horizontally',
      'notify::maximized-vertically',
      'notify::fullscreen',
      'notify::minimized',
      'notify::window-type',
      'notify::skip-taskbar',
    ])
  )

/**
 * Create an empty placement record for the Shell's windows, recording nothing
 * until the caller reports Idle.
 *
 * @param {() => number} settleMs The `settle-ms` setting, read each time a
 *   window's settle timer starts.
 * @returns {PlacementRecord<Meta.Window>} The record.
 */
export function createRecord(settleMs) {
  return new PlacementRecord(
    (window) =>
      isNormalWindow(window) ? readWindow(window, presentMonitors()) : null,
    settleMs,
    {
      add: (ms, callback) =>
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
          callback()
          return GLib.SOURCE_REMOVE
        }),
      remove: (id) => {
        GLib.source_remove(id)
      },
    },
  )
}

/**
 * Feed the record from every window's signals, from new windows and from
 * workspace removals and reorders. Returns the function that disconnects them
 * all, for `disable()`; the record's own timers go with
 * `PlacementRecord.destroy()`.
 *
 * @param {PlacementRecord<Meta.Window>} record
 * @returns {() => void} Disconnect every signal connected here.
 */
export function trackWindows(record) {
  /** @type {Map<Meta.Window, number[]>} */
  const watched = new Map()

  /**
   * @param {Meta.Window} window
   * @returns {void}
   */
  const update = (window) => {
    if (isNormalWindow(window)) record.changed(window)
    else record.removed(window)
  }

  /**
   * @param {Meta.Window} window
   * @returns {void}
   */
  const watch = (window) => {
    // Menus, tooltips and other override-redirect windows are never normal.
    if (watched.has(window) || window.is_override_redirect()) return
    const ids = CHANGE_SIGNALS.map((signal) =>
      window.connect(signal, () => {
        update(window)
      }),
    )
    // Mutter emits `unmanaging` before it tears the window down; the moves it
    // makes while doing so must not reach the record.
    ids.push(
      window.connect('unmanaging', () => {
        unwatch(window)
        record.removed(window)
      }),
    )
    watched.set(window, ids)
    update(window)
  }

  /**
   * @param {Meta.Window} window
   * @returns {void}
   */
  const unwatch = (window) => {
    for (const id of watched.get(window) ?? []) window.disconnect(id)
    watched.delete(window)
  }

  const created = global.display.connect(
    'window-created',
    (_display, window) => {
      watch(window)
    },
  )
  // Removing or reordering workspaces changes the index of the windows on the
  // workspaces that moved, without a signal on the window
  // (meta_workspace_index_changed).
  const reindexed = () => {
    for (const window of watched.keys()) update(window)
  }
  const workspaces = global.workspace_manager
  const workspaceIds = [
    workspaces.connect('workspace-removed', reindexed),
    workspaces.connect('workspaces-reordered', reindexed),
  ]
  for (const window of global.display.list_all_windows()) watch(window)

  return () => {
    global.display.disconnect(created)
    for (const id of workspaceIds) workspaces.disconnect(id)
    for (const window of [...watched.keys()]) unwatch(window)
  }
}
