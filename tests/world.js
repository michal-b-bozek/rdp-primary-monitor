// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * A desk and a Mutter for driving src/lib/session.js the way the extension
 * wires it (src/extension.js): the real state machine and placement record,
 * with fakes only for the ports. The fakes follow the real ones where the
 * session can tell: a cancelled call rejects, as a cancelled D-Bus call does;
 * every window move reaches the record, as the window signals do
 * (tracking.js); gathering honours the mode and skips windows already on the
 * target, as gather.js does.
 */

import { PlacementRecord } from '../src/lib/placement.js'
import { Session } from '../src/lib/session.js'

import { Deferred, FakeClock } from './fakes.js'

/**
 * @import { GatherMode } from '../src/lib/gather.js'
 * @import { Settings } from '../src/lib/settings.js'
 * @import { ApplyResult, RemoteMonitor } from '../src/lib/state.js'
 * @import { WindowRecord } from '../src/lib/windows.js'
 */

/** The `debounce-ms` setting the world runs with. */
export const DEBOUNCE = 500

/** The `settle-ms` setting the world runs with. */
export const SETTLE = 250

/**
 * @typedef {object} FakeWindow
 * @property {string} name
 */

/**
 * The windows and the monitor each is on. Every move and every new window is
 * reported to the record, as Mutter's window signals are.
 *
 * @param {() => PlacementRecord<FakeWindow>} record
 * @param {Record<string, string>} initial Window name to connector.
 */
function fakeDesk(record, initial) {
  /** @type {Map<FakeWindow, string>} */
  const windows = new Map(
    Object.entries(initial).map(([name, connector]) => [{ name }, connector]),
  )

  /**
   * @param {string} name
   * @returns {FakeWindow} The open window with that name.
   */
  const byName = (name) => {
    const window = [...windows.keys()].find((w) => w.name === name)
    if (window === undefined) throw new Error(`no window ${name}`)
    return window
  }

  return {
    windows,
    byName,

    /**
     * @param {FakeWindow} window
     * @param {string} connector
     */
    move(window, connector) {
      windows.set(window, connector)
      record().changed(window)
    },

    /**
     * @param {string} name
     * @param {string} connector
     */
    open(name, connector) {
      const window = { name }
      windows.set(window, connector)
      record().changed(window)
    },

    /**
     * A window closes; Mutter's `unmanaging` tells the record.
     *
     * @param {string} name
     */
    close(name) {
      const window = byName(name)
      windows.delete(window)
      record().removed(window)
    },

    /** @returns {Record<string, string>} Each window's monitor, by name. */
    where() {
      return Object.fromEntries(
        [...windows].map(([window, connector]) => [window.name, connector]),
      )
    },
  }
}

/** @typedef {ReturnType<typeof fakeDesk>} Desk */

/**
 * Two physical monitors, DP-1 (primary) and DP-2, and the virtual monitors of
 * RDP clients. Every change reports `monitors-changed` through `changed` and
 * makes the window moves Mutter makes with it: by default before the signal,
 * as Mutter relocates windows in `monitors-changed-internal`, which comes
 * first; with `movesFirst` off, after it, as late window signals can arrive.
 *
 * @param {Desk} desk
 * @param {() => void} changed
 * @param {readonly { connector: string, serial: string }[]} clients The
 *   virtual monitors present from the start.
 * @param {boolean} movesFirst
 */
function fakeMutter(desk, changed, clients, movesFirst) {
  const physical = ['DP-1', 'DP-2']
  const remotes = [...clients]
  let primary = 'DP-1'

  /**
   * @param {string} from
   * @param {string} to
   */
  const park = (from, to) => {
    for (const [window, connector] of desk.windows) {
      if (connector === from) desk.move(window, to)
    }
  }

  /**
   * @param {() => void} moves
   * @returns {void}
   */
  const change = (moves) => {
    if (movesFirst) moves()
    changed()
    if (!movesFirst) moves()
  }

  return {
    /** @returns {string} The primary monitor's connector. */
    get primary() {
      return primary
    },

    /** @returns {RemoteMonitor[]} The virtual monitors present now. */
    remotesNow() {
      return remotes.map((r) => ({ ...r, primary: r.connector === primary }))
    },

    /**
     * @param {string} connector
     * @returns {boolean} Whether a monitor with this connector is present.
     */
    present(connector) {
      return (
        physical.includes(connector) ||
        remotes.some((r) => r.connector === connector)
      )
    },

    /**
     * A client connects: Mutter adds its virtual monitor.
     *
     * @param {string} connector
     * @param {string} serial
     * @param {Record<string, string>} [moves] Windows Mutter moves meanwhile,
     *   by name, to the connector given.
     */
    connect(connector, serial, moves = {}) {
      remotes.push({ connector, serial })
      change(() => {
        for (const [name, to] of Object.entries(moves)) {
          desk.move(desk.byName(name), to)
        }
      })
    },

    /**
     * A client disconnects: Mutter removes its monitor, falls back to DP-1 as
     * primary if it was, and parks the monitor's windows on the primary.
     *
     * @param {string} connector
     */
    disconnect(connector) {
      const i = remotes.findIndex((r) => r.connector === connector)
      if (i < 0) throw new Error(`no virtual monitor ${connector}`)
      remotes.splice(i, 1)
      if (primary === connector) primary = 'DP-1'
      change(() => {
        park(connector, primary)
      })
    },

    /**
     * A physical monitor is unplugged; its windows go to the primary.
     *
     * @param {string} connector
     */
    unplug(connector) {
      const i = physical.indexOf(connector)
      if (i < 0) throw new Error(`no physical monitor ${connector}`)
      if (connector === primary)
        throw new Error('the world cannot unplug the primary')
      physical.splice(i, 1)
      change(() => {
        park(connector, primary)
      })
    },

    /**
     * Make a monitor primary, as the user does in Settings or the
     * extension's apply does.
     *
     * @param {string} connector
     */
    setPrimary(connector) {
      primary = connector
      changed()
    },
  }
}

/**
 * @typedef {object} WorldOptions
 * @property {Record<string, string>} [windows] Window name to the connector
 *   of its monitor; by default `a` on DP-1 and `b` on DP-2.
 * @property {boolean} [emitOnApply] Whether an apply that moves the primary
 *   reports a monitor change, as Mutter does; by default it does.
 * @property {readonly { connector: string, serial: string }[]} [clients]
 *   Virtual monitors already present before the session begins.
 * @property {boolean} [movesFirst] Whether Mutter moves windows before it
 *   reports a monitor change; by default it does.
 */

/**
 * The desk, Mutter, the clock and a session wired over them. The settings are
 * plain fields a test can change at any time; the session reads them when it
 * needs them.
 *
 * @param {WorldOptions} [options]
 */
export function makeWorld({
  windows = { a: 'DP-1', b: 'DP-2' },
  emitOnApply = true,
  clients = [],
  movesFirst = true,
} = {}) {
  const clock = new FakeClock()
  const config = {
    makePrimary: true,
    /** @type {GatherMode} */
    gatherMode: 'all-workspaces',
    restoreOnDisconnect: true,
  }
  const log = {
    /** @type {string[]} */ debug: [],
    /** @type {string[]} */ warn: [],
    /** @type {string[]} */ error: [],
  }
  const calls = {
    checks: 0,
    /** @type {{ connector: string, makePrimary: boolean }[]} */
    applies: [],
    gathers: 0,
    restores: 0,
  }
  const control = {
    /** Applies that fail before one succeeds. */
    applyFailures: 0,
    /** Hold applies in `heldApplies` instead of answering them. */
    holdApplies: false,
    /** @type {Deferred<ApplyResult>[]} */
    heldApplies: [],
    /** Hold checks in `heldChecks` instead of answering them. */
    holdChecks: false,
    /** @type {Deferred<RemoteMonitor[]>[]} */
    heldChecks: [],
    failChecks: false,
    gatherThrows: false,
    /** @type {Set<string>} Windows whose move throws, by name. */
    stuck: new Set(),
  }

  /** @type {Settings} */
  const settings = {
    makePrimary: () => config.makePrimary,
    gatherMode: () => config.gatherMode,
    restoreOnDisconnect: () => config.restoreOnDisconnect,
    debounceMs: () => DEBOUNCE,
    settleMs: () => SETTLE,
    debugLogging: () => true,
  }

  /** @type {PlacementRecord<FakeWindow>} */
  const record = new PlacementRecord(
    (window) => {
      // As readWindow: null for a closed window or one on no present monitor.
      const connector = desk.windows.get(window)
      return connector === undefined || !mutter.present(connector)
        ? null
        : recordOn(connector)
    },
    settings.settleMs,
    clock.timers,
  )
  const desk = fakeDesk(() => record, windows)
  const mutter = fakeMutter(
    desk,
    () => {
      session.monitorsChanged()
    },
    clients,
    movesFirst,
  )

  /**
   * @param {FakeWindow} window
   * @returns {void}
   */
  const throwIfStuck = (window) => {
    if (control.stuck.has(window.name)) {
      throw new Error(`${window.name} would not move`)
    }
  }

  /** @type {Session<FakeWindow>} */
  const session = new Session({
    record,
    timers: clock.timers,
    settings,
    log: {
      debug: (message) => log.debug.push(message),
      warn: (message) => log.warn.push(message),
      error: (message) => log.error.push(message),
    },
    readRemotes: () => {
      calls.checks += 1
      /** @type {Deferred<RemoteMonitor[]>} */
      const check = new Deferred()
      if (control.holdChecks) control.heldChecks.push(check)
      else if (control.failChecks) check.reject(new Error('no reply'))
      else check.resolve(mutter.remotesNow())
      return check
    },
    applyPrimary: (connector, makePrimary) => {
      calls.applies.push({ connector, makePrimary })
      /** @type {Deferred<ApplyResult>} */
      const apply = new Deferred()
      if (control.holdApplies) {
        control.heldApplies.push(apply)
      } else if (mutter.primary === connector) {
        // In display.js's order: primary already, setting off, then the
        // layout (which needs the monitor), then ApplyMonitorsConfig.
        apply.resolve('primaryAlready')
      } else if (!makePrimary) {
        apply.resolve('skipped')
      } else if (!mutter.present(connector)) {
        apply.reject(new Error(`monitor ${connector} is in no logical monitor`))
      } else if (control.applyFailures > 0) {
        control.applyFailures -= 1
        apply.reject(new Error('stale serial'))
      } else {
        apply.resolve('changed')
        if (emitOnApply) mutter.setPrimary(connector)
      }
      return apply
    },
    readWindows: () =>
      new Map(
        [...desk.windows].map(([window, connector]) => [
          window,
          recordOn(connector),
        ]),
      ),
    gather: (handles, connector, mode) => {
      calls.gathers += 1
      if (control.gatherThrows) throw new Error('gather broke')
      /** @type {FakeWindow[]} */
      const moved = []
      /** @type {{ window: FakeWindow, error: unknown }[]} */
      const failed = []
      if (mode === 'off' || !mutter.present(connector)) {
        return { moved, failed }
      }
      for (const window of handles) {
        const now = desk.windows.get(window)
        if (now === undefined || now === connector) continue
        try {
          throwIfStuck(window)
          desk.move(window, connector)
          moved.push(window)
        } catch (error) {
          failed.push({ window, error })
        }
      }
      return { moved, failed }
    },
    restore: (pairs) => {
      calls.restores += 1
      /** @type {FakeWindow[]} */
      const monitorGone = []
      /** @type {{ window: FakeWindow, error: unknown }[]} */
      const failed = []
      for (const [window, saved] of pairs) {
        if (!desk.windows.has(window)) continue
        if (!mutter.present(saved.monitor.connector)) {
          monitorGone.push(window)
          continue
        }
        try {
          throwIfStuck(window)
          desk.move(window, saved.monitor.connector)
        } catch (error) {
          failed.push({ window, error })
        }
      }
      return { monitorGone, failed }
    },
    describe: (window) => window.name,
  })

  return {
    clock,
    session,
    mutter,
    desk,
    config,
    log,
    calls,
    control,

    /** @returns {Record<string, string>} Each window's monitor, by name. */
    where: () => desk.where(),

    /**
     * Take the warnings or errors logged so far, so that a test can check them
     * and the log is left empty.
     *
     * @param {'warn' | 'error'} level
     * @returns {string[]} The messages, oldest first.
     */
    takeLog: (level) => log[level].splice(0),

    /**
     * Let the clock run.
     *
     * @param {number} ms
     * @returns {Promise<void>} Settles when the clock has arrived.
     */
    wait: (ms) => clock.advance(ms),
  }
}

/** @typedef {ReturnType<typeof makeWorld>} World */

/**
 * @param {string} connector
 * @returns {WindowRecord} A window record on that monitor.
 */
function recordOn(connector) {
  return {
    workspace: 0,
    monitor: { vendor: 'V', product: 'P', serial: 'S', connector },
    frame: { x: 10, y: 10, width: 800, height: 600 },
    maximizeFlags: 0,
    fullscreen: false,
    minimized: false,
  }
}
