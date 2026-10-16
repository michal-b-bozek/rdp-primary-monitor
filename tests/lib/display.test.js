// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * src/lib/display.js over D-Bus, against a fake Mutter (tests/bus.js) that
 * answers with the replies captured on GNOME Shell 49 and 50: what a monitor
 * check reads, the `ApplyMonitorsConfig` call it makes, and how failures and
 * cancellation come back.
 */

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import {
  applyPrimary,
  isCancelled,
  readRemoteMonitors,
} from '../../src/lib/display.js'
import { withFakeMutter } from '../bus.js'
import { RELEASES, applyArgs, displayState } from '../fixtures.js'
import { assertEqual, assertTrue, test } from '../harness.js'

/** `ApplyMonitorsConfig`'s temporary method, never written to monitors.xml. */
const TEMPORARY = 1

/**
 * @param {Promise<unknown>} promise
 * @returns {Promise<unknown>} What `promise` rejected with; throws if it
 *   resolved.
 */
async function rejection(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

/**
 * @param {Promise<unknown>} promise
 * @returns {Promise<Error>} The Error `promise` rejected with; throws if it
 *   resolved or rejected with something else.
 */
async function errorFrom(promise) {
  const error = await rejection(promise)
  if (!(error instanceof Error)) {
    throw new Error(`expected an Error, got ${String(error)}`)
  }
  return error
}

for (const release of RELEASES) {
  test(`${release}: a monitor check reads the client's monitor, not yet primary`, async () => {
    await withFakeMutter(displayState(release, 'connected'), async (mutter) => {
      assertEqual(await readRemoteMonitors(mutter.proxy, null), [
        { connector: 'Meta-0', serial: '0x000001', primary: false },
      ])
    })
  })

  test(`${release}: a monitor check reads the client's monitor as primary after the apply`, async () => {
    await withFakeMutter(
      displayState(release, 'primary-applied'),
      async (mutter) => {
        assertEqual(await readRemoteMonitors(mutter.proxy, null), [
          { connector: 'Meta-0', serial: '0x000001', primary: true },
        ])
      },
    )
  })

  test(`${release}: the apply sends the captured call, temporary, with the state's serial`, async () => {
    const state = displayState(release, 'connected')
    await withFakeMutter(state, async (mutter) => {
      const result = await applyPrimary(mutter.proxy, 'Meta-0', true, null)

      const expected = applyArgs(release)
      assertEqual(result, 'changed')
      assertEqual(mutter.applied.length, 1)
      const [call] = mutter.applied
      if (call === undefined) throw new Error('no call was sent')
      assertEqual(
        call.get_child_value(0).get_uint32(),
        state.get_child_value(0).get_uint32(),
      )
      assertEqual(call.get_child_value(1).get_uint32(), TEMPORARY)
      assertTrue(
        call.get_child_value(2).equal(expected.get_child_value(0)) &&
          call.get_child_value(3).equal(expected.get_child_value(1)),
        `sent ${call.print(true)}\n  expected ${expected.print(true)}`,
      )
    })
  })

  test(`${release}: no call is sent when the monitor is primary already`, async () => {
    await withFakeMutter(
      displayState(release, 'primary-applied'),
      async (mutter) => {
        const result = await applyPrimary(mutter.proxy, 'Meta-0', true, null)

        assertEqual(result, 'primaryAlready')
        assertEqual(mutter.applied.length, 0)
      },
    )
  })
}

test('no call is sent with make-primary off', async () => {
  await withFakeMutter(displayState('gnome49', 'connected'), async (mutter) => {
    const result = await applyPrimary(mutter.proxy, 'Meta-0', false, null)

    assertEqual(result, 'skipped')
    assertEqual(mutter.applied.length, 0)
  })
})

test("Mutter's rejection comes back as an error with Mutter's error as its cause", async () => {
  await withFakeMutter(displayState('gnome49', 'connected'), async (mutter) => {
    mutter.failApply('org.freedesktop.DBus.Error.InvalidArgs')

    const error = await errorFrom(
      applyPrimary(mutter.proxy, 'Meta-0', true, null),
    )

    assertTrue(
      error.message.startsWith('ApplyMonitorsConfig:'),
      `names the call: ${error.message}`,
    )
    assertTrue(error.cause instanceof GLib.Error, "carries Mutter's error")
    assertTrue(!isCancelled(error), 'is not a cancellation')
  })
})

test('a monitor that is in no logical monitor is not applied', async () => {
  await withFakeMutter(displayState('gnome49', 'idle'), async (mutter) => {
    const error = await errorFrom(
      applyPrimary(mutter.proxy, 'Meta-0', true, null),
    )

    assertTrue(
      error.message.includes('in no logical monitor'),
      `got ${error.message}`,
    )
    assertEqual(mutter.applied.length, 0)
  })
})

test('a cancelled call is reported as cancelled and sends nothing', async () => {
  await withFakeMutter(displayState('gnome49', 'connected'), async (mutter) => {
    mutter.holdReads(true)
    const cancellable = new Gio.Cancellable()
    const pending = applyPrimary(mutter.proxy, 'Meta-0', true, cancellable)

    cancellable.cancel()
    const error = await rejection(pending)
    mutter.holdReads(false)

    assertTrue(isCancelled(error), `got ${String(error)}`)
    assertEqual(mutter.applied.length, 0)
  })
})
