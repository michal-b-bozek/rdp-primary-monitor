// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * The placement record (docs/design.md, The placement record; ADR-0004
 * part 1): where each normal window last settled, on plain data. The caller
 * reports window changes and monitor bursts, and supplies the timers and the
 * read of a window, so this module imports nothing from GNOME.
 */

/** @import { WindowRecord } from './windows.js' */

/**
 * One-shot timers. A timer that has fired is gone; `remove` is called only for
 * timers that have not fired.
 *
 * @typedef {object} Timers
 * @property {(ms: number, callback: () => void) => number} add Start a timer;
 *   returns its id.
 * @property {(id: number) => void} remove Stop a timer that has not fired.
 */

/**
 * Where each window last settled. A change is committed only in Idle with
 * the screen unlocked, once the window has been still for the settle period.
 * The caller replaces the record with `rebuild()` on entering Idle.
 *
 * @template W The window handle.
 */
export class PlacementRecord {
  /** @type {Map<W, WindowRecord>} */
  #committed = new Map()
  /** @type {Map<W, number>} Windows with a change waiting to settle, and its timer. */
  #pending = new Map()
  /** @type {Set<W>} Windows to read again after the next monitor check. */
  #reread = new Set()
  #idle = false
  #locked = false
  #paused = false
  /** Counts monitor bursts and unlocks, so a check can tell if it is stale. */
  #burst = 0
  #read
  #settleMs
  #timers

  /**
   * The record starts outside Idle with the screen unlocked; the caller
   * reports the lock state with `setLocked()` before it reports Idle.
   *
   * @param {(window: W) => WindowRecord | null} read Read a window now; null
   *   for a window the record does not hold (not a normal window, closed, or
   *   on no present monitor).
   * @param {() => number} settleMs The `settle-ms` setting, read each time a
   *   timer starts.
   * @param {Timers} timers
   */
  constructor(read, settleMs, timers) {
    this.#read = read
    this.#settleMs = settleMs
    this.#timers = timers
  }

  /**
   * Replace the record with a fresh read of every normal window, as on
   * `enable()` and on entering Idle. Uncommitted changes are dropped: the read
   * already shows them.
   *
   * @param {ReadonlyMap<W, WindowRecord>} records
   * @returns {void}
   */
  rebuild(records) {
    this.#dropPending()
    this.#reread.clear()
    this.#committed = new Map(records)
  }

  /**
   * Whether the extension is in Idle. Leaving Idle drops every uncommitted
   * change and every window waiting to be read again, since entering Idle
   * rebuilds the record.
   *
   * @param {boolean} idle
   * @returns {void}
   */
  setIdle(idle) {
    this.#idle = idle
    if (idle) return
    this.#dropPending()
    this.#reread.clear()
  }

  /**
   * Whether the screen is locked. A lock works like a monitor burst that
   * lasts until the unlock check:
   *
   * - Locking discards the changes not yet committed.
   * - Those windows, and the ones that change while locked, are read again
   *   after the unlock check.
   * - Report the unlock before the unlock check starts. It pauses commits
   *   until that check.
   *
   * See ADR-0005 part 2.
   *
   * @param {boolean} locked
   * @returns {void}
   */
  setLocked(locked) {
    if (locked) {
      this.#deferPending()
    } else if (this.#locked) {
      this.#burst++
      this.#paused = true
    }
    this.#locked = locked
  }

  /**
   * A window's placement may have changed: it moved, resized, changed
   * workspace, maximized, fullscreen or minimized state, appeared, or became
   * one the record holds.
   *
   * - Outside Idle, the change is ignored.
   * - While the screen is locked or commits are paused (a monitor burst, or an
   *   unlock before its check), the window waits for the next check that is
   *   not stale (the unlock check, if the screen is locked). It is read again
   *   only if that check leaves the extension in Idle.
   * - Otherwise the window is committed once it has been still for the settle
   *   period.
   *
   * @param {W} window
   * @returns {void}
   */
  changed(window) {
    if (!this.#idle) return
    if (this.#locked || this.#paused) {
      this.#reread.add(window)
      return
    }
    this.#cancel(window)
    const id = this.#timers.add(this.#settleMs(), () => {
      this.#commit(window)
    })
    this.#pending.set(window, id)
  }

  /**
   * A window closed or stopped being one the record holds. Applies in every
   * state, since it drops a window and records no placement
   * (ADR-0005 part 2).
   *
   * @param {W} window
   * @returns {void}
   */
  removed(window) {
    this.#cancel(window)
    this.#reread.delete(window)
    this.#committed.delete(window)
  }

  /**
   * A raw `monitors-changed`. Discards every change not yet committed and
   * pauses commits until the caller reports the monitor check that follows
   * with `checked()`, so moves Mutter makes during a monitor change cannot
   * reach the record. A check that fails reports nothing, so the record stays
   * paused until a later check reports.
   *
   * @returns {void}
   */
  monitorsChanged() {
    this.#burst++
    this.#paused = true
    this.#deferPending()
  }

  /**
   * @returns {number} The burst a monitor check starting now answers; pass it
   *   to `checked()` when the check has run.
   */
  get burst() {
    return this.#burst
  }

  /**
   * A monitor check has run. Call it after reporting the check's transition
   * through `setIdle()`.
   *
   * - A check that started before the latest burst or unlock is stale and
   *   changes nothing. The check that follows it answers.
   * - A check while the screen is locked keeps the windows to read again for
   *   the unlock check.
   * - Otherwise each window to read again goes through `changed()`, which
   *   ignores it outside Idle.
   *
   * @param {number} burst The `burst` value read when the check started.
   * @returns {void}
   */
  checked(burst) {
    if (burst !== this.#burst) return
    this.#paused = false
    if (this.#locked) return
    const windows = [...this.#reread]
    this.#reread.clear()
    for (const window of windows) this.changed(window)
  }

  /**
   * @returns {Map<W, WindowRecord>} A copy of the committed record, for the
   *   session's snapshot.
   */
  snapshot() {
    return new Map(this.#committed)
  }

  /**
   * Stop every timer and forget everything, for `disable()`.
   *
   * @returns {void}
   */
  destroy() {
    this.setIdle(false)
    this.#committed.clear()
    this.#locked = false
    this.#paused = false
  }

  /**
   * @param {W} window
   * @returns {void}
   */
  #commit(window) {
    this.#pending.delete(window)
    const record = this.#read(window)
    if (record === null) this.#committed.delete(window)
    else this.#committed.set(window, record)
  }

  /**
   * @param {W} window
   * @returns {void}
   */
  #cancel(window) {
    const id = this.#pending.get(window)
    if (id === undefined) return
    this.#timers.remove(id)
    this.#pending.delete(window)
  }

  /**
   * Move the changes waiting to settle to the windows to read again.
   *
   * @returns {void}
   */
  #deferPending() {
    for (const window of this.#pending.keys()) this.#reread.add(window)
    this.#dropPending()
  }

  /** @returns {void} */
  #dropPending() {
    for (const id of this.#pending.values()) this.#timers.remove(id)
    this.#pending.clear()
  }
}
