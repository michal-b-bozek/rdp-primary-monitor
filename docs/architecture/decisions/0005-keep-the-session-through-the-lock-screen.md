# 5. Keep the session through the lock screen

- **Status:** accepted
- **Date:** 2026-10-13
- **Deciders:** Michał Bogusław Bożek (maintainer)
- **Related:** builds on [ADR-0004](0004-snapshot-and-restore-windows.md), whose `disable()`
  restores the gathered windows, and on [ADR-0002](0002-match-the-virtual-monitor.md) part 3 (the
  reconnect). ADR-0004's part 4 restore, when the session's monitor goes while the screen is locked,
  runs at unlock (part 3 here); ADR-0002's parts 2 and 4 rely on the unlock check set up here.
  [ADR-0003](0003-apply-the-primary-temporarily.md)'s rules do not change; while the screen is
  locked, its retry (part 3) runs on the debounce timer.

## Context

The screen locks when the user at the workstation locks it, after the idle timeout, or from the
remote side; on the maintainer's workstation, the "Allow Locked Remote Desktop" extension also lets
an RDP client connect while the screen is locked, so a virtual monitor can appear, or go, behind the
lock. Three forces follow:

- **Locking disables extensions that do not ask to stay.** GNOME Shell runs an extension only in the
  session modes its `metadata.json` lists under `session-modes`; with the default (`user` only) it
  calls `disable()` when the screen locks and `enable()` again at unlock (gjs.guide, the extension
  session modes). Under ADR-0004, that `disable()` would put every gathered window back while the
  screen is locked, and the `enable()` at unlock would gather them again: each lock moves the
  windows away from the remote user and back.
- **Work behind the lock is invisible and hard to check.** While the screen is locked, the windows
  are hidden; a gather or a restore that runs then cannot be watched, and its result is what the
  user meets at unlock. A placement record updated then would hold states the user never saw.
  Mutter's own fallback still acts: in the spike (ADR-0004), on disconnect Mutter parked the
  gathered windows on the remaining primary; behind the lock this is expected, not yet observed.
- **A session can start or end during the lock.** With "Allow Locked Remote Desktop", a client
  can connect, disconnect, or both, while the screen is locked; the extension has to know at unlock
  what happened.

## Decision

### 1. Run in `user` and `unlock-dialog`

`metadata.json` lists `session-modes` `user` and `unlock-dialog`, so locking does not disable the
extension and a session survives the lock: the windows stay gathered, the temporary primary stays,
and the snapshot is kept. The extension draws nothing, so it shows nothing on the lock screen.

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
gather that follows it, and a restore.

Explicitly not acting behind the lock: the user would meet the result without having seen it happen.
Explicitly not cancelling work under way: a half-gathered or half-restored set of windows is worse
than either end.

### 3. At unlock, catch up in one monitor check

At unlock the extension first runs a deferred rebuild of the placement record, if one is waiting,
and then the monitor check, which applies `docs/design.md`'s rules to what happened during the lock:
a client that disconnected has its windows restored right then; one that connected goes to Focusing;
a disconnect followed by a connect counts as a reconnect
([ADR-0002](0002-match-the-virtual-monitor.md), part 3). An `enable()` that comes while the screen
is locked waits and runs in full at unlock, since building the record and gathering then would be
acting behind the lock (part 2).

Explicitly not restoring immediately behind the lock when a client disconnects: the user at the
workstation would unlock to windows already back in place, with no sign that the extension, not
Mutter, moved them; with the restore at unlock they see Mutter's parking undone in front of them.

Revisit parts 2 and 3 if a remote user who connects while the screen is locked cannot see or use the
unlock dialog on the virtual monitor, because the primary is still a physical one: the extension
would then have to make the virtual monitor primary behind the lock.

## Considered options

- **`user` and `unlock-dialog`, idle while locked, catch up at unlock (chosen).**
- **`user` only.** The default and the simplest review; the lock calls `disable()`, so every lock
  ends the session and every unlock starts a new one.
- **Both modes, acting behind the lock.** The session is up to date at unlock; the extension moves
  windows nobody can see and records states nobody saw.

## Consequences

- **Good:** when the RDP session itself survives the lock, locking and unlocking leaves the remote
  user's windows and primary as they were.
- **Good:** apart from Mutter's own parking of the windows when a client disconnects, what the user
  meets at unlock comes from one of three sources: what the extension did before the lock, work it
  had under way when the screen locked, or the unlock check.
- **Cost:** the `unlock-dialog` mode has to be justified in the extensions.gnome.org review; the
  extension must not create UI or keep anything visible on the lock screen.
- **Cost:** a client that connects while the screen is locked gets no primary and no windows
  until someone unlocks.
- **Cost:** a disconnect followed by any matching monitor appearing during the lock counts as a
  reconnect, even another client's; ADR-0002 lists this cost.
- **Cost:** the extension has to track lock state, defer the record rebuild and `enable()`, and
  drop pending checks: more states than an extension that is disabled on lock.

## Tracked separately

- Whether a remote user who connects while the screen is locked can see and use the unlock dialog on
  the virtual monitor; the revisit trigger of parts 2 and 3.
- The manual test protocol: connect while locked, disconnect while locked, and both, with "Allow
  Locked Remote Desktop".
- Whether stock GNOME 49 and 50 keep an RDP session through a lock without "Allow Locked Remote
  Desktop", or end it; if they end it, every lock is a disconnect and the windows come back at
  unlock.
