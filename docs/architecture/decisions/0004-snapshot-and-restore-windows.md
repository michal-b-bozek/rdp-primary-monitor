# 4. Snapshot and restore windows

- **Status:** accepted; Last amended: 2026-10-14
- **Date:** 2026-10-12
- **Deciders:** Michał Bogusław Bożek (maintainer)
- **Related:** builds on [ADR-0002](0002-match-the-virtual-monitor.md) (the session's monitor) and
  [ADR-0003](0003-apply-the-primary-temporarily.md) (the temporary primary; part 5 settles what
  `disable()` does to it). ADR-0002 keeps no connector or serial from one session to the next; that
  rule is about the virtual monitor, whose serial changes every session, and does not cover the
  physical monitors this ADR stores. [ADR-0005](0005-keep-the-session-through-the-lock-screen.md)
  defers part 4's restore to unlock when the session's monitor goes while the screen is locked.

## Context

Gathering moves the user's windows onto the session's monitor; when the session ends they have to go
back. In the feasibility spike (GNOME Shell 49.10 and 50.5, test VMs, a FreeRDP client), a throwaway
extension arranged four windows on the two physical heads (one maximized, one normal at 700×500, one
fullscreen, one minimized), took a snapshot with no client connected, gathered them, and restored
them after a real disconnect:

- `move_to_monitor()` gathered all four onto the virtual monitor, and each kept its state: the
  maximized window filled the work area below the top bar, the fullscreen one the whole monitor,
  and the minimized one stayed minimized;
- on disconnect, Mutter parked the gathered windows on the remaining primary, with their states
  kept;
- restoring put all four back, with zero differences against the snapshot on both versions, when
  each window went through this order: leave fullscreen if it was not fullscreen before, monitor,
  maximized state, frame rectangle, fullscreen, minimized state;
- every monitor configuration change, including the client's arrival itself, moved windows from
  one physical head to the other before the extension could look. Both QEMU heads report the same
  vendor, product and serial (`RHT`, `QEMU Monitor`, `0x00000000`), which is the likely cause;
  whether real monitors do the same is not known.

The spike covered windows on one workspace only, and no window opened, closed or moved during the
session. Five forces shape the snapshot and the restore:

- **The layout before the connect may already be gone.** By the time the extension sees
  `monitors-changed`, Mutter may have moved windows as part of the same change, as in the VMs.
- **Connector names change.** The maintainer's Thunderbolt dock renames the connectors of its two
  monitors on every re-dock (`DP-6`/`DP-8`, `DP-7`/`DP-12`, …), so a connector stored before a
  session may name another monitor, or none, after it. The serials do not change with them: across
  the layouts stored in that workstation's `~/.config/monitors.xml`, the two monitors, the same
  model, report two distinct serials, each seen under five connector names.
- **Positions depend on the layout.** A frame rectangle is in global coordinates; if the layout
  changes during the session, the same coordinates land somewhere else.
- **The remote user changes things.** During a session windows are moved, resized, closed and
  opened, and the original monitor can be unplugged.
- **`disable()` can come in the middle of a session.** The user turns the extension off while a
  client is connected. The project follows the extensions.gnome.org review rules, which ask for full
  cleanup in `disable()`; an asynchronous D-Bus reply can arrive after `disable()` has dropped the
  proxy.

## Decision

### 1. Snapshot from a continuous placement record

The extension keeps a record of where each normal window last settled: a change is committed only
after the window has been still for the settle period, and the first `monitors-changed` of a burst
discards uncommitted changes and stops commits until the monitor check has run. Focusing takes this
record as the session's snapshot. `docs/design.md` describes the record's rules.

Explicitly not a snapshot taken at the monitor check: in the VMs the windows had already moved by
then. Revisit if the release checks on real hardware show that a connect never moves windows; the
record could then go.

### 2. What the snapshot holds

For each normal window that is not skipped from the taskbar: its workspace; its monitor, as
vendor, product, serial and connector; its frame rectangle relative to that monitor's origin; its
maximize flags; whether it is fullscreen; whether it is minimized. Gathering moves each window
with `move_to_monitor()` only, so it keeps its workspace and its states.

> **Amendment (2026-10-14).** The workspace takes one of three forms: a workspace, all workspaces,
> or none of the window's own. With `org.gnome.mutter workspaces-only-on-primary` on, the default,
> Mutter 49 and 50 keep every window that is not on the primary monitor on all workspaces
> (`should_be_on_all_workspaces` in `src/core/window.c`), and offer no getter that tells whether the
> window also asked to be on all of them. A window on all workspaces counts as being there of its
> own accord if it is on the primary monitor, has no monitor, or the setting is off; otherwise it
> has no workspace of its own. In the test VMs, the snapshot as first written recorded such windows
> as on all workspaces, and the restore then made each of them ask to be on all workspaces, which
> keeps it there on every monitor until someone unsticks it: three windows snapshotted while the
> virtual monitor was primary came back on all workspaces on both versions. No rule of part 2 is
> reversed; the snapshot records one more distinction. Part 4's amendment of the same date says what
> the restore does with each form; the snapshot code (`src/lib/gather.js`, `src/lib/windows.js`) and
> `docs/design.md`'s Restoring paragraph change with this.

Explicitly not the frame in global coordinates: a layout change during the session would put the
window somewhere else on its monitor, or off it.

### 3. Find the original monitor by vendor, product and serial

At restore, the candidates for a window's monitor are the present monitors with the stored vendor,
product and serial. With one candidate, that is the monitor. With several, it is the one with the
stored connector; if none of them has it, the monitor counts as gone. With no candidate, the monitor
counts as gone. The connector is never the only key. A physical monitor's serial is taken to be
stable, unlike the virtual monitor's.

Explicitly not the connector alone: a re-dock during the session would make every original monitor
count as gone. Revisit if monitors turn up whose serial changes across a re-dock, or if identical
monitors sharing a serial turn out to be common.

### 4. Restore every gathered window, and only those

When the session's monitor goes, the extension restores each window it gathered, in the order the
spike tested, with the workspace added: leave fullscreen if the window is fullscreen now and was not
in the snapshot, workspace, monitor, maximized state, the frame rectangle for a window that was not
maximized, fullscreen, minimized. It does so whatever the remote user did to the window during the
session. A window that closed is skipped. A window whose original monitor is gone is left as it is,
monitor, workspace and states alike: after a disconnect that is where Mutter parked it. The
extension logs that once per window. A window opened during the session is not touched.

> **Amendment (2026-10-13).** The gathered set carries over a reconnect, as the snapshot does
> ([ADR-0002](0002-match-the-virtual-monitor.md) part 3): a window gathered before the client came
> back is restored when the session ends, even if the reconnected session goes to Dismissed and
> gathers nothing. Found in the review of the whole design set, where `docs/design.md` said nothing
> moves after an apply that failed twice; `docs/design.md`'s Restoring paragraph changes with this.

> **Amendment (2026-10-13).** A window maximized in one direction gets its frame rectangle back too,
> for the direction that is not maximized. Mutter 49 and 50 leave the free direction where it is
> when they maximize a window in one direction (`meta_window_set_maximize_flags`), so without the
> frame a window maximized vertically would keep the position and width it had on the session's
> monitor. The maximized state is therefore restored in three steps: the extension leaves it only if
> the window is maximized in a direction the snapshot does not have, sets the frame unless the
> snapshot has it maximized in both directions, and then maximizes the window in the snapshot's
> directions, which adds any that are missing. Leaving it in every other case would send the window
> to the rectangle Mutter saved when it was maximized, which Mutter does not move with the window
> (`meta_window_set_unmaximize_flags`, `meta_window_move_to_monitor`), so it can lie on the
> session's monitor, now gone. Found in the code review of the restore (`src/lib/windows.js`,
> `src/lib/gather.js`) and checked in Mutter's source; the spike maximized windows in both
> directions only, so these steps have not been run yet (see Tracked separately). Tiled windows,
> which Mutter records as maximized vertically, take the same steps and stay under Tracked
> separately. `docs/design.md`'s Restoring paragraph changes with this.

> **Amendment (2026-10-14).** The order above becomes: leave fullscreen, monitor, workspace, and the
> rest as before; the workspace is restored only for a window whose snapshot gives it a workspace or
> all workspaces (part 2's amendment of the same date). A window with no workspace of its own gets
> no workspace from the restore, so it keeps any change the remote user made to it: an
> exception to "keeping what the remote user changed" below, because the snapshot has no workspace
> to put back, not because the change is wanted. A window that comes onto the primary monitor from
> another stops being on all workspaces, and Mutter then puts it on the active workspace
> (`meta_window_on_all_workspaces_changed`, Mutter 49 and 50), which would undo a workspace set
> before the move. A window whose snapshot gives it a workspace but whose original monitor is no
> longer primary stays on all workspaces, as Mutter keeps it. Found in the same VM test as part 2's
> amendment, and checked in Mutter's source; `src/lib/windows.js` and `docs/design.md`'s Restoring
> paragraph change with this.

Explicitly not:

- keeping what the remote user changed: the user at the workstation expects the layout they left,
  and the extension cannot tell a deliberate remote move from a temporary one;
- moving a window whose monitor is gone to the primary: Mutter has already parked it on a monitor
  that exists;
- placing windows opened during the session: they have no position from before it.

Revisit the first if users report losing remote rearrangements they wanted to keep.

### 5. `disable()` restores the windows and leaves the primary

`disable()` during a session puts every gathered window back as part 4 does, synchronously, and
drops the snapshot. A window whose original monitor is gone stays on the session's monitor; when the
client disconnects, Mutter moves it to a monitor that remains. `disable()` sends no display
configuration: the temporary primary stays until the client disconnects, when Mutter drops it. A
restore under way is finished synchronously in `disable()`. An `ApplyMonitorsConfig` still in flight
is cancelled; if Mutter has applied it already, its primary stays like any other temporary primary.

> **Amendment (2026-10-14).** Because the temporary primary stays, the windows that `disable()` puts
> back on the monitor that was primary before the session are then on a monitor that is not primary.
> With `org.gnome.mutter workspaces-only-on-primary` on, the default, Mutter keeps them on all
> workspaces and ignores part 4's workspace step (part 4's amendment of this date), so they lose the
> workspace the snapshot gave them; once the client disconnects and that monitor is primary again,
> Mutter is expected to put them on the active workspace, by part 4's amendment. In the test VMs,
> after a `disable()` during a session and a disconnect, three such windows were still on all
> workspaces on GNOME Shell 50.5, which does not match that expectation; that run used the snapshot
> as first written, before part 2's amendment of this date, and why the windows stayed there was not
> established. The current restore has not been run in this case (Tracked separately). The
> maintainer chose to keep part 5 and accept this as a cost (Consequences) over restoring the
> primary from `disable()` or leaving the windows gathered, both rejected below for the reasons
> given there. Revisit if users report windows left on all workspaces after turning the extension
> off during a session. `docs/design.md`'s Lifecycle section changes with this.

> **Amendment (2026-10-14).** In the test VMs (GNOME Shell 49.10 and 50.5 alike), with the restore
> as part 4's amendment of this date describes it, a `disable()` during a session and a disconnect
> left five of the nine test windows on all workspaces. They were the windows `disable()` had put
> back on the monitor that was primary before the session, which was primary again after the
> disconnect; the amendment above expected them on the active workspace. None of them had asked to
> be there: turning `workspaces-only-on-primary` off put each one on the active workspace. On both
> versions Mutter did not re-evaluate whether a window that did not move belonged on all workspaces,
> also when only the primary changed and no client was involved; windows that moved onto the primary
> monitor, as at a gather, did get a workspace. Such a window therefore stays on all workspaces
> until it moves onto the primary monitor from another or the setting changes. Part 5 and its
> rejections stand; the cost under Consequences gets an amendment. `docs/design.md`'s Lifecycle
> section changes with this.

Explicitly not:

- also restoring the primary: it needs an asynchronous `ApplyMonitorsConfig` from `disable()`,
  whose reply would arrive after the proxy is gone and which can fail on a stale serial;
- leaving the windows on the session's monitor: the extension's own moves would stay after it was
  turned off.

Revisit if the review of the extension for extensions.gnome.org asks for the primary to be
restored too.

## Considered options

- **Continuous record, restore everything gathered, `disable()` restores windows only (chosen).**
- **Snapshot at the monitor check.** Simpler; loses the layout when Mutter has already moved
  windows, as in the VMs.
- **Restore only windows the remote user did not touch.** Keeps remote work; needs a
  per-window change history and still guesses at intent.
- **`disable()` leaves everything.** No work in `disable()`; the user's windows stay gathered on a
  monitor that may soon be gone.

## Consequences

- **Good:** after a session, the workstation's windows are where the user left them, even after a
  layout change, a reload of the extension or a re-dock, with the exceptions listed under the costs.
- **Good:** `disable()` needs no D-Bus call and no timeout, so nothing outlives it.
- **Cost:** the extension listens to every normal window's moves all the time, not only during
  sessions.
- **Cost:** a window the user moved within the settle period before a client connected goes back
  to where it was before that move.
- **Cost:** remote rearrangements are lost at disconnect.
- **Cost:** two monitors of the same model with the same serial (or a placeholder serial, as on the
  QEMU heads) are told apart only by the connector; after a re-dock that swaps their connectors,
  their windows go back to the wrong one of the two. After a re-dock that gives them new connector
  names, as the maintainer's dock does, neither matches, and their windows stay where Mutter parked
  them.
- **Cost:** after `disable()` during a session, the remote user keeps the top bar but loses the
  gathered windows, which go back to monitors they cannot see.

  > **Amendment (2026-10-14).** With `workspaces-only-on-primary` on, the windows put back on the
  > monitor that was primary before the session lose their workspace as well (part 5's amendment of
  > this date).

  > **Amendment (2026-10-14).** In the test VMs those windows also stayed on all workspaces after
  > the client disconnected (part 5's second amendment of this date).

## Tracked separately

- Windows on several workspaces, and the effect of `org.gnome.mutter workspaces-only-on-primary`
  when the primary changes; the spike covered one workspace only.

  > **Amendment (2026-10-14).** The test VMs ran windows on two workspaces with the setting on,
  > which led to the amendments of parts 2 and 4; still to test: the restore as those amendments
  > describe it, a `disable()` during a session with that restore (part 5's amendment), and the
  > setting off.

  > **Amendment (2026-10-14).** Tested in the test VMs (GNOME Shell 49.10 and 50.5), with nine
  > windows over three workspaces, among them one on all workspaces of its own accord and three with
  > no workspace of their own: the restore put every window back with no difference from the
  > snapshot, with the setting on and with it off; a snapshot taken while the virtual monitor was
  > primary left no window asking to be on all workspaces after the restore; for a `disable()`
  > during a session, see part 5's second amendment of this date. Changing the primary without
  > moving a window changed no window's workspace on either version. The cases this item names have
  > run; the item is closed.

- Whether real monitors are moved by a connect as the QEMU heads were; part 1's revisit trigger.
- Tiled (half-screen) windows and applications with several windows; the spike covered neither.
- Part 4's cases the spike did not run: windows the remote user moved, resized, maximized, made
  fullscreen or minimized; windows opened or closed during the session; an original monitor that
  is gone at restore.

  > **Amendment (2026-10-13).** Also windows maximized in one direction, restored in part 4's
  > amended steps; the spike maximized windows in both directions only. Among them, a window
  > maximized vertically in the snapshot that the remote user tiled to one side: it is not
  > unmaximized, and maximizing it vertically again leaves the tile in place, so it may come back
  > tiled.
