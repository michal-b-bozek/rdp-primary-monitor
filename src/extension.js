// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * The extension's entry point: wires the Shell's monitor and lock signals,
 * Mutter's DisplayConfig and the windows to the session driver
 * (docs/design.md, Lifecycle inside the Shell). Nothing runs at import time.
 */

import Gio from 'gi://Gio'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

import {
  applyPrimary,
  createProxy,
  isCancelled,
  readRemoteMonitors,
} from './lib/display.js'
import { gather, readNormalWindows, restore } from './lib/gather.js'
import { Session } from './lib/session.js'
import { settingsFrom } from './lib/settings.js'
import { createRecord, glibTimers, trackWindows } from './lib/tracking.js'

/**
 * @import Meta from 'gi://Meta'
 * @import { ConsoleLike } from 'resource:///org/gnome/shell/extensions/extension.js'
 * @import { Log, Pending } from './lib/session.js'
 * @import { Settings } from './lib/settings.js'
 */

/**
 * The part of `Main.sessionMode` used here; the Shell types leave it `any`.
 * `isLocked` is true in the `unlock-dialog` mode, which the screen shield
 * pushes when the lock screen comes up and pops at unlock; `updated` follows
 * every mode change (js/ui/sessionMode.js, js/ui/screenShield.js, GNOME Shell
 * 49 and 50).
 *
 * @typedef {object} SessionMode
 * @property {boolean} isLocked
 * @property {(signal: 'updated', callback: () => void) => number} connect
 * @property {(id: number) => void} disconnect
 */

export default class RdpPrimaryMonitor extends Extension {
  /** @type {(() => void) | null} Undo everything `enable()` set up. */
  #teardown = null

  /**
   * @override
   * @returns {void}
   */
  enable() {
    if (this.#teardown !== null) throw new Error('enable() called twice')
    // Throws if the schema is missing, before anything is wired. Nothing
    // connects to the settings (a change triggers nothing by itself), so
    // disable() releases them by dropping the teardown that holds them.
    const settings = settingsFrom(this.getSettings())
    const log = createLog(this.getLogger(), settings)
    /** @type {(() => void)[]} Undo steps, run last first. */
    const undo = []
    this.#teardown = () => {
      runAll([...undo].reverse(), log)
    }
    try {
      this.#wire(settings, log, undo)
    } catch (error) {
      // The Shell does not call disable() after a failed enable(); keep the
      // error that made it fail, not one from the cleanup.
      try {
        this.disable()
      } catch (cleanupError) {
        log.error('cleanup after a failed enable', cleanupError)
      }
      throw error
    }
  }

  /**
   * Connect everything, pushing the step that undoes each piece as soon as it
   * exists.
   *
   * @param {Settings} settings
   * @param {Log} log
   * @param {(() => void)[]} undo
   * @returns {void}
   */
  #wire(settings, log, undo) {
    const proxyCancellable = new Gio.Cancellable()
    undo.push(() => {
      proxyCancellable.cancel()
    })
    const proxy = createProxy(proxyCancellable)
    // reason: the checks and applies chain on `proxy` and handle their own
    // failures; this only logs a proxy that could not be created.
    void proxy.catch((/** @type {unknown} */ error) => {
      // disable() cancels a proxy still being created.
      if (!isCancelled(error))
        log.error('creating the D-Bus proxy failed', error)
    })
    /**
     * @template T
     * @param {(proxy: Gio.DBusProxy, cancellable: Gio.Cancellable) => Promise<T>} call
     * @returns {Pending<T>} The call on the proxy, once it exists.
     */
    const onProxy = (call) => {
      const cancellable = new Gio.Cancellable()
      return {
        result: proxy.then((p) => call(p, cancellable)),
        cancel: () => {
          cancellable.cancel()
        },
      }
    }

    const record = createRecord(() => settings.settleMs())
    undo.push(() => {
      record.destroy()
    })
    undo.push(trackWindows(record))
    /** @type {Session<Meta.Window>} */
    const session = new Session({
      record,
      timers: glibTimers,
      settings,
      log,
      readRemotes: () => onProxy(readRemoteMonitors),
      applyPrimary: (connector, makePrimary) =>
        onProxy((p, c) => applyPrimary(p, connector, makePrimary, c)),
      readWindows: readNormalWindows,
      gather,
      restore,
      describe: (window) => `window of ${window.get_wm_class() ?? 'unknown'}`,
    })
    undo.push(() => {
      session.stop()
    })

    const sessionMode = shellSessionMode()
    let locked = sessionMode.isLocked
    const modeId = sessionMode.connect('updated', () => {
      if (sessionMode.isLocked === locked) return
      locked = sessionMode.isLocked
      session.lockChanged(locked)
    })
    undo.push(() => {
      sessionMode.disconnect(modeId)
    })
    const monitorsId = Main.layoutManager.connect('monitors-changed', () => {
      session.monitorsChanged()
    })
    undo.push(() => {
      Main.layoutManager.disconnect(monitorsId)
    })

    session.begin(locked)
  }

  /**
   * The extension also runs in the `unlock-dialog` session mode (ADR-0005
   * part 1 and its amendments). Without it, where the RDP connection survives
   * the lock ("Allow Locked Remote Desktop"), locking the screen would call
   * disable(), which puts the gathered windows back while the client is still
   * connected, and the unlock would gather them again. With it, the session
   * survives the lock: the windows stay gathered and the client's monitor
   * stays primary, except at the first lock after the extension was enabled
   * mid-session, when the Shell still disables and re-enables it. The
   * extension draws nothing and connects no keyboard signals.
   *
   * @override
   * @returns {void}
   */
  disable() {
    const teardown = this.#teardown
    this.#teardown = null
    teardown?.()
  }
}

/**
 * Run every step, even if one throws. A single error is rethrown as it is;
 * with several, each is logged with its stack and an AggregateError follows.
 *
 * @param {readonly (() => void)[]} steps
 * @param {Log} log
 * @returns {void}
 */
function runAll(steps, log) {
  /** @type {unknown[]} */
  const errors = []
  for (const step of steps) {
    try {
      step()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    for (const error of errors) log.error('teardown step failed', error)
    throw new AggregateError(errors, 'teardown failed; each step is logged')
  }
}

/**
 * The extension's log, quiet by default: warnings and errors always, the
 * debug lines only with the `debug-logging` setting on.
 *
 * @param {ConsoleLike} logger From `getLogger()`, which prefixes the
 *   extension's name.
 * @param {Settings} settings
 * @returns {Log} The log.
 */
function createLog(logger, settings) {
  return {
    debug: (message) => {
      // GLib drops debug and info messages unless G_MESSAGES_DEBUG is set, so
      // the setting, not the level, decides whether these show.
      if (settings.debugLogging()) logger.log(message)
    },
    warn: (message) => {
      logger.warn(message)
    },
    error: (message, error) => {
      // The console prints an Error with its stack.
      if (error === undefined) logger.error(message)
      else logger.error(`${message}:`, error)
    },
  }
}

/**
 * @returns {SessionMode} `Main.sessionMode`, typed.
 */
function shellSessionMode() {
  /** @type {unknown} */
  const mode = Main.sessionMode
  // reason: @girs/gnome-shell 49 declares Main.sessionMode as `any`; the
  // members SessionMode lists are the Shell's own (see its typedef).
  return /** @type {SessionMode} */ (mode)
}
