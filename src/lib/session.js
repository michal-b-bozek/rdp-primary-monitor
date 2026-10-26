// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * Runs the state machine (`state.js`) against the world: feeds it monitor
 * checks, the lock and the results of its effects, carries out the effects in
 * order and keeps the placement record in step. The caller supplies the D-Bus
 * calls, the window operations, the timers and the log, so this module
 * imports nothing from GNOME.
 */

import { start, transition } from './state.js'

/**
 * @import { PlacementRecord, Timers } from './placement.js'
 * @import { Settings } from './settings.js'
 * @import { ApplyResult, Effect, Event, Machine, RemoteMonitor, Transition } from './state.js'
 * @import { WindowRecord } from './windows.js'
 * @import { GatherMode } from './gather.js'
 */

/**
 * An asynchronous call that can be cancelled. Once cancelled, its outcome is
 * ignored, whatever it is.
 *
 * @template T
 * @typedef {object} Pending
 * @property {Promise<T>} result
 * @property {() => void} cancel
 */

/**
 * @typedef {object} Log
 * @property {(message: string) => void} debug Only with `debug-logging` on.
 * @property {(message: string) => void} warn
 * @property {(message: string, error?: unknown) => void} error With the
 *   error, if any, so that its stack reaches the log.
 */

/**
 * @template W
 * @typedef {object} WindowFailure
 * @property {W} window
 * @property {unknown} error
 */

/**
 * @template W The window handle.
 * @typedef {object} Ports
 * @property {PlacementRecord<W>} record
 * @property {Timers} timers
 * @property {Settings} settings
 * @property {Log} log
 * @property {() => Pending<RemoteMonitor[]>} readRemotes The matching
 *   monitors present now, for a monitor check.
 * @property {(connector: string, makePrimary: boolean) => Pending<ApplyResult>} applyPrimary
 * @property {() => Map<W, WindowRecord>} readWindows Every normal window.
 * @property {(windows: Iterable<W>, connector: string, mode: GatherMode) =>
 *   { moved: W[], failed: WindowFailure<W>[] }} gather Moves each window it
 *   can; returns those it moved and those whose move threw.
 * @property {(gathered: Iterable<readonly [W, WindowRecord]>) =>
 *   { monitorGone: W[], failed: WindowFailure<W>[] }} restore Restores each
 *   window it can; returns those whose original monitor is gone and those
 *   whose restore threw.
 * @property {(window: W) => string} describe Name a window in the log.
 */

/**
 * One session driver per `enable()`. Effects that report an event, at once or
 * later, queue it; the queue runs one transition at a time.
 *
 * @template W The window handle.
 */
export class Session {
  /** @type {Ports<W>} */
  #ports
  /** @type {Machine | null} */
  #machine = null
  /** @type {{ event: Event, burst: number | undefined }[]} */
  #queue = []
  #running = false
  #stopped = false
  /** @type {number | null} The debounce timer before a monitor check. */
  #debounce = null
  /** @type {number | null} */
  #retryTimer = null
  /** @type {number | null} */
  #gatherTimer = null
  /** @type {Pending<RemoteMonitor[]> | null} */
  #check = null
  /** @type {Pending<ApplyResult> | null} */
  #apply = null
  /** @type {Map<W, WindowRecord> | null} */
  #snapshot = null
  /** @type {Set<W>} */
  #gathered = new Set()

  /**
   * Log what a reply handler, a timer, a monitor change or a lock change
   * threw. Such a throw means the session broke an invariant. A throw inside
   * `#drain` has also cleared the queue.
   *
   * @param {unknown} error
   * @returns {void}
   */
  #logFailure = (error) => {
    this.#ports.log.error('session failed', error)
  }

  /**
   * @param {Ports<W>} ports
   */
  constructor(ports) {
    this.#ports = ports
  }

  /**
   * Start the state machine, as `enable()` does.
   *
   * @param {boolean} locked Whether the screen is locked now.
   * @returns {void}
   */
  begin(locked) {
    if (this.#machine !== null || this.#stopped) {
      throw new Error('begin() called twice or after stop()')
    }
    // The record starts unlocked; reporting a lock first makes an unlocked
    // start take the unlock path there too, pausing commits until the first
    // check (PlacementRecord.setLocked).
    this.#ports.record.setLocked(true)
    this.#running = true
    try {
      this.#step(start(locked), undefined, undefined)
    } catch (error) {
      this.#queue = []
      throw error
    } finally {
      this.#running = false
    }
    this.#drain()
  }

  /**
   * A raw `monitors-changed`: tell the record, and run the monitor check once
   * the monitors have been quiet for the debounce period.
   *
   * @returns {void}
   */
  monitorsChanged() {
    if (this.#stopped) return
    try {
      this.#ports.record.monitorsChanged()
      this.#removeTimer(this.#debounce)
      this.#debounce = null
      this.#debounce = this.#after(() => {
        this.#debounce = null
        this.#startCheck()
      })
    } catch (error) {
      // As for a lock change: the Shell's signal has no use for an error.
      this.#logFailure(error)
    }
  }

  /**
   * The screen locked or unlocked. A lock drops a pending monitor check
   * (docs/design.md, Lifecycle inside the Shell).
   *
   * @param {boolean} locked
   * @returns {void}
   */
  lockChanged(locked) {
    if (this.#stopped) return
    try {
      if (locked) {
        this.#removeTimer(this.#debounce)
        this.#debounce = null
        this.#check?.cancel()
        this.#check = null
      }
      this.#dispatch({ kind: locked ? 'lock' : 'unlock' }, undefined)
    } catch (error) {
      // The Shell's session-mode signal has no use for an error.
      this.#logFailure(error)
    }
  }

  /**
   * Stop for `disable()`: remove every timer, cancel every call, put the
   * gathered windows back synchronously and drop the snapshot (ADR-0004
   * part 5). The record belongs to the caller, which destroys it.
   *
   * @returns {void}
   */
  stop() {
    this.#stopped = true
    this.#queue = []
    for (const id of [this.#debounce, this.#retryTimer, this.#gatherTimer]) {
      this.#removeTimer(id)
    }
    this.#debounce = this.#retryTimer = this.#gatherTimer = null
    this.#check?.cancel()
    this.#apply?.cancel()
    this.#check = this.#apply = null
    try {
      this.#restoreGathered()
    } finally {
      this.#dropSnapshot()
    }
  }

  /**
   * @param {Event} event
   * @param {number | undefined} burst For a monitor check: the record's burst
   *   when the check started.
   * @returns {void}
   */
  #dispatch(event, burst) {
    if (this.#stopped) return
    this.#queue.push({ event, burst })
    this.#drain()
  }

  /**
   * Run the queued events one transition at a time. An event that an effect
   * reports waits until every effect of the current transition has run.
   *
   * @returns {void}
   */
  #drain() {
    if (this.#running) return
    this.#running = true
    try {
      for (
        let item = this.#queue.shift();
        item !== undefined && !this.#stopped;
        item = this.#queue.shift()
      ) {
        const machine = this.#machine
        if (machine === null)
          throw new Error(`${item.event.kind} before begin()`)
        this.#step(transition(machine, item.event), item.burst, item.event)
      }
    } catch (error) {
      // The transition stopped part-way, so the events its effects queued
      // would build on effects that never ran; the machine keeps the state
      // it reached.
      this.#queue = []
      throw error
    } finally {
      this.#running = false
    }
  }

  /**
   * Take one transition: report it to the record, then carry out its effects.
   * The record hears first, so a check that an effect starts reads the
   * record's burst after the transition (an unlock adds one).
   *
   * @param {Transition} next
   * @param {number | undefined} burst
   * @param {Event | undefined} event For the debug log.
   * @returns {void}
   */
  #step(next, burst, event) {
    const before = this.#machine?.state.kind ?? 'start'
    this.#machine = next.machine
    const { record, log } = this.#ports
    record.setLocked(next.machine.locked)
    record.setIdle(next.machine.state.kind === 'idle')
    if (burst !== undefined) record.checked(burst)
    const after = next.machine.state.kind
    if (before !== after) {
      log.debug(`${before} -> ${after}${event ? ` on ${event.kind}` : ''}`)
    }
    for (const effect of next.effects) this.#effect(effect)
  }

  /**
   * @param {Effect} effect
   * @returns {void}
   */
  #effect(effect) {
    const ports = this.#ports
    switch (effect.kind) {
      case 'rebuildRecord':
        ports.record.rebuild(ports.readWindows())
        break
      case 'runCheck':
        // A pending debounced check answers for this one too.
        if (this.#debounce === null) this.#startCheck()
        break
      case 'takeSnapshot':
        this.#snapshot = ports.record.snapshot()
        break
      case 'apply':
        this.#startApply(effect.connector)
        break
      case 'cancelApply':
        this.#apply?.cancel()
        this.#apply = null
        break
      case 'scheduleRetry':
        this.#retryTimer = this.#after(() => {
          this.#retryTimer = null
          this.#dispatch({ kind: 'retryDue' }, undefined)
        })
        break
      case 'cancelRetry':
        this.#removeTimer(this.#retryTimer)
        this.#retryTimer = null
        break
      case 'scheduleGather':
        this.#gatherTimer = this.#after(() => {
          this.#gatherTimer = null
          this.#dispatch({ kind: 'gatherDue' }, undefined)
        })
        break
      case 'cancelGather':
        this.#removeTimer(this.#gatherTimer)
        this.#gatherTimer = null
        break
      case 'gather': {
        if (this.#snapshot === null)
          throw new Error('gather without a snapshot')
        try {
          const { moved, failed } = ports.gather(
            this.#snapshot.keys(),
            effect.connector,
            ports.settings.gatherMode(),
          )
          for (const window of moved) this.#gathered.add(window)
          ports.log.debug(`windows gathered: ${String(moved.length)}`)
          this.#logWindowFailures('gathering', failed)
        } catch (error) {
          // Report the gather done anyway: a machine left waiting for it
          // would never reach Focused.
          ports.log.error('gathering windows failed', error)
        }
        this.#dispatch({ kind: 'gathered' }, undefined)
        break
      }
      case 'restore':
        try {
          if (ports.settings.restoreOnDisconnect()) this.#restoreGathered()
        } catch (error) {
          // As for the gather: without `restored`, the machine would stay in
          // Restoring for good.
          ports.log.error('restoring windows failed', error)
        }
        this.#dispatch({ kind: 'restored' }, undefined)
        break
      case 'cancelRestore':
        // The restore runs to completion inside its effect, so none is ever
        // under way when a check comes.
        break
      case 'dropSnapshot':
        this.#dropSnapshot()
        break
      default: {
        /** @type {never} */
        const unhandled = effect
        throw new Error(`unknown effect: ${JSON.stringify(unhandled)}`)
      }
    }
  }

  /**
   * Start a monitor check, replacing one still in flight. A monitor burst or
   * an unlock before its reply makes the check stale. Its reply is then
   * dropped and the check that follows answers (see
   * `PlacementRecord.checked()`). A lock cancels it (`lockChanged`).
   *
   * @returns {void}
   */
  #startCheck() {
    this.#check?.cancel()
    const { record, log } = this.#ports
    const burst = record.burst
    const pending = this.#ports.readRemotes()
    this.#check = pending
    // reason: the handlers end every outcome; the catch logs what they throw.
    void pending.result
      .then(
        (remotes) => {
          if (this.#check !== pending) return
          this.#check = null
          if (record.burst !== burst) return
          this.#dispatch({ kind: 'check', remotes }, burst)
        },
        (/** @type {unknown} */ error) => {
          if (this.#check !== pending) return
          this.#check = null
          log.warn(`monitor check failed: ${describeError(error)}`)
        },
      )
      .catch(this.#logFailure)
  }

  /**
   * @param {string} connector
   * @returns {void}
   */
  #startApply(connector) {
    this.#apply?.cancel()
    const { settings, log } = this.#ports
    const pending = this.#ports.applyPrimary(connector, settings.makePrimary())
    this.#apply = pending
    // reason: as in #startCheck.
    void pending.result
      .then(
        (result) => {
          if (this.#apply !== pending) return
          this.#apply = null
          log.debug(`apply on ${connector}: ${result}`)
          this.#dispatch({ kind: 'applied', result }, undefined)
        },
        (/** @type {unknown} */ error) => {
          if (this.#apply !== pending) return
          this.#apply = null
          const state = this.#machine?.state
          if (state?.kind === 'focusing' && state.retried) {
            log.error(
              `making ${connector} primary failed again, standing aside`,
              error,
            )
          } else {
            log.warn(
              `making ${connector} primary failed, retrying once: ${describeError(error)}`,
            )
          }
          this.#dispatch({ kind: 'applyFailed' }, undefined)
        },
      )
      .catch(this.#logFailure)
  }

  /**
   * Put each gathered window back from the snapshot and log, once, each one
   * whose original monitor is gone (ADR-0004 part 4).
   *
   * @returns {void}
   */
  #restoreGathered() {
    const snapshot = this.#snapshot
    if (snapshot === null) return
    /** @type {[W, WindowRecord][]} */
    const pairs = []
    for (const window of this.#gathered) {
      const record = snapshot.get(window)
      if (record !== undefined) pairs.push([window, record])
    }
    const { log, describe } = this.#ports
    const { monitorGone, failed } = this.#ports.restore(pairs)
    for (const window of monitorGone) {
      log.warn(
        `${describe(window)}: its original monitor is gone, left where it is`,
      )
    }
    this.#logWindowFailures('restoring', failed)
  }

  /**
   * @param {string} what The step that failed, as a gerund.
   * @param {readonly WindowFailure<W>[]} failed
   * @returns {void}
   */
  #logWindowFailures(what, failed) {
    const { log, describe } = this.#ports
    for (const { window, error } of failed) {
      log.error(`${what} ${describe(window)} failed`, error)
    }
  }

  /** @returns {void} */
  #dropSnapshot() {
    this.#snapshot = null
    this.#gathered.clear()
  }

  /**
   * @param {() => void} callback Logged, not rethrown, if it throws: a timer
   *   has no caller to report to.
   * @returns {number} A timer one debounce period from now.
   */
  #after(callback) {
    return this.#ports.timers.add(this.#ports.settings.debounceMs(), () => {
      try {
        callback()
      } catch (error) {
        this.#logFailure(error)
      }
    })
  }

  /**
   * @param {number | null} id
   * @returns {void}
   */
  #removeTimer(id) {
    if (id !== null) this.#ports.timers.remove(id)
  }
}

/**
 * @param {unknown} error
 * @returns {string} The error's message, for the log.
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
