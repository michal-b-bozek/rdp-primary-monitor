// SPDX-License-Identifier: MIT
/**
 * Mutter's `org.gnome.Mutter.DisplayConfig` over D-Bus: read the display state
 * and make the session's monitor primary with a temporary configuration
 * (ADR-0003). Every call is asynchronous: Mutter serves the interface from the
 * Shell's own process, where the extension also runs, so a synchronous call
 * would block the compositor.
 */

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { buildPrimaryLayout, isPrimary, parseDisplayState } from './monitors.js'

/** @import { DisplayState } from './monitors.js' */
/** @import { ApplyResult } from './state.js' */

const BUS_NAME = 'org.gnome.Mutter.DisplayConfig'
const OBJECT_PATH = '/org/gnome/Mutter/DisplayConfig'
const INTERFACE_NAME = 'org.gnome.Mutter.DisplayConfig'

/** `ApplyMonitorsConfig`'s method: 1 is temporary, never written to monitors.xml. */
const METHOD_TEMPORARY = 1

/**
 * Create the proxy. It loads no properties and connects no signals: the
 * extension learns about monitor changes from the Shell.
 *
 * @param {Gio.Cancellable | null} cancellable
 * @returns {Promise<Gio.DBusProxy>} The proxy.
 */
export function createProxy(cancellable) {
  return new Promise((resolve, reject) => {
    Gio.DBusProxy.new_for_bus(
      Gio.BusType.SESSION,
      Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES |
        Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS,
      null,
      BUS_NAME,
      OBJECT_PATH,
      INTERFACE_NAME,
      cancellable,
      (_source, result) => {
        try {
          resolve(Gio.DBusProxy.new_for_bus_finish(result))
        } catch (error) {
          reject(failure('DisplayConfig proxy', error))
        }
      },
    )
  })
}

/**
 * Read the display state with `GetCurrentState`.
 *
 * @param {Gio.DBusProxy} proxy
 * @param {Gio.Cancellable | null} cancellable
 * @returns {Promise<DisplayState>} The validated state.
 */
export async function readDisplayState(proxy, cancellable) {
  const reply = await call(proxy, 'GetCurrentState', null, cancellable)
  /** @type {unknown} */
  const unpacked = reply.recursiveUnpack()
  return parseDisplayState(unpacked)
}

/**
 * Carry out the state machine's `apply` effect: read the state, then make the
 * monitor on `connector` primary unless it is primary already or `makePrimary`
 * is off.
 *
 * @param {Gio.DBusProxy} proxy
 * @param {string} connector The session's monitor.
 * @param {boolean} makePrimary The `make-primary` setting, as the caller reads
 *   it right before the call.
 * @param {Gio.Cancellable | null} cancellable
 * @returns {Promise<ApplyResult>} How the apply ended.
 * @throws {Error} When cancelled (see `isCancelled`); with Mutter's error as
 *   its cause when Mutter rejects a call, as for a stale serial; or when the
 *   reply is malformed or the monitor is in no logical monitor.
 */
export async function applyPrimary(proxy, connector, makePrimary, cancellable) {
  const state = await readDisplayState(proxy, cancellable)
  if (isPrimary(state, connector)) return 'primaryAlready'
  if (!makePrimary) return 'skipped'
  await call(
    proxy,
    'ApplyMonitorsConfig',
    applyParameters(state, connector),
    cancellable,
  )
  return 'changed'
}

/**
 * `ApplyMonitorsConfig`'s parameters: the state's serial, the temporary
 * method, the layout with `connector` primary and the state's layout mode.
 *
 * @param {DisplayState} state
 * @param {string} connector
 * @returns {GLib.Variant} The parameters tuple.
 */
function applyParameters(state, connector) {
  /** @type {Record<string, GLib.Variant>} */
  const properties = {}
  if (state.layoutMode !== undefined) {
    properties['layout-mode'] = GLib.Variant.new_uint32(state.layoutMode)
  }
  return new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
    state.serial,
    METHOD_TEMPORARY,
    buildPrimaryLayout(state, connector),
    properties,
  ])
}

/**
 * @param {Gio.DBusProxy} proxy
 * @param {string} method
 * @param {GLib.Variant | null} parameters
 * @param {Gio.Cancellable | null} cancellable
 * @returns {Promise<GLib.Variant>} The reply.
 */
function call(proxy, method, parameters, cancellable) {
  return new Promise((resolve, reject) => {
    proxy.call(
      method,
      parameters,
      Gio.DBusCallFlags.NONE,
      -1,
      cancellable,
      (_proxy, result) => {
        try {
          resolve(proxy.call_finish(result))
        } catch (error) {
          reject(failure(method, error))
        }
      },
    )
  })
}

/**
 * Tell whether a call failed because it was cancelled, so that the caller can
 * drop it: a cancelled effect reports no event. Cancelling only stops the wait
 * for the reply: an `ApplyMonitorsConfig` already sent may still take effect.
 *
 * @param {unknown} error What a function of this module rejected with.
 * @returns {boolean} True for a cancelled call.
 */
export function isCancelled(error) {
  return (
    error instanceof Error &&
    error.cause instanceof GLib.Error &&
    error.cause.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)
  )
}

/**
 * Wrap what a `_finish` call threw. A `GLib.Error` is not an `Error` in GJS, so
 * it becomes the cause, where `isCancelled` and the log can still read it.
 *
 * @param {string} what The call that failed.
 * @param {unknown} error
 * @returns {Error} The error to reject with.
 */
function failure(what, error) {
  const message =
    error instanceof GLib.Error || error instanceof Error
      ? error.message
      : String(error)
  return new Error(`${what}: ${message}`, { cause: error })
}
