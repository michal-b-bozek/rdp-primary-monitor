// SPDX-License-Identifier: MIT
/**
 * The window side of a session, on `Meta.Window`: read normal windows into
 * snapshot records, gather them onto the session's monitor and carry out the
 * restore plan (ADR-0004). Every call is synchronous and runs in the Shell.
 */

import Meta from 'gi://Meta'

import { planRestore, toMonitorFrame } from './windows.js'

/**
 * @import { CurrentWindow, PresentMonitor, RestoreStep, WindowRecord } from './windows.js'
 */

/**
 * The `gather-mode` setting.
 *
 * @typedef {'all-workspaces' | 'current-workspace' | 'off'} GatherMode
 */

/**
 * A window whose move or restore threw; the others still go ahead.
 *
 * @typedef {object} WindowFailure
 * @property {Meta.Window} window
 * @property {unknown} error
 */

/**
 * Tell whether the extension handles a window: a normal window that is not
 * skipped from the taskbar.
 *
 * @param {Meta.Window} window
 * @returns {boolean} True for a normal window.
 */
export function isNormalWindow(window) {
  return (
    window.get_window_type() === Meta.WindowType.NORMAL &&
    !window.is_skip_taskbar()
  )
}

/**
 * List the monitors the window API can place windows on now.
 *
 * @returns {PresentMonitor[]} One entry per present monitor.
 */
export function presentMonitors() {
  const manager = global.backend.get_monitor_manager()
  /** @type {PresentMonitor[]} */
  const present = []
  for (const monitor of manager.get_monitors() ?? []) {
    const connector = monitor.get_connector()
    // -1: the monitor is in no logical monitor (switched off).
    const index = manager.get_monitor_for_connector(connector)
    if (index < 0) continue
    const geometry = global.display.get_monitor_geometry(index)
    present.push({
      vendor: orUnknown(monitor.get_vendor()),
      product: orUnknown(monitor.get_product()),
      serial: orUnknown(monitor.get_serial()),
      connector,
      index,
      geometry: {
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
      },
    })
  }
  return present
}

/**
 * Read where a window is now.
 *
 * @param {Meta.Window} window
 * @param {readonly PresentMonitor[]} present From `presentMonitors()`.
 * @returns {WindowRecord | null} The record, or null for a window that has
 *   closed or is on no present monitor.
 */
export function readWindow(window, present) {
  if (isGone(window)) return null
  const index = window.get_monitor()
  // Mirrored monitors share an index; the record names the first of them.
  const monitor = present.find((m) => m.index === index)
  if (monitor === undefined) return null
  return {
    workspace: workspaceOf(window),
    monitor: {
      vendor: monitor.vendor,
      product: monitor.product,
      serial: monitor.serial,
      connector: monitor.connector,
    },
    frame: toMonitorFrame(window.get_frame_rect(), monitor.geometry),
    maximizeFlags: window.get_maximize_flags(),
    fullscreen: window.is_fullscreen(),
    minimized: window.minimized,
  }
}

/**
 * Read every normal window, as `enable()` and the rebuild of the placement
 * record need.
 *
 * @returns {Map<Meta.Window, WindowRecord>} A record per normal window.
 */
export function readNormalWindows() {
  const present = presentMonitors()
  /** @type {Map<Meta.Window, WindowRecord>} */
  const records = new Map()
  for (const window of global.display.list_all_windows()) {
    if (!isNormalWindow(window)) continue
    const record = readWindow(window, present)
    if (record !== null) records.set(window, record)
  }
  return records
}

/**
 * Move the snapshot's windows onto the session's monitor with
 * `move_to_monitor()`, which keeps each window's workspace and states
 * (ADR-0004 part 2). With `current-workspace`, only windows on the active
 * workspace move, including those on all workspaces. Windows that closed, or
 * are on that monitor already, are not moved. A window whose move throws is
 * reported and the rest still move, so the caller learns every window that
 * did.
 *
 * @param {Iterable<Meta.Window>} windows The snapshot's windows.
 * @param {string} connector The connector of the session's monitor.
 * @param {GatherMode} mode The `gather-mode` setting, read right before the
 *   call.
 * @returns {{ moved: Meta.Window[], failed: WindowFailure[] }} The windows
 *   moved, for the gathered set (none when the monitor is gone or `mode` is
 *   `off`), and those whose move threw.
 */
export function gather(windows, connector, mode) {
  /** @type {Meta.Window[]} */
  const moved = []
  /** @type {WindowFailure[]} */
  const failed = []
  if (mode === 'off') return { moved, failed }
  const target = global.backend
    .get_monitor_manager()
    .get_monitor_for_connector(connector)
  if (target < 0) return { moved, failed }
  const active = global.workspace_manager.get_active_workspace()

  for (const window of windows) {
    try {
      if (isGone(window) || window.get_monitor() === target) continue
      if (
        mode === 'current-workspace' &&
        !window.is_on_all_workspaces() &&
        window.get_workspace() !== active
      ) {
        continue
      }
      window.move_to_monitor(target)
      moved.push(window)
    } catch (error) {
      failed.push({ window, error })
    }
  }
  return { moved, failed }
}

/**
 * Put gathered windows back where their snapshot says (ADR-0004 part 4).
 * Windows that closed are skipped; a window whose original monitor is gone is
 * left as it is and returned, for the caller to log; a window whose restore
 * threw, possibly part-way, is returned too, and the others are still
 * restored.
 *
 * @param {Iterable<readonly [Meta.Window, WindowRecord]>} gathered Each
 *   gathered window with its snapshot record.
 * @returns {{ monitorGone: Meta.Window[], failed: WindowFailure[] }} The
 *   windows whose original monitor is gone, and those whose restore threw.
 */
export function restore(gathered) {
  const present = presentMonitors()
  const workspaceCount = global.workspace_manager.get_n_workspaces()

  /** @type {Meta.Window[]} */
  const monitorGone = []
  /** @type {WindowFailure[]} */
  const failed = []
  for (const [window, record] of gathered) {
    try {
      if (isGone(window)) continue
      /** @satisfies {CurrentWindow} */
      const current = {
        workspace: workspaceOf(window),
        maximizeFlags: window.get_maximize_flags(),
        fullscreen: window.is_fullscreen(),
        minimized: window.minimized,
      }
      const steps = planRestore(record, current, present, workspaceCount)
      if (steps === null) {
        monitorGone.push(window)
        continue
      }
      for (const step of steps) runStep(window, step)
    } catch (error) {
      failed.push({ window, error })
    }
  }
  return { monitorGone, failed }
}

/**
 * @param {Meta.Window} window
 * @param {RestoreStep} step
 * @returns {void}
 */
function runStep(window, step) {
  switch (step.kind) {
    case 'unmakeFullscreen':
      window.unmake_fullscreen()
      break
    case 'stick':
      window.stick()
      break
    case 'unstick':
      window.unstick()
      break
    case 'changeWorkspace':
      window.change_workspace_by_index(step.workspace, false)
      break
    case 'moveToMonitor':
      window.move_to_monitor(step.monitor)
      break
    case 'unmaximize':
      window.unmaximize()
      break
    case 'maximize':
      // In Mutter 49 and 50, maximize() takes no directions and means both;
      // set_maximize_flags() maximizes in the given ones.
      window.set_maximize_flags(maximizeFlags(step.flags))
      break
    case 'moveResizeFrame':
      window.move_resize_frame(
        false,
        step.frame.x,
        step.frame.y,
        step.frame.width,
        step.frame.height,
      )
      break
    case 'makeFullscreen':
      window.make_fullscreen()
      break
    case 'minimize':
      window.minimize()
      break
    case 'unminimize':
      window.unminimize()
      break
    default: {
      /** @type {never} */
      const unhandled = step
      throw new Error(`unknown restore step: ${JSON.stringify(unhandled)}`)
    }
  }
}

/**
 * Turn the record's flags back into the enum: windows.js keeps them as a plain
 * number, read with `get_maximize_flags()`, so that it needs no GNOME import.
 * Flags with no direction throw here: Mutter would abort on its assertion.
 *
 * @param {number} flags Non-zero.
 * @returns {Meta.MaximizeFlags} The same directions.
 */
function maximizeFlags(flags) {
  const horizontal = (flags & Meta.MaximizeFlags.HORIZONTAL) !== 0
  const vertical = (flags & Meta.MaximizeFlags.VERTICAL) !== 0
  if (horizontal && vertical) return Meta.MaximizeFlags.BOTH
  if (horizontal) return Meta.MaximizeFlags.HORIZONTAL
  if (vertical) return Meta.MaximizeFlags.VERTICAL
  throw new Error(`no maximize direction in flags ${String(flags)}`)
}

/**
 * A window that is not on all workspaces loses its workspace only while
 * unmanaging, after it loses its actor (see `isGone`), so one that is not gone
 * has one.
 *
 * @param {Meta.Window} window
 * @returns {number | 'all' | 'none'} The window's workspace index; `'all'`
 *   when it is on all workspaces of its own accord; `'none'` when only because
 *   it is off the primary monitor (see `WindowRecord`).
 */
function workspaceOf(window) {
  if (!window.is_on_all_workspaces()) return window.get_workspace().index()
  // With workspaces-only-on-primary, Mutter puts every window off the primary
  // monitor on all workspaces (should_be_on_all_workspaces in window.c, Mutter
  // 49 and 50) and has no getter for whether the window also asked for it, so
  // such a window counts as having no workspace of its own. Mutter tests for a
  // monitor too: get_monitor() is -1 without one, and is_on_primary_monitor()
  // fails its precondition then.
  if (
    Meta.prefs_get_workspaces_only_on_primary() &&
    window.get_monitor() >= 0 &&
    !window.is_on_primary_monitor()
  ) {
    return 'none'
  }
  return 'all'
}

/**
 * @param {Meta.Window} window
 * @returns {boolean} True for a window that has closed since it was read.
 */
function isGone(window) {
  // reason: typed as never null, but Mutter sets it to NULL while unmanaging
  // the window, right after the `unmanaging` signal
  // (meta_window_actor_queue_destroy); a handler of that signal still sees it.
  /** @type {unknown} */
  const actor = window.get_compositor_private()
  return actor === null
}

/**
 * Mutter's monitor getters return NULL for a monitor without usable EDID
 * data, although typed as strings; DisplayConfig reports `unknown` then, and
 * so does this.
 *
 * @param {string | null} value
 * @returns {string} The value, or `unknown`.
 */
function orUnknown(value) {
  return value ?? 'unknown'
}
