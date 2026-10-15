// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * The extension's state machine (docs/design.md, States) as pure transitions on
 * plain data. The caller feeds it events and carries out the returned effects
 * in order; effects that finish asynchronously come back as events.
 */

import { chooseSessionMonitor } from './monitors.js'

/** @import { Arrival } from './monitors.js' */

/**
 * A virtual monitor's identity within the running Shell (ADR-0002 part 3).
 *
 * @typedef {object} MonitorId
 * @property {string} connector
 * @property {string} serial
 */

/**
 * A matching virtual monitor present at a monitor check.
 *
 * @typedef {MonitorId & { primary: boolean }} RemoteMonitor
 */

/**
 * Where Focusing is: an apply in flight, waiting for the monitor check that
 * follows the layout change the apply caused, a failed apply waiting for its
 * retry, or gathering. `gone` means the session's monitor was missing at a
 * check while the screen was locked: nothing new is pending, and the unlock
 * check ends the session as `sessionGone` does, or starts the apply over if
 * the monitor is back.
 *
 * @typedef {'apply' | 'awaitLayout' | 'retry' | 'gather' | 'gone'} FocusStep
 */

/**
 * How an apply ended: the primary moved to the session's monitor, it was
 * there already, or `make-primary` is off and the monitor is not primary. A
 * monitor that is primary is reported as `primaryAlready`, whatever the
 * setting.
 *
 * @typedef {'changed' | 'primaryAlready' | 'skipped'} ApplyResult
 */

/**
 * The five states; `goneAt` is the monitor check that found the session's
 * monitor gone. `primary` holds whether the session's monitor was primary when
 * gathering began; only then can losing the primary dismiss the session.
 *
 * @typedef {{ kind: 'idle' }
 *   | { kind: 'focusing', session: MonitorId, step: FocusStep, retried: boolean, primary: boolean }
 *   | { kind: 'focused', session: MonitorId, primary: boolean }
 *   | { kind: 'dismissed', session: MonitorId }
 *   | { kind: 'restoring', goneAt: number }} State
 */

/** @typedef {Extract<State, { kind: 'focusing' }>} Focusing */

/**
 * @typedef {object} Machine
 * @property {State} state
 * @property {boolean} locked
 * @property {boolean} rebuildPending The placement record waits for unlock.
 * @property {number} checks Monitor checks run while unlocked.
 * @property {readonly Arrival[]} arrivals The check at which each matching
 *   monitor present now first appeared (ADR-0002 part 2).
 */

/**
 * @typedef {{ kind: 'check', remotes: readonly RemoteMonitor[] }
 *   | { kind: 'applied', result: ApplyResult }
 *   | { kind: 'applyFailed' }
 *   | { kind: 'retryDue' }
 *   | { kind: 'gatherDue' }
 *   | { kind: 'gathered' }
 *   | { kind: 'restored' }
 *   | { kind: 'lock' }
 *   | { kind: 'unlock' }} Event
 */

/**
 * `apply` reads `GetCurrentState` and makes the monitor primary, reporting an
 * `ApplyResult`; `scheduleRetry` and `scheduleGather` fire `retryDue` and
 * `gatherDue` one debounce period later; `gather` runs to completion before
 * `gathered` and adds the windows it moves to the session's gathered set,
 * which `dropSnapshot` discards with the snapshot.
 * Settings are read by the effect that needs them, when it runs. A cancel
 * effect for something already finished or cancelled does nothing, and a
 * cancelled effect reports no event.
 *
 * @typedef {{ kind: 'rebuildRecord' }
 *   | { kind: 'runCheck' }
 *   | { kind: 'takeSnapshot' }
 *   | { kind: 'apply', connector: string }
 *   | { kind: 'cancelApply' }
 *   | { kind: 'scheduleRetry' }
 *   | { kind: 'cancelRetry' }
 *   | { kind: 'scheduleGather' }
 *   | { kind: 'cancelGather' }
 *   | { kind: 'gather', connector: string }
 *   | { kind: 'restore' }
 *   | { kind: 'cancelRestore' }
 *   | { kind: 'dropSnapshot' }} Effect
 */

/**
 * @typedef {object} Transition
 * @property {Machine} machine
 * @property {readonly Effect[]} effects To carry out in order.
 */

/**
 * The machine at `enable()`. While the screen is locked, everything waits for
 * unlock (ADR-0005 part 3); otherwise the record is built and the first check
 * runs.
 *
 * @param {boolean} locked
 * @returns {Transition} The first machine and its effects.
 */
export function start(locked) {
  // Starts locked so that an unlocked enable() takes the unlock path: build
  // the record, then check (ADR-0005 part 3).
  /** @type {Machine} */
  const machine = {
    state: { kind: 'idle' },
    locked: true,
    rebuildPending: true,
    checks: 0,
    arrivals: [],
  }
  return locked
    ? { machine, effects: [] }
    : transition(machine, { kind: 'unlock' })
}

/**
 * Apply one event. An event that does not fit the current state, such as a
 * late `gathered` after the session's monitor went, changes nothing.
 *
 * @param {Machine} machine
 * @param {Event} event
 * @returns {Transition} The next machine and its effects.
 */
export function transition(machine, event) {
  const { state } = machine
  switch (event.kind) {
    case 'lock':
      return { machine: { ...machine, locked: true }, effects: [] }
    case 'unlock':
      if (!machine.locked) return unchanged(machine)
      return {
        machine: { ...machine, locked: false, rebuildPending: false },
        effects: machine.rebuildPending
          ? [{ kind: 'rebuildRecord' }, { kind: 'runCheck' }]
          : [{ kind: 'runCheck' }],
      }
    case 'check':
      return machine.locked
        ? lockedCheck(machine, event.remotes)
        : check(machine, event.remotes)
    case 'applied':
      if (state.kind !== 'focusing' || state.step !== 'apply') break
      return applied(machine, state, event.result)
    case 'applyFailed':
      if (state.kind !== 'focusing' || state.step !== 'apply') break
      if (state.retried) {
        return to(machine, { kind: 'dismissed', session: state.session }, [])
      }
      return to(machine, { ...state, step: 'retry' }, [
        { kind: 'scheduleRetry' },
      ])
    case 'retryDue':
      if (state.kind !== 'focusing' || state.step !== 'retry') break
      return retry(machine, state, [])
    case 'gatherDue':
      if (state.kind !== 'focusing' || state.step !== 'awaitLayout') break
      return startGather(machine, state, true, [])
    case 'gathered':
      if (state.kind !== 'focusing' || state.step !== 'gather') break
      return to(
        machine,
        { kind: 'focused', session: state.session, primary: state.primary },
        [],
      )
    case 'restored':
      if (state.kind !== 'restoring') break
      // While locked, the rebuild and the check wait for unlock (ADR-0005
      // part 2); otherwise the check runs at once (ADR-0002 part 4).
      return {
        machine: {
          ...machine,
          state: { kind: 'idle' },
          rebuildPending: machine.locked,
        },
        effects: machine.locked
          ? [{ kind: 'dropSnapshot' }]
          : [
              { kind: 'dropSnapshot' },
              { kind: 'rebuildRecord' },
              { kind: 'runCheck' },
            ],
      }
  }
  return unchanged(machine)
}

/**
 * @param {Machine} machine
 * @param {Focusing} state
 * @param {ApplyResult} result
 * @returns {Transition} The next machine and its effects.
 */
function applied(machine, state, result) {
  switch (result) {
    case 'changed':
      // Gathering waits for the layout to move, at most one debounce period
      // (docs/design.md, Focusing step 3).
      return to(machine, { ...state, step: 'awaitLayout' }, [
        { kind: 'scheduleGather' },
      ])
    case 'primaryAlready':
      return startGather(machine, state, true, [])
    case 'skipped':
      return startGather(machine, state, false, [])
  }
}

/**
 * A monitor check while unlocked: note the arrivals, then act on them.
 *
 * @param {Machine} machine
 * @param {readonly RemoteMonitor[]} remotes
 * @returns {Transition} The next machine and its effects.
 */
function check(machine, remotes) {
  const checks = machine.checks + 1
  const arrivals = remotes.map(
    (r) =>
      machine.arrivals.find((a) => sameMonitor(a, r)) ?? {
        connector: r.connector,
        serial: r.serial,
        arrivedAt: checks,
      },
  )
  const next = { ...machine, checks, arrivals }
  const { state } = machine

  switch (state.kind) {
    case 'idle': {
      const chosen = chooseSessionMonitor(arrivals)
      if (chosen === undefined) return unchanged(next)
      return focus(next, chosen, [{ kind: 'takeSnapshot' }])
    }
    case 'restoring': {
      // A monitor that appeared since the check that found the session's
      // monitor gone is the client coming back (ADR-0002 part 3).
      const chosen = chooseSessionMonitor(
        arrivals.filter((a) => a.arrivedAt >= state.goneAt),
      )
      if (chosen === undefined) return unchanged(next)
      return focus(next, chosen, [{ kind: 'cancelRestore' }])
    }
    case 'focusing':
    case 'focused':
    case 'dismissed': {
      const session = remotes.find((r) => sameMonitor(r, state.session))
      if (session === undefined) return sessionGone(next, state)
      if (state.kind === 'focused' && state.primary && !session.primary) {
        return to(next, { kind: 'dismissed', session: state.session }, [])
      }
      if (state.kind !== 'focusing') return unchanged(next)
      if (state.step === 'awaitLayout') return layoutMoved(next, state, session)
      if (state.step === 'retry') {
        return retry(next, state, [{ kind: 'cancelRetry' }])
      }
      // Missing at a check while locked, present again now: the cancelled
      // work starts over, with the same snapshot.
      if (state.step === 'gone') return focus(next, session, [])
      return unchanged(next)
    }
  }
}

/**
 * A monitor check while locked starts nothing and records no arrivals
 * (ADR-0005 part 2). In Focusing it lets the gather that waits for the apply's
 * layout change go ahead, and if the session's monitor went, it cancels what
 * is pending and leaves the session to the unlock check. A pending retry waits
 * for its timer (ADR-0005, Related).
 *
 * @param {Machine} machine
 * @param {readonly RemoteMonitor[]} remotes
 * @returns {Transition} The next machine and its effects.
 */
function lockedCheck(machine, remotes) {
  const { state } = machine
  if (state.kind !== 'focusing' || state.step === 'gone') {
    return unchanged(machine)
  }
  const session = remotes.find((r) => sameMonitor(r, state.session))
  if (session === undefined) {
    return to(machine, { ...state, step: 'gone' }, cancelPending(state))
  }
  if (state.step === 'awaitLayout') return layoutMoved(machine, state, session)
  return unchanged(machine)
}

/**
 * The check after an apply that changed the primary: gather, unless the
 * primary has already left the session's monitor (ADR-0003 part 4 and its
 * amendment).
 *
 * @param {Machine} machine
 * @param {Focusing} state
 * @param {RemoteMonitor} session The session's monitor at this check.
 * @returns {Transition} The next machine and its effects.
 */
function layoutMoved(machine, state, session) {
  /** @type {readonly Effect[]} */
  const cancel = [{ kind: 'cancelGather' }]
  if (!session.primary) {
    return to(machine, { kind: 'dismissed', session: state.session }, cancel)
  }
  return startGather(machine, state, true, cancel)
}

/**
 * The session's monitor is gone: restore, unless a matching monitor new at
 * this check is the client coming back with the same snapshot (ADR-0002
 * part 3).
 *
 * @param {Machine} machine With this check's arrivals.
 * @param {Exclude<State, { kind: 'idle' | 'restoring' }>} state
 * @returns {Transition} The next machine and its effects.
 */
function sessionGone(machine, state) {
  const cancel = cancelPending(state)
  const chosen = chooseSessionMonitor(
    machine.arrivals.filter((a) => a.arrivedAt === machine.checks),
  )
  if (chosen !== undefined) return focus(machine, chosen, cancel)
  return to(machine, { kind: 'restoring', goneAt: machine.checks }, [
    ...cancel,
    { kind: 'restore' },
  ])
}

/**
 * @param {State} state
 * @returns {readonly Effect[]} The cancel for the work Focusing has pending.
 */
function cancelPending(state) {
  if (state.kind !== 'focusing') return []
  switch (state.step) {
    case 'apply':
      return [{ kind: 'cancelApply' }]
    case 'retry':
      return [{ kind: 'cancelRetry' }]
    case 'awaitLayout':
      return [{ kind: 'cancelGather' }]
    case 'gather':
    case 'gone':
      return []
  }
}

/**
 * Enter Focusing on `monitor` and start the apply (ADR-0003 part 1).
 *
 * @param {Machine} machine
 * @param {MonitorId} monitor
 * @param {readonly Effect[]} before Effects that come before the apply.
 * @returns {Transition} The next machine and its effects.
 */
function focus(machine, monitor, before) {
  const session = { connector: monitor.connector, serial: monitor.serial }
  return to(
    machine,
    {
      kind: 'focusing',
      session,
      step: 'apply',
      retried: false,
      primary: false,
    },
    [...before, { kind: 'apply', connector: session.connector }],
  )
}

/**
 * The one retry of a failed apply, from a fresh read (ADR-0003 part 3).
 *
 * @param {Machine} machine
 * @param {Focusing} state
 * @param {readonly Effect[]} before
 * @returns {Transition} The next machine and its effects.
 */
function retry(machine, state, before) {
  return to(machine, { ...state, step: 'apply', retried: true }, [
    ...before,
    { kind: 'apply', connector: state.session.connector },
  ])
}

/**
 * @param {Machine} machine
 * @param {Focusing} state
 * @param {boolean} primary Whether the session's monitor is primary now.
 * @param {readonly Effect[]} before
 * @returns {Transition} The machine gathering onto the session's monitor.
 */
function startGather(machine, state, primary, before) {
  return to(machine, { ...state, step: 'gather', primary }, [
    ...before,
    { kind: 'gather', connector: state.session.connector },
  ])
}

/**
 * @param {Machine} machine
 * @param {State} state
 * @param {readonly Effect[]} effects
 * @returns {Transition} The machine in `state`.
 */
function to(machine, state, effects) {
  return { machine: { ...machine, state }, effects }
}

/**
 * @param {Machine} machine
 * @returns {Transition} The machine with no effects.
 */
function unchanged(machine) {
  return { machine, effects: [] }
}

/**
 * @param {MonitorId} a
 * @param {MonitorId} b
 * @returns {boolean} True for the same monitor: connector and serial match.
 */
function sameMonitor(a, b) {
  return a.connector === b.connector && a.serial === b.serial
}
