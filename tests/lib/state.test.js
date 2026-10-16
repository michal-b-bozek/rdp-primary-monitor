// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * src/lib/state.js on its own, for the paths the session flow cannot reach:
 * the session carries out a restore synchronously, so no check and no lock
 * ever meets the machine in Restoring there. The effects are the machine's
 * contract with the session (state.js, Effect).
 */

import { start, transition } from '../../src/lib/state.js'
import { assertEqual, test } from '../harness.js'

/** @import { Event, Machine, RemoteMonitor, Transition } from '../../src/lib/state.js' */

/**
 * @param {string} connector
 * @param {string} serial
 * @param {boolean} [primary]
 * @returns {RemoteMonitor} A matching virtual monitor at a check.
 */
function remote(connector, serial, primary = false) {
  return { connector, serial, primary }
}

/**
 * @param {Machine} machine
 * @param {readonly Event[]} events
 * @returns {Transition} The transition the last event made.
 */
function feed(machine, events) {
  /** @type {Transition} */
  let last = { machine, effects: [] }
  for (const event of events) last = transition(last.machine, event)
  return last
}

/**
 * @param {readonly RemoteMonitor[]} [others] Virtual monitors that arrived
 *   with Meta-0 and stay.
 * @returns {Machine} A machine in Restoring: a session on Meta-0 was focused
 *   and its monitor went at the last check; the restore has not reported yet.
 */
function restoring(others = []) {
  const { machine } = feed(start(false).machine, [
    { kind: 'check', remotes: [] },
    { kind: 'check', remotes: [remote('Meta-0', '0x000001'), ...others] },
    { kind: 'applied', result: 'primaryAlready' },
    { kind: 'gathered' },
    { kind: 'check', remotes: others },
  ])
  assertEqual(machine.state.kind, 'restoring')
  return machine
}

test('a client that appears during the restore takes over with the same snapshot', () => {
  const next = transition(restoring(), {
    kind: 'check',
    remotes: [remote('Meta-1', '0x000002')],
  })

  assertEqual(next.machine.state.kind, 'focusing')
  assertEqual(next.effects, [
    { kind: 'cancelRestore' },
    { kind: 'apply', connector: 'Meta-1' },
  ])
})

test('a monitor present before the session ended does not take over the restore', () => {
  const others = [remote('Meta-1', '0x000002')]

  const next = transition(restoring(others), { kind: 'check', remotes: others })

  assertEqual(next.machine.state.kind, 'restoring')
  assertEqual(next.effects, [])
})

test('a client that appears while locked during the restore takes over at the unlock check', () => {
  const locked = transition(restoring(), { kind: 'lock' }).machine
  const remotes = [remote('Meta-1', '0x000002')]

  const whileLocked = transition(locked, { kind: 'check', remotes })
  const unlocked = transition(whileLocked.machine, { kind: 'unlock' })
  const atUnlock = transition(unlocked.machine, { kind: 'check', remotes })

  assertEqual(whileLocked.effects, [])
  assertEqual(atUnlock.effects, [
    { kind: 'cancelRestore' },
    { kind: 'apply', connector: 'Meta-1' },
  ])
})

test('a restore that ends while unlocked rebuilds the record and checks at once', () => {
  const next = transition(restoring(), { kind: 'restored' })

  assertEqual(next.machine.state.kind, 'idle')
  assertEqual(next.effects, [
    { kind: 'dropSnapshot' },
    { kind: 'rebuildRecord' },
    { kind: 'runCheck' },
  ])
})

test('a restore that ends while locked leaves the rebuild and the check to the unlock', () => {
  const locked = transition(restoring(), { kind: 'lock' }).machine

  const ended = transition(locked, { kind: 'restored' })
  const unlocked = transition(ended.machine, { kind: 'unlock' })

  assertEqual(ended.effects, [{ kind: 'dropSnapshot' }])
  assertEqual(unlocked.effects, [
    { kind: 'rebuildRecord' },
    { kind: 'runCheck' },
  ])
})

test('an unlock after a lock in Idle only checks: the record was kept', () => {
  const idle = feed(start(false).machine, [
    { kind: 'check', remotes: [] },
  ]).machine

  const next = feed(idle, [{ kind: 'lock' }, { kind: 'unlock' }])

  assertEqual(next.effects, [{ kind: 'runCheck' }])
})

for (const kind of /** @type {const} */ ([
  'gathered',
  'restored',
  'retryDue',
  'gatherDue',
  'applyFailed',
])) {
  test(`a late ${kind} in Idle changes nothing`, () => {
    const idle = feed(start(false).machine, [
      { kind: 'check', remotes: [] },
    ]).machine

    const next = transition(idle, { kind })

    assertEqual(next.machine, idle)
    assertEqual(next.effects, [])
  })
}
