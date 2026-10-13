// SPDX-License-Identifier: MIT
/**
 * Window snapshot records and the restore plan (ADR-0004), on plain data. The
 * caller reads `Meta.Window` and `Meta.Display` into these shapes and carries
 * out the returned steps in order.
 */

/** `Meta.MaximizeFlags.BOTH`, as a literal: this module imports nothing from GNOME. */
const MAXIMIZE_BOTH = 3

/**
 * A rectangle in pixels.
 *
 * @typedef {object} Rect
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * How a monitor is found again at restore (ADR-0004 part 3).
 *
 * @typedef {object} MonitorKey
 * @property {string} vendor
 * @property {string} product
 * @property {string} serial
 * @property {string} connector
 */

/**
 * A monitor present now: its key, the index the window API uses, and its
 * geometry in global coordinates.
 *
 * @typedef {MonitorKey & { index: number, geometry: Rect }} PresentMonitor
 */

/**
 * Where a normal window last settled (ADR-0004 part 2).
 *
 * @typedef {object} WindowRecord
 * @property {number | 'all' | 'none'} workspace Index; `'all'` when the
 *   window is on all workspaces of its own accord; `'none'` when it has no
 *   workspace of its own, being on all of them only because it is off the
 *   primary monitor while `workspaces-only-on-primary` is on.
 * @property {MonitorKey} monitor
 * @property {Rect} frame Frame rectangle relative to the monitor's origin.
 * @property {number} maximizeFlags `Meta.MaximizeFlags`; 0 when not maximized.
 * @property {boolean} fullscreen
 * @property {boolean} minimized
 */

/**
 * A window's state now, as far as the restore needs it.
 *
 * @typedef {object} CurrentWindow
 * @property {number | 'all' | 'none'} workspace As in `WindowRecord`.
 * @property {number} maximizeFlags
 * @property {boolean} fullscreen
 * @property {boolean} minimized
 */

/**
 * One call on the window, in the order of ADR-0004 part 4 and its amendments.
 *
 * @typedef {{ kind: 'unmakeFullscreen' }
 *   | { kind: 'stick' }
 *   | { kind: 'unstick' }
 *   | { kind: 'changeWorkspace', workspace: number }
 *   | { kind: 'moveToMonitor', monitor: number }
 *   | { kind: 'unmaximize' }
 *   | { kind: 'maximize', flags: number }
 *   | { kind: 'moveResizeFrame', frame: Rect }
 *   | { kind: 'makeFullscreen' }
 *   | { kind: 'minimize' }
 *   | { kind: 'unminimize' }} RestoreStep
 */

/**
 * Express a frame relative to its monitor's origin.
 *
 * @param {Rect} frame Frame rectangle in global coordinates.
 * @param {Rect} monitor Monitor geometry in global coordinates.
 * @returns {Rect} The frame relative to the monitor.
 */
export function toMonitorFrame(frame, monitor) {
  // Field by field: a spread copies only own properties, and the caller may
  // pass a GJS boxed rectangle (Mtk.Rectangle).
  return {
    x: frame.x - monitor.x,
    y: frame.y - monitor.y,
    width: frame.width,
    height: frame.height,
  }
}

/**
 * Find a window's original monitor among the present ones: the monitor with
 * the stored vendor, product and serial; among several, the one with the
 * stored connector. Null means the monitor is gone (ADR-0004 part 3).
 *
 * @param {MonitorKey} key
 * @param {readonly PresentMonitor[]} present
 * @returns {PresentMonitor | null} The original monitor, or null.
 */
export function findOriginalMonitor(key, present) {
  const candidates = present.filter(
    (m) =>
      m.vendor === key.vendor &&
      m.product === key.product &&
      m.serial === key.serial,
  )
  if (candidates.length === 1) return candidates[0] ?? null
  return candidates.find((m) => m.connector === key.connector) ?? null
}

/**
 * Plan the restore of one gathered window. Returns null when its original
 * monitor is gone: the window is then left as it is (ADR-0004 part 4).
 *
 * @param {WindowRecord} record The window's snapshot.
 * @param {CurrentWindow} current The window's state now.
 * @param {readonly PresentMonitor[]} present The monitors present now.
 * @param {number} workspaceCount Number of workspaces now.
 * @returns {RestoreStep[] | null} The calls to make, in order, or null.
 */
export function planRestore(record, current, present, workspaceCount) {
  const monitor = findOriginalMonitor(record.monitor, present)
  if (monitor === null) return null

  /** @type {RestoreStep[]} */
  const steps = []
  if (current.fullscreen && !record.fullscreen) {
    steps.push({ kind: 'unmakeFullscreen' })
  }
  steps.push({ kind: 'moveToMonitor', monitor: monitor.index })
  // The workspace comes after the monitor: a window that moves onto the
  // primary monitor from another stops being on all workspaces and Mutter puts
  // it on the active one, which would undo an earlier workspace change. A
  // record with no workspace of its own, or whose workspace no longer exists,
  // leaves the window on the workspace it has, or on all of them.
  if (record.workspace === 'all') {
    if (current.workspace !== 'all') steps.push({ kind: 'stick' })
  } else if (record.workspace !== 'none' && record.workspace < workspaceCount) {
    // A window off the primary monitor can have asked to be on all workspaces
    // as well, so 'none' is unstuck like 'all'; unsticking a window that did
    // not ask changes nothing.
    if (current.workspace === 'all' || current.workspace === 'none') {
      steps.push({ kind: 'unstick' })
    }
    if (record.workspace !== current.workspace) {
      steps.push({ kind: 'changeWorkspace', workspace: record.workspace })
    }
  }
  // Unmaximizing returns the window to the rectangle Mutter saved when it was
  // maximized, which can lie on the session's monitor, so only a window
  // maximized in a direction the record lacks is unmaximized; maximizing adds
  // missing directions in place. Such a record is never maximized in both
  // directions, so the frame step below always follows an unmaximize.
  if ((current.maximizeFlags & ~record.maximizeFlags) !== 0) {
    steps.push({ kind: 'unmaximize' })
  }
  // Maximizing in one direction leaves the other where it is, so a window
  // maximized in one direction gets its frame first (ADR-0004 part 4).
  if (record.maximizeFlags !== MAXIMIZE_BOTH) {
    steps.push({
      kind: 'moveResizeFrame',
      frame: {
        x: record.frame.x + monitor.geometry.x,
        y: record.frame.y + monitor.geometry.y,
        width: record.frame.width,
        height: record.frame.height,
      },
    })
  }
  if (record.maximizeFlags !== 0) {
    steps.push({ kind: 'maximize', flags: record.maximizeFlags })
  }
  if (record.fullscreen && !current.fullscreen) {
    steps.push({ kind: 'makeFullscreen' })
  }
  if (record.minimized !== current.minimized) {
    steps.push({ kind: record.minimized ? 'minimize' : 'unminimize' })
  }
  return steps
}
