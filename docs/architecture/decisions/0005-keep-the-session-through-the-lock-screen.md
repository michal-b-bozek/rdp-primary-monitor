# 5. Keep the session through the lock screen

- **Status:** accepted; Last amended: 2026-10-14
- **Date:** 2026-10-13
- **Deciders:** Michał Bogusław Bożek (maintainer)
- **Related:** builds on [ADR-0002](0002-match-the-virtual-monitor.md) (part 3, the reconnect),
  [ADR-0003](0003-apply-the-primary-temporarily.md) and
  [ADR-0004](0004-snapshot-and-restore-windows.md) (part 4's restore, part 5's `disable()`).

## Context

The screen locks when the user at the workstation locks it, after the idle timeout, or from the
remote side. On the maintainer's workstation, the "Allow Locked Remote Desktop" extension also lets
an RDP client connect while the screen is locked, so a virtual monitor can appear, or go, behind the
lock.

- **Locking disables extensions that do not ask to stay.** GNOME Shell runs an extension only in the
  session modes its `metadata.json` lists under `session-modes`. With the default (`user` only) it
  calls `disable()` when the screen locks and `enable()` again at unlock (gjs.guide, the extension
  session modes). Under ADR-0004, that `disable()` would put every gathered window back while the
  screen is locked, and the `enable()` at unlock would gather them again.
- **Work behind the lock is invisible and hard to check.** While the screen is locked, the windows
  are hidden; a gather or a restore that runs then cannot be watched, and its result is what the
  user meets at unlock. A placement record updated then would hold states the user never saw.
  Mutter's own fallback still acts. In the spike (ADR-0004), Mutter parked the gathered windows on
  the remaining primary on disconnect; behind the lock this is expected, not yet observed.
- **A session can start or end during the lock.** With "Allow Locked Remote Desktop", a client
  can connect, disconnect, or both, while the screen is locked; the extension has to know at unlock
  what happened.

## Decision

### 1. Run in `user` and `unlock-dialog`

`metadata.json` lists `session-modes` `user` and `unlock-dialog`, so locking does not disable the
extension and a session survives the lock: the windows stay gathered, the temporary primary stays,
and the snapshot is kept. The extension draws nothing, so it shows nothing on the lock screen.

> **Amendment (2026-10-14).** Part 1 does not always hold. Before enabling the extensions at login,
> GNOME Shell 49 and 50 sort them by the number of session modes they list, most first
> (`_compareExtensions`, used by `_getEnabledExtensions` and `_loadExtensions` in
> `js/ui/extensionSystem.js`). This extension lists two, so it is enabled before every extension
> that lists `user` only, and a lock after login does not disable it. An extension enabled during
> the session (turned on, installed or reloaded) goes to the end of the order
> (`_callExtensionEnable`). When the screen locks, the Shell disables every extension that does not
> list `unlock-dialog`, and for each of them first disables, then enables again, every extension
> enabled after it (`_callExtensionDisableWithRebase`). So at the first lock after this extension
> was enabled during the session, its `disable()` runs, once for each such extension enabled before
> it: the gathered windows go back behind the lock, the snapshot is dropped, and the last `enable()`
> waits for unlock and gathers them again, so the remote user's arrangement is lost. After that
> unlock this extension comes before those extensions again, so later locks keep the session. The
> Shell does the same whenever an extension enabled before this one is turned off, locked or not;
> unlocked, the windows go back and are gathered again at once. In the test VMs (GNOME Shell 49.10
> and 50.5, this extension listed after two others in `enabled-extensions`), a lock after login left
> the extension running. After it was turned off and on again with `gnome-extensions`, the next lock
> made the Shell call its `disable()` and then `enable()`, as its debug log showed. A first reading
> the same day held that a lock right after login could also disable the extension; the sort rules
> that out. Found in the review of the extension's wiring (`src/lib/session.js`,
> `src/extension.js`); `docs/design.md`'s Lifecycle section, the first Good consequence and Tracked
> separately change with this.

> **Amendment (2026-10-14).** The extension does not carry a session across a `disable()` caused by
> the extension order: that `disable()` restores the gathered windows and drops the snapshot like
> any other (ADR-0004 part 5). The maintainer accepted this as a cost (Consequences). At a lock it
> matters only where the RDP session survives the lock, which it did not on GNOME Shell 49.10 and
> 50.5 in the test VMs (Tracked separately, the amendment on stock GNOME). Explicitly not keeping
> the snapshot and the gathered windows in module-level state that outlives `disable()`: the
> extensions.gnome.org review rule of full cleanup in `disable()` rules it out. Revisit if users who
> keep the RDP session through the lock report losing the remote arrangement. `docs/design.md`'s
> Lifecycle section changes with this.

Explicitly not `user` only: every lock would restore the gathered windows and every unlock would
gather them again. Explicitly not ending the session when the screen locks: the same restore and
re-gather, without the `disable()`. Revisit if the extensions.gnome.org review refuses the
`unlock-dialog` mode.

### 2. Start nothing while locked; finish what is under way

From lock to unlock the extension starts nothing: no apply, no gather, no restore, no update of the
placement record, and a pending monitor check is dropped. A restore that finishes while the screen
is locked enters Idle without rebuilding the record; the rebuild waits for unlock. A `disable()`
while the screen is locked still restores as ADR-0004 part 5 says, since nothing may outlive it.
Work already under way when the screen locks finishes: a Focusing apply with its one retry, the
gather that follows it, and a restore. [ADR-0003](0003-apply-the-primary-temporarily.md)'s rules do
not change; while the screen is locked, its retry (part 3) runs on the debounce timer.

> **Amendment (2026-10-14).** "No update of the placement record" means no new placements: a window
> that closes, or stops being a normal window, still leaves the record while the screen is locked.
> Dropping it records no state the user did not see, and keeping it would leave a window the record
> no longer covers in a later snapshot. Windows that changed while the screen was locked, or whose
> change was still settling when it locked, are read again once the unlock check has left the
> extension in Idle, so the record catches up on what the user can now see; this is a step after
> part 3's unlock check. An unlock check that starts a session reads nothing again, and a record
> kept through the lock keeps the layout from before it. The cost: a window moved within the settle
> period before the screen locks goes back to where it was before that move if a client connects
> during the lock. Found in the review of the placement record (`src/lib/placement.js`);
> `docs/design.md`'s Idle paragraph, placement record and Lifecycle sections change with this.

> **Amendment (2026-10-14).** Monitor checks keep running while the screen is locked, but only to
> follow the session's own monitor: they note no arrivals and start nothing. In Focusing, such a
> check lets the gather that waits for the apply's layout change go ahead, which is work under way,
> or ends Focusing in Dismissed if the primary has already left the session's monitor (ADR-0003 part
> 4). If it finds the session's monitor gone, it cancels the apply, retry or gather still pending:
> "work already under way finishes" holds only while that monitor is present, since with it gone
> there is nothing to apply or gather onto. The rejection of cancelling work under way, below, still
> holds. What this cancels has moved no window yet: a gather runs to its end once started, so
> nothing is left half-gathered. The unlock check then ends the session (or counts a new matching
> monitor as a reconnect, under ADR-0002 part 3), or starts the apply over if the monitor is back.
> Found in the review of the extension's wiring (`src/lib/session.js`); the state machine
> (`src/lib/state.js`) already behaved this way. `docs/design.md`'s Lifecycle section changes with
> this.

Explicitly not acting behind the lock: the user would meet the result without having seen it happen.
Explicitly not cancelling work under way: a half-gathered or half-restored set of windows is worse
than either end.

### 3. At unlock, catch up in one monitor check

At unlock the extension first runs a deferred rebuild of the placement record, if one is waiting,
and then the monitor check, which applies `docs/design.md`'s rules to what happened during the lock:
a client that disconnected has its windows restored right then; one that connected goes to Focusing;
a disconnect followed by a connect counts as a reconnect
([ADR-0002](0002-match-the-virtual-monitor.md), part 3). An `enable()` that comes while the screen
is locked waits and runs in full at unlock, since part 2 bars acting behind the lock.

Explicitly not restoring immediately behind the lock when a client disconnects: the user at the
workstation would unlock to windows already back in place, with no sign that the extension, not
Mutter, moved them; with the restore at unlock they see Mutter's parking undone in front of them.

Revisit parts 2 and 3 if a remote user who connects while the screen is locked cannot see or use the
unlock dialog on the virtual monitor, because the primary is still a physical one: the extension
would then have to make the virtual monitor primary behind the lock.

## Considered options

- **`user` and `unlock-dialog`, idle while locked, catch up at unlock (chosen).**
- **`user` only.** The default and the simplest review; every lock ends the session (part 1).
- **Both modes, acting behind the lock.** The session is up to date at unlock; the extension moves
  windows nobody can see and records states nobody saw.

## Consequences

- **Good:** when the RDP session itself survives the lock, locking and unlocking leaves the remote
  user's windows and primary as they were.

  > **Amendment (2026-10-14).** Except at the first lock after the extension was enabled during the
  > session (part 1's amendments).

- **Good:** apart from Mutter's own parking of the windows when a client disconnects, what the user
  meets at unlock comes from one of three sources: what the extension did before the lock, work it
  had under way when the screen locked, or the unlock check.
- **Cost:** the `unlock-dialog` mode has to be justified in the extensions.gnome.org review.
- **Cost:** a client that connects while the screen is locked gets no primary and no windows
  until someone unlocks.
- **Cost:** a disconnect followed by any matching monitor appearing during the lock counts as a
  reconnect, even another client's; ADR-0002 lists this cost.
- **Cost:** the extension has to track lock state, defer the record rebuild and `enable()`, and
  drop pending checks: more states than an extension that is disabled on lock.

  > **Amendment (2026-10-14).** Also a cost: at the first lock after the extension was enabled
  > during the session, the remote user's arrangement is lost (part 1's amendments).

## Tracked separately

- Whether a remote user who connects while the screen is locked can see and use the unlock dialog on
  the virtual monitor; the revisit trigger of parts 2 and 3.
- The manual test protocol: connect while locked, disconnect while locked, and both, with "Allow
  Locked Remote Desktop".
- Whether stock GNOME 49 and 50 keep an RDP session through a lock without "Allow Locked Remote
  Desktop", or end it; if they end it, every lock is a disconnect and the windows come back at
  unlock.

  > **Amendment (2026-10-14).** They end it. In the test VMs (GNOME Shell 49.10 and 50.5, no "Allow
  > Locked Remote Desktop"), locking the screen ended the FreeRDP client's session and the virtual
  > monitor went; nothing moved behind the lock, and the unlock check restored the gathered windows
  > with no difference from the snapshot. On stock GNOME, then, a lock is a disconnect.
  > `docs/design.md`'s Lifecycle section changes with this.

- Whether to carry a session across a `disable()` that the Shell's extension order causes at the
  lock (part 1 amendment); to be settled on the test VMs with a typical set of extensions.

  > **Amendment (2026-10-14).** Settled: not carried across (part 1's amendments).
