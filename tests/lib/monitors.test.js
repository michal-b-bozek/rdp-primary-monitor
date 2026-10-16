// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * src/lib/monitors.js against the replies captured on GNOME Shell 49 and 50:
 * finding the virtual monitor, telling whether it is primary, and building the
 * layout that makes it primary.
 */

import GLib from 'gi://GLib'

import {
  buildPrimaryLayout,
  chooseSessionMonitor,
  findRemoteMonitors,
  isPrimary,
  parseDisplayState,
} from '../../src/lib/monitors.js'
import {
  RELEASES,
  applyArgs,
  derivedApplyArgs,
  derivedState,
  displayState,
} from '../fixtures.js'
import { assertEqual, assertThrows, assertTrue, test } from '../harness.js'

/** @import { Release, StateName } from '../fixtures.js' */

/**
 * @param {Release} release
 * @param {StateName} name
 * @returns {import('../../src/lib/monitors.js').DisplayState} The parsed
 *   fixture.
 */
function stateOf(release, name) {
  return parseDisplayState(displayState(release, name).recursiveUnpack())
}

/**
 * @param {Release} release
 * @param {StateName} name
 * @returns {{ connector: string, serial: string }[]} The matching monitors.
 */
function remotesOf(release, name) {
  return findRemoteMonitors(stateOf(release, name)).map((m) => ({
    connector: m.connector,
    serial: m.serial,
  }))
}

for (const release of RELEASES) {
  test(`${release}: no virtual monitor matches before a client connects`, () => {
    assertEqual(remotesOf(release, 'idle'), [])
  })

  test(`${release}: the client's virtual monitor matches once it connects`, () => {
    assertEqual(remotesOf(release, 'connected'), [
      { connector: 'Meta-0', serial: '0x000001' },
    ])
  })

  test(`${release}: no virtual monitor matches after the client disconnects`, () => {
    assertEqual(remotesOf(release, 'after-disconnect'), [])
  })

  test(`${release}: a reconnected client's monitor matches with its new serial`, () => {
    assertEqual(remotesOf(release, 'reconnected'), [
      { connector: 'Meta-0', serial: '0x000002' },
    ])
  })

  test(`${release}: the virtual monitor is not primary when it appears`, () => {
    assertTrue(
      !isPrimary(stateOf(release, 'connected'), 'Meta-0'),
      'Meta-0 is not primary in the connected state',
    )
  })

  test(`${release}: the virtual monitor is primary after ApplyMonitorsConfig`, () => {
    assertTrue(
      isPrimary(stateOf(release, 'primary-applied'), 'Meta-0'),
      'Meta-0 is primary in the primary-applied state',
    )
  })

  test(`${release}: the built layout equals the captured ApplyMonitorsConfig layout`, () => {
    // Only the logical monitors: display.js adds the serial, the method and
    // the properties, and its own test checks the whole call.
    const built = new GLib.Variant(
      'a(iiduba(ssa{sv}))',
      buildPrimaryLayout(stateOf(release, 'connected'), 'Meta-0'),
    )
    const expected = applyArgs(release).get_child_value(0)
    assertTrue(
      built.equal(expected),
      `built ${built.print(true)}\n  expected ${expected.print(true)}`,
    )
  })
}

for (const layout of /** @type {const} */ ([
  'single',
  'desk',
  'desk-redocked',
])) {
  test(`${layout}: the built layout makes Meta-0 primary and keeps every other monitor's position, scale, rotation and mode`, () => {
    const state = parseDisplayState(
      derivedState(`${layout}-connected`).recursiveUnpack(),
    )

    const built = new GLib.Variant(
      'a(iiduba(ssa{sv}))',
      buildPrimaryLayout(state, 'Meta-0'),
    )

    const expected = derivedApplyArgs(layout).get_child_value(0)
    assertTrue(
      built.equal(expected),
      `built ${built.print(true)}\n  expected ${expected.print(true)}`,
    )
  })
}

test("two clients: both virtual monitors match, in the reply's order", () => {
  const state = parseDisplayState(
    derivedState('two-clients-connected').recursiveUnpack(),
  )

  assertEqual(
    findRemoteMonitors(state).map((m) => [m.connector, m.serial]),
    [
      ['Meta-0', '0x000001'],
      ['Meta-1', '0x000002'],
    ],
  )
})

test('two clients: the built layout makes only the chosen monitor primary', () => {
  const state = parseDisplayState(
    derivedState('two-clients-connected').recursiveUnpack(),
  )

  const layout = buildPrimaryLayout(state, 'Meta-1')

  assertEqual(
    layout.map(([, , , , primary, monitors]) => [monitors[0]?.[0], primary]),
    [
      ['Virtual-2', false],
      ['Virtual-1', false],
      ['Meta-0', false],
      ['Meta-1', true],
    ],
  )
})

test('a reply of the wrong shape is rejected', () => {
  assertThrows(() => parseDisplayState([1, [], []]), TypeError, /reply/)
})

test('a connector absent from the state cannot be made primary', () => {
  const state = stateOf('gnome49', 'idle')
  assertThrows(
    () => buildPrimaryLayout(state, 'Meta-0'),
    Error,
    /Meta-0 is in no logical monitor/,
  )
})

test('the session monitor has the lowest serial among the latest arrivals', () => {
  const chosen = chooseSessionMonitor([
    { connector: 'Meta-0', serial: '0x000001', arrivedAt: 1 },
    { connector: 'Meta-2', serial: '0x00000a', arrivedAt: 2 },
    { connector: 'Meta-1', serial: '0x000003', arrivedAt: 2 },
  ])
  assertEqual(chosen?.connector, 'Meta-1')
})

test('a serial that is not hexadecimal sorts after the others', () => {
  const chosen = chooseSessionMonitor([
    { connector: 'Meta-0', serial: 'unknown', arrivedAt: 1 },
    { connector: 'Meta-1', serial: '0xffffff', arrivedAt: 1 },
  ])
  assertEqual(chosen?.connector, 'Meta-1')
})

test('there is no session monitor without candidates', () => {
  assertEqual(chooseSessionMonitor([]), undefined)
})
