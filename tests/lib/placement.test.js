// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * src/lib/placement.js without the session: when a window's change is
 * committed, and how monitor bursts, the lock and leaving Idle hold changes
 * back (docs/design.md, The placement record; ADR-0004 part 1,
 * ADR-0005 part 2). The session flow tests cover the record as the session
 * drives it. These also cover calls the session never makes, such as
 * `checked()` for a stale burst, which the session drops itself.
 */

import { PlacementRecord } from '../../src/lib/placement.js'
import { FakeClock } from '../fakes.js'
import { assertEqual, test } from '../harness.js'

/** @import { WindowRecord } from '../../src/lib/windows.js' */

const SETTLE = 250

/**
 * @typedef {object} FakeWindow
 * @property {string} name
 */

/**
 * A record over named windows, each on a connector the test sets. The record
 * is Idle and unlocked, as after the first check. Returns the clock, the
 * record, the `settle-ms` value it reads (`timing.settle`), and helpers that
 * change a window and tell the record, as the window signals do.
 *
 * @param {Record<string, string>} windows Window name to connector.
 */
function makeRecord(windows) {
  const clock = new FakeClock()
  const timing = { settle: SETTLE }
  /** @type {Map<FakeWindow, string | null>} Null: on no present monitor. */
  const places = new Map(
    Object.entries(windows).map(([name, connector]) => [{ name }, connector]),
  )
  /** @type {PlacementRecord<FakeWindow>} */
  const record = new PlacementRecord(
    (window) => {
      const connector = places.get(window)
      return connector === undefined || connector === null
        ? null
        : recordOn(connector)
    },
    () => timing.settle,
    clock.timers,
  )
  /** @type {Map<FakeWindow, WindowRecord>} */
  const initial = new Map()
  for (const [window, connector] of places) {
    if (connector !== null) initial.set(window, recordOn(connector))
  }
  record.rebuild(initial)
  record.setIdle(true)

  /**
   * @param {string} name
   * @returns {FakeWindow} The window.
   */
  const byName = (name) => {
    const window = [...places.keys()].find((w) => w.name === name)
    if (window === undefined) throw new Error(`no window ${name}`)
    return window
  }

  return {
    clock,
    record,
    timing,

    /**
     * The window moves and the record is told, as the window signals do.
     *
     * @param {string} name
     * @param {string} connector
     */
    move(name, connector) {
      const window = byName(name)
      places.set(window, connector)
      record.changed(window)
    },

    /**
     * The window ends up on no present monitor, as the read reports it.
     *
     * @param {string} name
     */
    lose(name) {
      const window = byName(name)
      places.set(window, null)
      record.changed(window)
    },

    /**
     * @param {string} name
     */
    close(name) {
      const window = byName(name)
      places.delete(window)
      record.removed(window)
    },

    /** @returns {Record<string, string>} Each recorded window's monitor. */
    recorded() {
      return Object.fromEntries(
        [...record.snapshot()].map(([window, r]) => [
          window.name,
          r.monitor.connector,
        ]),
      )
    },
  }
}

/**
 * @param {string} connector
 * @returns {WindowRecord} A window record on that monitor.
 */
function recordOn(connector) {
  return {
    workspace: 0,
    monitor: { vendor: 'V', product: 'P', serial: 'S', connector },
    frame: { x: 0, y: 0, width: 800, height: 600 },
    maximizeFlags: 0,
    fullscreen: false,
    minimized: false,
  }
}

test('a change is committed once the window has been still for the settle period', async () => {
  const world = makeRecord({ a: 'DP-1' })
  world.move('a', 'DP-2')

  await world.clock.advance(SETTLE - 1)
  const before = world.recorded()
  await world.clock.advance(1)

  assertEqual(before, { a: 'DP-1' })
  assertEqual(world.recorded(), { a: 'DP-2' })
})

test('another change restarts the settle period', async () => {
  const world = makeRecord({ a: 'DP-1' })
  world.move('a', 'DP-2')
  await world.clock.advance(SETTLE - 1)

  world.move('a', 'DP-3')
  await world.clock.advance(SETTLE - 1)
  const before = world.recorded()
  await world.clock.advance(1)

  assertEqual(before, { a: 'DP-1' })
  assertEqual(world.recorded(), { a: 'DP-3' })
})

test('a change outside Idle is not recorded', async () => {
  const world = makeRecord({ a: 'DP-1' })
  world.record.setIdle(false)

  world.move('a', 'DP-2')
  await world.clock.advance(SETTLE)

  assertEqual(world.recorded(), { a: 'DP-1' })
})

test('leaving Idle drops a change still settling', async () => {
  const world = makeRecord({ a: 'DP-1' })
  world.move('a', 'DP-2')

  world.record.setIdle(false)
  await world.clock.advance(SETTLE)

  assertEqual(world.recorded(), { a: 'DP-1' })
  assertEqual(world.clock.pending, 0)
})

test('a window that closes leaves the record', () => {
  const world = makeRecord({ a: 'DP-1', b: 'DP-2' })

  world.close('b')

  assertEqual(world.recorded(), { a: 'DP-1' })
})

test('a window that closes while its change settles leaves no timer behind', () => {
  const world = makeRecord({ a: 'DP-1' })
  world.move('a', 'DP-2')

  world.close('a')

  assertEqual(world.clock.pending, 0)
  assertEqual(world.recorded(), {})
})

test('a window that closes outside Idle leaves the record too', () => {
  const world = makeRecord({ a: 'DP-1', b: 'DP-2' })
  world.record.setIdle(false)

  world.close('b')

  assertEqual(world.recorded(), { a: 'DP-1' })
})

test('a window that closes while the screen is locked leaves the record', () => {
  const world = makeRecord({ a: 'DP-1', b: 'DP-2' })
  world.record.setLocked(true)

  world.close('b')

  assertEqual(world.recorded(), { a: 'DP-1' })
})

test('a window that settles on no present monitor leaves the record', async () => {
  const world = makeRecord({ a: 'DP-1', b: 'DP-2' })

  world.lose('b')
  await world.clock.advance(SETTLE)

  assertEqual(world.recorded(), { a: 'DP-1' })
})

test('the settle period is read when the window changes', async () => {
  const world = makeRecord({ a: 'DP-1' })
  world.timing.settle = 2 * SETTLE

  world.move('a', 'DP-2')
  await world.clock.advance(2 * SETTLE - 1)
  const before = world.recorded()
  await world.clock.advance(1)

  assertEqual(before, { a: 'DP-1' })
  assertEqual(world.recorded(), { a: 'DP-2' })
})

test('a change during a monitor burst is recorded after the check, not before', async () => {
  const world = makeRecord({ a: 'DP-1' })
  world.record.monitorsChanged()
  const burst = world.record.burst

  world.move('a', 'DP-2')
  await world.clock.advance(SETTLE)
  const beforeCheck = world.recorded()
  world.record.checked(burst)
  await world.clock.advance(SETTLE)

  assertEqual(beforeCheck, { a: 'DP-1' })
  assertEqual(world.recorded(), { a: 'DP-2' })
})

test('a check that started before the latest burst does not resume commits', async () => {
  const world = makeRecord({ a: 'DP-1' })
  world.record.monitorsChanged()
  const stale = world.record.burst
  world.record.monitorsChanged()

  world.move('a', 'DP-2')
  world.record.checked(stale)
  await world.clock.advance(SETTLE)

  assertEqual(world.recorded(), { a: 'DP-1' })
})

test('a check that started before the unlock does not resume commits', async () => {
  const world = makeRecord({ a: 'DP-1' })
  world.record.setLocked(true)
  world.record.monitorsChanged()
  const beforeUnlock = world.record.burst

  world.move('a', 'DP-2')
  world.record.setLocked(false)
  world.record.checked(beforeUnlock)
  await world.clock.advance(SETTLE)

  assertEqual(world.recorded(), { a: 'DP-1' })
})

test('a lock holds a settling change until the unlock check', async () => {
  const world = makeRecord({ a: 'DP-1' })
  world.move('a', 'DP-2')

  world.record.setLocked(true)
  await world.clock.advance(SETTLE)
  const whileLocked = world.recorded()
  world.record.setLocked(false)
  world.record.checked(world.record.burst)
  await world.clock.advance(SETTLE)

  assertEqual(whileLocked, { a: 'DP-1' })
  assertEqual(world.recorded(), { a: 'DP-2' })
})

test('a check while locked keeps the held changes for the unlock check', async () => {
  const world = makeRecord({ a: 'DP-1' })
  world.record.setLocked(true)
  world.move('a', 'DP-2')

  world.record.checked(world.record.burst)
  await world.clock.advance(SETTLE)
  const afterLockedCheck = world.recorded()
  world.record.setLocked(false)
  world.record.checked(world.record.burst)
  await world.clock.advance(SETTLE)

  assertEqual(afterLockedCheck, { a: 'DP-1' })
  assertEqual(world.recorded(), { a: 'DP-2' })
})

test('after an unlock, commits wait for the unlock check', async () => {
  const world = makeRecord({ a: 'DP-1' })
  world.record.setLocked(true)
  world.record.setLocked(false)

  world.move('a', 'DP-2')
  await world.clock.advance(SETTLE)
  const beforeCheck = world.recorded()
  world.record.checked(world.record.burst)
  await world.clock.advance(SETTLE)

  assertEqual(beforeCheck, { a: 'DP-1' })
  assertEqual(world.recorded(), { a: 'DP-2' })
})

test('a held change is not read again if the check leaves Idle', async () => {
  const world = makeRecord({ a: 'DP-1' })
  world.record.monitorsChanged()
  world.move('a', 'DP-2')

  world.record.setIdle(false)
  world.record.checked(world.record.burst)
  await world.clock.advance(SETTLE)

  assertEqual(world.recorded(), { a: 'DP-1' })
})

test('the snapshot is a copy the record does not change afterwards', async () => {
  const world = makeRecord({ a: 'DP-1' })
  const snapshot = world.record.snapshot()

  world.move('a', 'DP-2')
  await world.clock.advance(SETTLE)

  assertEqual(
    [...snapshot.values()].map((r) => r.monitor.connector),
    ['DP-1'],
  )
})

test('destroying the record stops its timers and forgets every window', () => {
  const world = makeRecord({ a: 'DP-1', b: 'DP-2' })
  world.move('a', 'DP-2')

  world.record.destroy()

  assertEqual(world.clock.pending, 0)
  assertEqual(world.recorded(), {})
})
