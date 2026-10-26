// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * Read Mutter's display state and build the temporary configuration that makes
 * one monitor primary. Plain data only: the caller unpacks the D-Bus reply
 * (`recursiveUnpack()`) and packs the result into a `GLib.Variant`.
 */

/** Vendor of the monitor GNOME Desktop Sharing adds for an RDP client (ADR-0002). */
export const REMOTE_VENDOR = 'MetaVendor'

/** Product of the monitor GNOME Desktop Sharing adds for an RDP client (ADR-0002). */
export const REMOTE_PRODUCT = 'Virtual remote monitor'

/**
 * @typedef {object} Monitor
 * @property {string} connector
 * @property {string} vendor
 * @property {string} product
 * @property {string} serial
 * @property {string | null} currentModeId Null while the monitor is off.
 */

/**
 * @typedef {object} LogicalMonitor
 * @property {number} x
 * @property {number} y
 * @property {number} scale
 * @property {number} transform
 * @property {boolean} primary
 * @property {readonly string[]} connectors
 */

/**
 * The parts of a `GetCurrentState` reply the extension uses.
 *
 * @typedef {object} DisplayState
 * @property {number} serial The state serial `ApplyMonitorsConfig` must echo.
 * @property {readonly Monitor[]} monitors
 * @property {readonly LogicalMonitor[]} logicalMonitors
 * @property {number | undefined} layoutMode
 */

/**
 * A matching virtual monitor and the monitor check at which it first
 * appeared.
 *
 * @typedef {object} Arrival
 * @property {string} connector
 * @property {string} serial
 * @property {number} arrivedAt
 */

/**
 * One logical monitor in `ApplyMonitorsConfig`'s `a(iiduba(ssa{sv}))` shape.
 *
 * @typedef {[number, number, number, number, boolean, [string, string, Record<string, never>][]]} ApplyLogicalMonitor
 */

/**
 * Validate an unpacked `GetCurrentState` reply.
 *
 * @param {unknown} reply The reply after `recursiveUnpack()`.
 * @returns {DisplayState} The validated state.
 * @throws {TypeError} When the reply does not have the documented shape.
 */
export function parseDisplayState(reply) {
  const [serial, monitors, logicalMonitors, properties] = tuple(
    reply,
    4,
    'reply',
  )
  const layoutMode = record(properties, 'properties')['layout-mode']
  return {
    serial: number(serial, 'serial'),
    monitors: array(monitors, 'monitors').map((m, i) =>
      parseMonitor(m, `monitors[${String(i)}]`),
    ),
    logicalMonitors: array(logicalMonitors, 'logical monitors').map((lm, i) =>
      parseLogicalMonitor(lm, `logical monitors[${String(i)}]`),
    ),
    layoutMode:
      layoutMode === undefined ? undefined : number(layoutMode, 'layout-mode'),
  }
}

/**
 * List the monitors that belong to a remote client, by vendor and product only.
 *
 * @param {DisplayState} state
 * @returns {Monitor[]} The matching monitors, in the reply's order.
 */
export function findRemoteMonitors(state) {
  return state.monitors.filter(
    (m) => m.vendor === REMOTE_VENDOR && m.product === REMOTE_PRODUCT,
  )
}

/**
 * Pick the session's monitor: among those that appeared at the latest monitor
 * check that added any, the one with the lowest serial (ADR-0002 part 2).
 *
 * @param {readonly Arrival[]} candidates
 * @returns {Arrival | undefined} The chosen monitor, or none for no candidates.
 */
export function chooseSessionMonitor(candidates) {
  const latest = Math.max(...candidates.map((c) => c.arrivedAt))
  return candidates
    .filter((c) => c.arrivedAt === latest)
    .sort(
      (a, b) =>
        serialOrder(a.serial) - serialOrder(b.serial) ||
        a.connector.localeCompare(b.connector),
    )[0]
}

/**
 * Tell whether a monitor is in the primary logical monitor.
 *
 * @param {DisplayState} state
 * @param {string} connector
 * @returns {boolean} True when the monitor is primary.
 */
export function isPrimary(state, connector) {
  return state.logicalMonitors.some(
    (lm) => lm.primary && lm.connectors.includes(connector),
  )
}

/**
 * Build `ApplyMonitorsConfig`'s logical monitors: the current layout with only
 * the logical monitor holding `connector` marked primary (ADR-0003 part 1).
 *
 * @param {DisplayState} state
 * @param {string} connector The session's monitor.
 * @returns {ApplyLogicalMonitor[]} One entry per logical monitor, in order.
 * @throws {Error} When `connector` is in no logical monitor, or a monitor in
 *   the layout has no current mode.
 */
export function buildPrimaryLayout(state, connector) {
  if (!state.logicalMonitors.some((lm) => lm.connectors.includes(connector))) {
    throw new Error(`monitor ${connector} is in no logical monitor`)
  }
  return state.logicalMonitors.map((lm) => [
    lm.x,
    lm.y,
    lm.scale,
    lm.transform,
    lm.connectors.includes(connector),
    lm.connectors.map((c) => [c, currentModeId(state, c), {}]),
  ])
}

/**
 * @param {DisplayState} state
 * @param {string} connector
 * @returns {string} The monitor's current mode id.
 */
function currentModeId(state, connector) {
  const modeId = state.monitors.find(
    (m) => m.connector === connector,
  )?.currentModeId
  if (modeId === undefined || modeId === null) {
    throw new Error(`monitor ${connector} has no current mode`)
  }
  return modeId
}

/**
 * Order serials such as `0x000001` numerically. A serial that is not
 * entirely hexadecimal sorts last, so the choice stays deterministic.
 *
 * @param {string} serial
 * @returns {number} The sort key.
 */
function serialOrder(serial) {
  return /^(?:0x)?[0-9a-f]+$/i.test(serial)
    ? Number.parseInt(serial, 16)
    : Number.POSITIVE_INFINITY
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {Monitor} The monitor.
 */
function parseMonitor(value, where) {
  const [spec, modes] = tuple(value, 3, where)
  const [connector, vendor, product, serial] = tuple(spec, 4, `${where}.spec`)
  const parsedModes = array(modes, `${where}.modes`).map((mode, i) =>
    tuple(mode, 7, `${where}.modes[${String(i)}]`),
  )
  const current = parsedModes.find(
    (mode, i) =>
      record(mode[6], `${where}.modes[${String(i)}].properties`)[
        'is-current'
      ] === true,
  )
  return {
    connector: string(connector, `${where}.connector`),
    vendor: string(vendor, `${where}.vendor`),
    product: string(product, `${where}.product`),
    serial: string(serial, `${where}.serial`),
    currentModeId:
      current === undefined ? null : string(current[0], `${where}.mode id`),
  }
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {LogicalMonitor} The logical monitor.
 */
function parseLogicalMonitor(value, where) {
  const [x, y, scale, transform, primary, specs] = tuple(value, 7, where)
  if (typeof primary !== 'boolean') {
    throw new TypeError(`${where}.primary: expected a boolean`)
  }
  return {
    x: number(x, `${where}.x`),
    y: number(y, `${where}.y`),
    scale: number(scale, `${where}.scale`),
    transform: number(transform, `${where}.transform`),
    primary,
    connectors: array(specs, `${where}.monitors`).map((spec, i) =>
      string(
        tuple(spec, 4, `${where}.monitors[${String(i)}]`)[0],
        `${where}.monitors[${String(i)}].connector`,
      ),
    ),
  }
}

/**
 * @param {unknown} value
 * @param {number} length
 * @param {string} where Path of the value in the reply, for the error message.
 * @returns {unknown[]} The value as an array of exactly `length` items.
 */
function tuple(value, length, where) {
  const items = array(value, where)
  if (items.length !== length) {
    throw new TypeError(
      `${where}: expected ${String(length)} items, got ${String(items.length)}`,
    )
  }
  return items
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {unknown[]} The value as an array.
 */
function array(value, where) {
  if (!Array.isArray(value)) throw new TypeError(`${where}: expected an array`)
  return value
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {Record<string, unknown>} The value as a plain object.
 */
function record(value, where) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${where}: expected an object`)
  }
  // reason: checked to be a non-null, non-array object above; TypeScript does
  // not widen `object` to an index signature.
  return /** @type {Record<string, unknown>} */ (value)
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {number} The value as a number.
 */
function number(value, where) {
  if (typeof value !== 'number')
    throw new TypeError(`${where}: expected a number`)
  return value
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {string} The value as a string.
 */
function string(value, where) {
  if (typeof value !== 'string')
    throw new TypeError(`${where}: expected a string`)
  return value
}
