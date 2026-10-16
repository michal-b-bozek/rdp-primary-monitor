// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * Stand-ins for the boundaries src/lib/ takes as ports: a clock whose timers
 * fire only when a test advances it, and a call whose outcome the test
 * decides.
 */

import GLib from 'gi://GLib'

/** @import { Timers } from '../src/lib/placement.js' */

/**
 * One-shot timers on a clock that moves only in `advance()`. Removing a timer
 * that fired or was never added throws, as `Timers` forbids it.
 */
export class FakeClock {
  #now = 0
  #nextId = 1
  /** @type {Map<number, { at: number, callback: () => void }>} */
  #timers = new Map()

  /** @type {Timers} */
  timers = {
    add: (ms, callback) => {
      const id = this.#nextId++
      this.#timers.set(id, { at: this.#now + ms, callback })
      return id
    },
    remove: (id) => {
      if (!this.#timers.delete(id)) throw new Error(`no timer ${String(id)}`)
    },
  }

  /** @returns {number} Timers that have neither fired nor been removed. */
  get pending() {
    return this.#timers.size
  }

  /**
   * Move the clock `ms` forward, firing each timer that falls due, in the
   * order they fall due (and were added, for the same moment), and letting
   * the promises a callback starts settle before the next one fires.
   *
   * @param {number} ms
   * @returns {Promise<void>} Settles when the clock has arrived.
   */
  async advance(ms) {
    const end = this.#now + ms
    await settle()
    for (;;) {
      const due = [...this.#timers]
        .filter(([, timer]) => timer.at <= end)
        .sort(([a, x], [b, y]) => x.at - y.at || a - b)[0]
      if (due === undefined) break
      const [id, timer] = due
      this.#timers.delete(id)
      this.#now = timer.at
      timer.callback()
      await settle()
    }
    this.#now = end
  }
}

/**
 * Let every promise that can settle now do so: GJS runs all pending promise
 * jobs before the main loop dispatches an idle.
 *
 * @returns {Promise<void>} Settles on the next idle.
 */
export function settle() {
  return new Promise((resolve) => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      resolve()
      return GLib.SOURCE_REMOVE
    })
  })
}

/**
 * A pending call the test ends: `resolve` or `reject` its result; `cancelled`
 * tells whether the code under test cancelled it. Cancelling rejects the
 * result, as a cancelled `Gio.Cancellable` makes a D-Bus call do.
 *
 * @template T
 */
export class Deferred {
  cancelled = false
  /** @type {(value: T) => void} */
  resolve = () => undefined
  /** @type {(error: unknown) => void} */
  reject = () => undefined
  /** @type {Promise<T>} */
  result = new Promise((resolve, reject) => {
    this.resolve = resolve
    this.reject = reject
  })

  /** @returns {void} */
  cancel = () => {
    this.cancelled = true
    this.reject(new Error('Operation was cancelled'))
  }
}
