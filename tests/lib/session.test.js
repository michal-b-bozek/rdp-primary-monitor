// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * The session flow of docs/design.md (States, Lifecycle inside the Shell)
 * through src/lib/session.js with its real state machine and placement
 * record, on the fake desk and Mutter of tests/world.js.
 */

import { assertEqual, assertTrue, test } from '../harness.js'
import { DEBOUNCE, SETTLE, makeWorld } from '../world.js'

/** @import { World, WorldOptions } from '../world.js' */

/** Where the windows are before any session. */
const HOME = { a: 'DP-1', b: 'DP-2' }

/** Where the windows are once gathered onto Meta-0. */
const ON_META_0 = { a: 'Meta-0', b: 'Meta-0' }

/** @type {World[]} The worlds the running test made. */
let worlds = []

/**
 * A world that `flow` checks for a clean log at the end of the test.
 *
 * @param {WorldOptions} [options]
 * @returns {World} The world.
 */
function newWorld(options) {
  const made = makeWorld(options)
  worlds.push(made)
  return made
}

/**
 * A test of the session flow. It fails if a world it made logged a warning or
 * an error the test did not take with `takeLog`.
 *
 * @param {string} name
 * @param {() => Promise<void>} fn
 * @returns {void}
 */
function flow(name, fn) {
  test(name, async () => {
    worlds = []
    await fn()
    for (const made of worlds) {
      assertEqual(made.takeLog('error'), [])
      assertEqual(made.takeLog('warn'), [])
    }
  })
}

/**
 * Start the session unlocked with no client, as `enable()` does.
 *
 * @param {WorldOptions} [options]
 * @returns {Promise<World>} The world after the first monitor check.
 */
async function started(options) {
  const world = newWorld(options)
  world.session.begin(false)
  await world.wait(0)
  return world
}

/**
 * Connect a client on Meta-0 and let the session run to Focused.
 *
 * @param {World} world
 * @returns {Promise<void>} Settles once the windows are gathered.
 */
async function connected(world) {
  world.mutter.connect('Meta-0', '0x000001')
  await world.wait(2 * DEBOUNCE)
}

/**
 * @template T
 * @param {readonly T[]} items
 * @returns {T} The one item.
 */
function only(items) {
  const [item] = items
  if (items.length !== 1 || item === undefined) {
    throw new Error(`expected one item, got ${String(items.length)}`)
  }
  return item
}

// --- a session -------------------------------------------------------------

flow('a client that connects gets the primary and the windows', async () => {
  const world = await started()

  await connected(world)

  assertEqual(world.mutter.primary, 'Meta-0')
  assertEqual(world.where(), ON_META_0)
})

flow(
  'the windows go back where they were when the client disconnects',
  async () => {
    const world = await started()
    await connected(world)
    assertEqual(world.where(), ON_META_0)

    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)

    assertEqual(world.where(), HOME)
  },
)

flow(
  'with the restore off, the windows stay where Mutter parked them',
  async () => {
    const world = await started()
    world.config.restoreOnDisconnect = false
    await connected(world)
    assertEqual(world.where(), ON_META_0)

    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)

    assertEqual(world.where(), { a: 'DP-1', b: 'DP-1' })
  },
)

flow(
  'with make-primary off, the windows are gathered and the primary stays',
  async () => {
    const world = await started()
    world.config.makePrimary = false

    await connected(world)

    assertEqual(world.calls.applies, [
      { connector: 'Meta-0', makePrimary: false },
    ])
    assertEqual(world.mutter.primary, 'DP-1')
    assertEqual(world.where(), ON_META_0)
  },
)

flow('with gathering off, no window moves and none is put back', async () => {
  const world = await started()
  world.config.gatherMode = 'off'
  await connected(world)
  const during = world.where()

  world.mutter.disconnect('Meta-0')
  await world.wait(DEBOUNCE)

  assertEqual(during, HOME)
  assertEqual(world.mutter.primary, 'DP-1')
  assertEqual(world.where(), HOME)
})

flow(
  'gathering from the current workspace moves the windows the snapshot puts there',
  async () => {
    const world = await started({
      windows: { a: 'DP-1', b: 'DP-1', c: 'DP-2' },
      workspaces: { a: 0, b: 1, c: 'none' },
    })
    world.config.gatherMode = 'current-workspace'

    await connected(world)

    assertEqual(world.where(), { a: 'Meta-0', b: 'DP-1', c: 'Meta-0' })
  },
)

flow(
  'gathering from the current workspace uses the workspace active at the snapshot',
  async () => {
    const world = await started({ workspaces: { a: 0, b: 1 } })
    world.config.gatherMode = 'current-workspace'
    world.control.holdApplies = true
    world.mutter.connect('Meta-0', '0x000001')
    await world.wait(DEBOUNCE)
    // An empty dynamic workspace going away renumbers the active one.
    world.control.activeWorkspace = 1
    only(world.control.heldApplies).resolve('changed')
    await world.wait(DEBOUNCE)

    assertEqual(world.where(), { a: 'Meta-0', b: 'DP-2' })
  },
)

flow('each step reads its setting when it runs', async () => {
  const world = await started()
  world.control.holdApplies = true
  world.mutter.connect('Meta-0', '0x000001')
  world.config.makePrimary = false
  await world.wait(DEBOUNCE)
  world.config.gatherMode = 'off'
  only(world.control.heldApplies).resolve('skipped')
  await world.wait(0)

  assertEqual(world.calls.applies, [
    { connector: 'Meta-0', makePrimary: false },
  ])
  assertEqual(world.where(), HOME)
})

flow(
  'a client present at enable gets a session from the windows as they are then',
  async () => {
    const world = newWorld({
      clients: [{ connector: 'Meta-0', serial: '0x000001' }],
    })
    world.session.begin(false)
    await world.wait(DEBOUNCE)
    assertEqual(world.where(), ON_META_0)

    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)

    assertEqual(world.where(), HOME)
  },
)

// --- the placement record --------------------------------------------------

flow(
  'a window the user moved before the session goes back to its new place',
  async () => {
    const world = await started()
    world.desk.move(world.desk.byName('b'), 'DP-1')
    await world.wait(SETTLE)
    await connected(world)

    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)

    assertEqual(world.where(), { a: 'DP-1', b: 'DP-1' })
  },
)

for (const movesFirst of [true, false]) {
  const order = movesFirst ? 'before' : 'after'
  flow(
    `a window Mutter moves while a client connects goes back to where it was before (moves ${order} the signal)`,
    async () => {
      const world = await started({ movesFirst })

      world.mutter.connect('Meta-0', '0x000001', { b: 'DP-1' })
      await world.wait(2 * DEBOUNCE)
      world.mutter.disconnect('Meta-0')
      await world.wait(DEBOUNCE)

      assertEqual(world.where(), HOME)
    },
  )
}

flow(
  'a move still settling when the monitors change is recorded after the check',
  async () => {
    const world = await started()
    world.desk.move(world.desk.byName('b'), 'DP-1')
    await world.wait(SETTLE / 2)
    world.session.monitorsChanged()
    await world.wait(DEBOUNCE + SETTLE)

    await connected(world)
    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)

    assertEqual(world.where(), { a: 'DP-1', b: 'DP-1' })
  },
)

flow('the record follows an undock that starts no session', async () => {
  const world = await started()
  world.mutter.unplug('DP-2')
  await world.wait(DEBOUNCE + SETTLE)

  await connected(world)
  world.mutter.disconnect('Meta-0')
  await world.wait(DEBOUNCE)

  assertEqual(world.where(), { a: 'DP-1', b: 'DP-1' })
})

flow(
  'a move still settling when the screen locks is recorded after the unlock',
  async () => {
    const world = await started()
    world.desk.move(world.desk.byName('b'), 'DP-1')
    await world.wait(SETTLE / 2)
    world.session.lockChanged(true)
    await world.wait(DEBOUNCE)
    world.session.lockChanged(false)
    await world.wait(DEBOUNCE + SETTLE)

    await connected(world)
    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)

    assertEqual(world.where(), { a: 'DP-1', b: 'DP-1' })
  },
)

flow(
  'a gathered window that closes during the session is skipped at restore',
  async () => {
    const world = await started()
    await connected(world)
    world.desk.close('b')

    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)

    assertEqual(world.where(), { a: 'DP-1' })
  },
)

flow('only the windows that were gathered are put back', async () => {
  const world = await started()
  await connected(world)
  world.desk.open('c', 'Meta-0')

  world.mutter.disconnect('Meta-0')
  await world.wait(DEBOUNCE)

  assertEqual(world.where(), { ...HOME, c: 'DP-1' })
})

// --- gathering and the apply -----------------------------------------------

flow(
  'gathering waits one debounce period for a layout change that never comes',
  async () => {
    const world = await started({ emitOnApply: false })
    world.mutter.connect('Meta-0', '0x000001')
    await world.wait(DEBOUNCE)

    await world.wait(DEBOUNCE - 1)
    const before = world.where()
    await world.wait(1)

    assertEqual(before, HOME)
    assertEqual(world.where(), ON_META_0)
  },
)

flow(
  'nothing is gathered if the primary has left the client before the gather',
  async () => {
    const world = await started()
    world.control.holdApplies = true
    world.mutter.connect('Meta-0', '0x000001')
    await world.wait(DEBOUNCE)
    const apply = only(world.control.heldApplies)

    // Mutter makes Meta-0 primary and the user moves the primary back, both
    // before the apply's reply. The check that follows and the gather's timeout
    // fall due together. The check's timer was added first, so it runs first,
    // as in GLib.
    world.mutter.setPrimary('Meta-0')
    world.mutter.setPrimary('DP-1')
    apply.resolve('changed')
    await world.wait(2 * DEBOUNCE)

    assertEqual(world.calls.gathers, 0)
    assertEqual(world.where(), HOME)
  },
)

flow('a failed apply is tried again after one debounce period', async () => {
  const world = await started()
  world.control.applyFailures = 1
  world.mutter.connect('Meta-0', '0x000001')
  await world.wait(DEBOUNCE)

  await world.wait(DEBOUNCE - 1)
  const before = world.calls.applies.length
  await world.wait(1)

  assertEqual(before, 1)
  assertEqual(world.calls.applies.length, 2)
  assertEqual(world.takeLog('warn'), [
    'making Meta-0 primary failed, retrying once: stale serial',
  ])
})

flow(
  'a failed apply is tried again at the next monitor check if that comes first',
  async () => {
    const world = await started()
    world.control.holdApplies = true
    world.mutter.connect('Meta-0', '0x000001')
    await world.wait(DEBOUNCE)
    const first = only(world.control.heldApplies)

    // The apply fails half a debounce period after a monitor change, so the
    // check is due half a period before the retry timer.
    world.session.monitorsChanged()
    await world.wait(DEBOUNCE / 2)
    first.reject(new Error('stale serial'))
    await world.wait(DEBOUNCE / 2)

    assertEqual(world.calls.applies.length, 2)
    assertEqual(world.takeLog('warn'), [
      'making Meta-0 primary failed, retrying once: stale serial',
    ])
  },
)

flow('after a second failed apply the session moves nothing', async () => {
  const world = await started()
  world.control.applyFailures = 2

  await connected(world)
  await world.wait(3 * DEBOUNCE)

  assertEqual(world.calls.applies.length, 2)
  assertEqual(world.where(), HOME)
  assertEqual(world.takeLog('warn'), [
    'making Meta-0 primary failed, retrying once: stale serial',
  ])
  assertEqual(world.takeLog('error'), [
    'making Meta-0 primary failed again, standing aside',
  ])
})

flow(
  'a window gathered in an earlier session is not put back after a later one',
  async () => {
    const world = await started()
    await connected(world)
    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)
    world.config.gatherMode = 'off'
    world.mutter.connect('Meta-1', '0x000002')
    await world.wait(2 * DEBOUNCE)

    // Not gathered this time: the user moves it onto the client's monitor.
    world.desk.move(world.desk.byName('b'), 'Meta-1')
    world.mutter.disconnect('Meta-1')
    await world.wait(DEBOUNCE)

    assertEqual(world.where(), { a: 'DP-1', b: 'DP-1' })
  },
)

flow(
  'taking the primary back leaves the layout and the windows alone',
  async () => {
    const world = await started()
    await connected(world)

    world.mutter.setPrimary('DP-1')
    await world.wait(DEBOUNCE)
    world.mutter.setPrimary('Meta-0')
    await world.wait(DEBOUNCE)
    world.mutter.setPrimary('DP-1')
    await world.wait(DEBOUNCE)

    assertEqual(world.calls.applies.length, 1)
    assertEqual(world.calls.gathers, 1)
    assertEqual(world.mutter.primary, 'DP-1')
  },
)

flow(
  'a gather that throws is logged and the session still ends with the client',
  async () => {
    const world = await started()
    world.control.gatherThrows = true
    await connected(world)
    world.control.gatherThrows = false

    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)
    world.mutter.connect('Meta-1', '0x000002')
    await world.wait(2 * DEBOUNCE)

    assertEqual(world.takeLog('error'), ['gathering windows failed'])
    assertEqual(world.where(), { a: 'Meta-1', b: 'Meta-1' })
  },
)

flow(
  'a window that cannot be gathered is logged, stays and is not put back',
  async () => {
    const world = await started()
    world.control.stuck.add('b')
    await connected(world)
    const during = world.where()

    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)

    assertEqual(during, { a: 'Meta-0', b: 'DP-2' })
    assertEqual(world.takeLog('error'), ['gathering b failed'])
    assertEqual(world.calls.restores, 1)
    assertEqual(world.where(), HOME)
  },
)

flow(
  'a window that cannot be put back is logged and the others still are',
  async () => {
    const world = await started()
    await connected(world)
    world.control.stuck.add('a')

    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)

    assertEqual(world.takeLog('error'), ['restoring a failed'])
    assertEqual(world.where(), { a: 'DP-1', b: 'DP-2' })
  },
)

flow(
  'a window whose monitor went during the session stays put and is logged',
  async () => {
    const world = await started()
    await connected(world)
    world.mutter.unplug('DP-2')
    await world.wait(DEBOUNCE)

    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)

    assertEqual(world.where(), { a: 'DP-1', b: 'DP-1' })
    assertEqual(world.takeLog('warn'), [
      'b: its original monitor is gone, left where it is',
    ])
  },
)

// --- several clients -------------------------------------------------------

flow('a second client that connects during a session is ignored', async () => {
  const world = await started()
  await connected(world)

  world.mutter.connect('Meta-1', '0x000002')
  await world.wait(2 * DEBOUNCE)

  assertEqual(world.calls.applies.length, 1)
  assertEqual(world.mutter.primary, 'Meta-0')
  assertEqual(world.where(), ON_META_0)
})

flow(
  'a client still connected when a session ends gets a session of its own',
  async () => {
    const world = await started()
    await connected(world)
    world.mutter.connect('Meta-1', '0x000002')
    await world.wait(DEBOUNCE)

    world.mutter.disconnect('Meta-0')
    await world.wait(3 * DEBOUNCE)

    assertEqual(world.mutter.primary, 'Meta-1')
    assertEqual(world.where(), { a: 'Meta-1', b: 'Meta-1' })
  },
)

flow(
  'a client that comes back within one monitor check takes over the windows',
  async () => {
    const world = await started()
    await connected(world)

    world.mutter.disconnect('Meta-0')
    world.mutter.connect('Meta-1', '0x000002')
    await world.wait(2 * DEBOUNCE)

    assertEqual(world.calls.restores, 0)
    assertEqual(world.mutter.primary, 'Meta-1')
    assertEqual(world.where(), { a: 'Meta-1', b: 'Meta-1' })
  },
)

flow(
  'after such a takeover the windows still go back to their places from before',
  async () => {
    const world = await started()
    await connected(world)
    world.mutter.disconnect('Meta-0')
    world.mutter.connect('Meta-1', '0x000002')
    await world.wait(2 * DEBOUNCE)

    world.mutter.disconnect('Meta-1')
    await world.wait(DEBOUNCE)

    assertEqual(world.where(), HOME)
  },
)

// --- monitor checks --------------------------------------------------------

flow('a burst of monitor changes runs one monitor check', async () => {
  const world = await started()
  const before = world.calls.checks

  world.mutter.connect('Meta-0', '0x000001')
  await world.wait(DEBOUNCE / 2)
  world.session.monitorsChanged()
  await world.wait(DEBOUNCE / 2)
  world.session.monitorsChanged()
  await world.wait(DEBOUNCE)

  assertEqual(world.calls.checks - before, 1)
})

flow(
  'a check overtaken by a monitor change is dropped for the one that follows',
  async () => {
    const world = await started()
    world.control.holdChecks = true
    world.mutter.connect('Meta-0', '0x000001')
    await world.wait(DEBOUNCE)
    const stale = only(world.control.heldChecks)

    world.session.monitorsChanged()
    stale.resolve(world.mutter.remotesNow())
    await world.wait(0)
    const appliesAfterStale = world.calls.applies.length
    world.control.holdChecks = false
    await world.wait(DEBOUNCE)

    assertEqual(appliesAfterStale, 0)
    assertEqual(world.calls.applies.length, 1)
  },
)

flow(
  'an unlock during the quiet period after a monitor change runs one check',
  async () => {
    const world = await started()
    world.session.lockChanged(true)
    const before = world.calls.checks

    world.mutter.connect('Meta-0', '0x000001')
    await world.wait(DEBOUNCE / 2)
    world.session.lockChanged(false)
    await world.wait(DEBOUNCE)

    assertEqual(world.calls.checks - before, 1)
  },
)

flow('a failed monitor check is logged and changes nothing', async () => {
  const world = await started()
  world.control.failChecks = true

  world.mutter.connect('Meta-0', '0x000001')
  await world.wait(DEBOUNCE)

  assertEqual(world.calls.applies, [])
  assertEqual(world.takeLog('warn'), ['monitor check failed: no reply'])
})

// --- the lock screen -------------------------------------------------------

flow('an enable while the screen is locked waits for the unlock', async () => {
  const world = newWorld({
    clients: [{ connector: 'Meta-0', serial: '0x000001' }],
  })
  world.session.begin(true)
  await world.wait(2 * DEBOUNCE)
  const checksWhileLocked = world.calls.checks

  world.session.lockChanged(false)
  await world.wait(DEBOUNCE)

  assertEqual(checksWhileLocked, 0)
  assertEqual(world.where(), ON_META_0)
})

flow(
  'locking the screen cancels a monitor check in flight, whose reply is then ignored',
  async () => {
    const world = await started()
    world.control.holdChecks = true
    world.mutter.connect('Meta-0', '0x000001')
    await world.wait(DEBOUNCE)
    const check = only(world.control.heldChecks)

    world.session.lockChanged(true)
    await world.wait(0)

    assertTrue(check.cancelled, 'the check was cancelled')
    assertEqual(world.takeLog('warn'), [])
    assertEqual(world.calls.applies, [])
  },
)

flow(
  'a client that connects while the screen is locked is served at unlock',
  async () => {
    const world = await started()
    world.session.lockChanged(true)

    world.mutter.connect('Meta-0', '0x000001')
    await world.wait(2 * DEBOUNCE)
    const appliesWhileLocked = world.calls.applies.length
    world.session.lockChanged(false)
    await world.wait(2 * DEBOUNCE)

    assertEqual(appliesWhileLocked, 0)
    assertEqual(world.where(), ON_META_0)
  },
)

flow(
  'a client that connects while locked starts from the placements recorded before the lock',
  async () => {
    const world = await started()
    world.session.lockChanged(true)
    world.mutter.connect('Meta-0', '0x000001', { b: 'DP-1' })
    await world.wait(DEBOUNCE)
    world.session.lockChanged(false)
    await world.wait(2 * DEBOUNCE)

    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)

    assertEqual(world.where(), HOME)
  },
)

flow(
  'a client that disconnects while the screen is locked has its windows put back at unlock',
  async () => {
    const world = await started()
    await connected(world)
    world.session.lockChanged(true)

    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)
    const whileLocked = world.where()
    world.session.lockChanged(false)
    await world.wait(0)

    assertEqual(whileLocked, { a: 'DP-1', b: 'DP-1' })
    assertEqual(world.where(), HOME)
  },
)

flow(
  'a gather that waits for the layout goes ahead while the screen is locked',
  async () => {
    const world = await started({ emitOnApply: false })
    world.mutter.connect('Meta-0', '0x000001')
    await world.wait(DEBOUNCE)

    world.session.lockChanged(true)
    await world.wait(DEBOUNCE)

    assertEqual(world.where(), ON_META_0)
  },
)

flow(
  'a client gone at a check while locked has its apply cancelled and nothing moved',
  async () => {
    const world = await started()
    world.control.holdApplies = true
    world.mutter.connect('Meta-0', '0x000001')
    await world.wait(DEBOUNCE)
    const apply = only(world.control.heldApplies)
    world.session.lockChanged(true)

    world.mutter.disconnect('Meta-0')
    await world.wait(DEBOUNCE)
    const cancelledWhileLocked = apply.cancelled
    world.session.lockChanged(false)
    await world.wait(DEBOUNCE)

    assertTrue(
      cancelledWhileLocked,
      'the apply was cancelled at the locked check',
    )
    assertEqual(world.where(), HOME)
    assertEqual(world.takeLog('error'), [])
    assertEqual(world.takeLog('warn'), [])
  },
)

// --- disable ---------------------------------------------------------------

flow('stopping puts the gathered windows back at once', async () => {
  const world = await started()
  await connected(world)
  assertEqual(world.where(), ON_META_0)

  world.session.stop()

  assertEqual(world.where(), HOME)
})

flow(
  'stopping puts the gathered windows back even with the restore off',
  async () => {
    const world = await started()
    world.config.restoreOnDisconnect = false
    await connected(world)
    assertEqual(world.where(), ON_META_0)

    world.session.stop()

    assertEqual(world.where(), HOME)
  },
)

flow('stopping leaves no timer of the session behind', async () => {
  const world = await started({ emitOnApply: false })
  world.mutter.connect('Meta-0', '0x000001')
  await world.wait(DEBOUNCE)
  world.session.monitorsChanged()
  assertTrue(world.clock.pending > 0, 'timers run before the stop')

  world.session.stop()

  assertEqual(world.clock.pending, 0)
})

flow('stopping cancels a monitor check in flight', async () => {
  const world = await started()
  world.control.holdChecks = true
  world.mutter.connect('Meta-0', '0x000001')
  await world.wait(DEBOUNCE)
  const check = only(world.control.heldChecks)

  world.session.stop()
  await world.wait(0)

  assertTrue(check.cancelled, 'the check was cancelled')
})

flow(
  'stopping while a failed apply waits for its retry leaves no timer',
  async () => {
    const world = await started()
    world.control.applyFailures = 1
    world.mutter.connect('Meta-0', '0x000001')
    await world.wait(DEBOUNCE)
    assertEqual(world.takeLog('warn'), [
      'making Meta-0 primary failed, retrying once: stale serial',
    ])
    assertTrue(world.clock.pending > 0, 'the retry timer runs')

    world.session.stop()

    assertEqual(world.clock.pending, 0)
  },
)

flow('stopping during an apply cancels it and nothing follows', async () => {
  const world = await started()
  world.control.holdApplies = true
  world.mutter.connect('Meta-0', '0x000001')
  await world.wait(DEBOUNCE)
  const apply = only(world.control.heldApplies)

  world.session.stop()
  await world.wait(2 * DEBOUNCE)

  assertTrue(apply.cancelled, 'the apply was cancelled')
  assertEqual(world.calls.gathers, 0)
  assertEqual(world.takeLog('warn'), [])
  assertEqual(world.takeLog('error'), [])
})
