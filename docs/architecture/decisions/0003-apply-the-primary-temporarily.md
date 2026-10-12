# 3. Apply the primary temporarily

- **Status:** accepted
- **Date:** 2026-10-12
- **Deciders:** Michał Bogusław Bożek (maintainer)
- **Related:** builds on [ADR-0002](0002-match-the-virtual-monitor.md), which picks the session's
  monitor this ADR makes primary.

## Context

Making the session's monitor primary means changing Mutter's display configuration through
`org.gnome.Mutter.DisplayConfig`: read the layout with `GetCurrentState`, send it back with
`ApplyMonitorsConfig`. That call takes a method: `0` verify, `1` temporary, `2` persistent. In the
feasibility spike (GNOME Shell 49.10 and 50.5, test VMs, a FreeRDP client), the extension's call was
prototyped as a script: the same logical monitors, with the same positions, scales, transforms and
modes, only the virtual monitor's logical monitor marked primary, the `layout-mode` property copied,
and the serial from the `GetCurrentState` reply passed back. Results, the same on both versions,
with the replies kept as [fixtures](../../../tests/fixtures/display-config/README.md):

- verify (`0`) was accepted and changed nothing; temporary (`1`) was accepted and made the virtual
  monitor primary, with the `GetCurrentState` layout otherwise unchanged; the top bar left the
  physical monitor;
- `~/.config/monitors.xml` was never written: not after the apply, not after the disconnect;
- on disconnect, Mutter removed the virtual monitor and went back to the previous layout by
  itself: the old primary and the top bar returned, with no errors in the journal;
- on reconnect, the virtual monitor came back **not** primary;
- the serial in the reply counts monitor changes, not applied configurations: it stayed the same
  after the apply.

Five forces shape the call:

- **The user's remembered layouts must survive.** `~/.config/monitors.xml` is where GNOME keeps the
  layout the user chose for each set of monitors. The maintainer's workstation has five stored
  layouts with a virtual monitor in them, and in one of those it is not primary. A persistent apply
  asks the user to confirm the new layout and, once confirmed, saves it over the entry for the
  current set (Mutter's `src/backends/meta-monitor-manager.c`, branches `gnome-49` and `gnome-50`,
  read on 2026-10-12); the project's ground rules forbid the extension to touch the file at all.
- **A temporary configuration is forgotten.** Mutter does not keep it across a reconnect, so a
  rule that applies the primary only once would leave every later session unfocused.
- **The layout can change between the read and the apply.** `ApplyMonitorsConfig` names the layout
  it rewrites by the `GetCurrentState` serial, and Mutter rejects a call whose serial is not the
  current one ("The requested configuration is based on stale information", in the same file). A
  monitor change in that interval, such as the rest of a connect burst after the debounce period,
  fails the apply. The spike did not provoke this case.
- **The layout must come back when the client leaves.** In the spike, Mutter restored the
  previous layout by itself, in the same monitor burst that removed the virtual monitor; a
  configuration the extension sent then would race it.
- **The user can take the primary back.** Settings → Displays, or another tool, can move the
  primary off the session's monitor while the client is still connected. Other changes also
  reach the extension as `monitors-changed`: the user moving a monitor or changing a scale, and,
  inferred but not yet observed, the client resizing its window, which changes the virtual
  monitor's mode.

## Decision

### 1. Temporary method only

The extension changes the display configuration **only** with `ApplyMonitorsConfig` method `1`
(temporary), and only in Focusing. The configuration it sends is the `GetCurrentState` layout
unchanged except for the `primary` flag, which moves to the logical monitor of the session's
monitor, with the reply's serial and `layout-mode`. If that monitor is primary already, the
extension sends nothing. It applies again in every session, since Mutter forgets the
configuration.

Explicitly not the persistent method (`2`): it asks the remote user to confirm a layout they did
not choose, and then writes `~/.config/monitors.xml`, replacing the user's remembered layout for
the current monitors with the extension's. Revisit only if the project's rule on
`~/.config/monitors.xml` changes.

### 2. No configuration on disconnect

When the session's monitor goes, the extension sends no configuration of its own; Mutter's own
fallback restores the previous layout. Explicitly not a "restore" apply of the layout from before
the session: Mutter already does it, and a second change in the same burst would race it and
could be rejected for a stale serial. Revisit if real hardware shows a fallback that differs from
the layout before the session; the spike saw only the test VMs.

### 3. Retry once, then Dismissed

A failed temporary apply is retried **once**, from a fresh `GetCurrentState`, at the next monitor
check or one debounce period after the failure, whichever comes first, so that the retry does not
land in the same burst and still runs when no monitor changes; if it fails too, the extension logs
the error once and goes to Dismissed, and gathers no windows. There is no verify call (method `0`)
before the apply.

Explicitly not:

- verify first: the temporary apply checks the same configuration and fails the same way, so a
  verify step adds a round trip and a second chance for the serial to go stale;
- going to Dismissed at the first failure: a stale serial is a race, not an error in the
  configuration, and one fresh read answers it;
- retrying until it succeeds: a configuration Mutter rejects for another reason would loop.

Revisit if logs show second failures that a third attempt would have fixed.

### 4. Only the primary leaving the session's monitor dismisses

In Focused, the extension goes to Dismissed **only when** the primary is on another monitor while
the session's monitor is still present. Every other change is left alone: monitor positions, scales
and modes, including the mode of the session's monitor when the client resizes its window. In
Dismissed the extension sends no configuration and moves no windows until the session's monitor
goes, even if the primary comes back to it.

Explicitly not:

- applying the primary again: it would fight a user who chose another primary on purpose;
- dismissing on any change the extension did not make: the client's resize and Mutter's own
  adjustments cannot be told apart from the user's, so sessions would end at random.

Revisit if users report that a primary moved off by something other than the user, such as a
monitor hot-plug, dismisses their session.

## Considered options

- **Temporary apply, Mutter's fallback on disconnect (chosen).**
- **Persistent apply.** Would let Mutter apply a stored layout again on reconnect, but untested: the
  virtual monitor's monitor serial changes every session (ADR-0002), so a stored entry may never
  match again; prompts for confirmation, then rewrites the user's stored layouts in
  `~/.config/monitors.xml`.
- **Temporary apply plus an explicit restore on disconnect.** Independent of Mutter's fallback;
  duplicates it and races it within the same monitor burst.
- **Settings' own primary switch, done by hand.** No extension at all; this manual step is what the
  project replaces, because it has not persisted reliably from one remote session to the next.

## Consequences

- **Good:** `~/.config/monitors.xml` is never written by the extension, so the user's layouts
  are what they were before the extension was installed.
- **Good:** with no configuration sent on disconnect, a session that ends while the extension is
  busy or the screen is locked still gets the previous layout back.
- **Cost:** a reconnect pays for a `GetCurrentState` and an apply every time.
- **Cost:** a rejected retry leaves the session unfocused until the client reconnects; the
  journal is the only trace.
- **Cost:** a user who moves the primary back to the session's monitor after the extension has
  dismissed the session gets no gathering; the extension stays out of the way until the next
  session.

## Tracked separately

- Check on real hardware (the release checks on GNOME 49 and 50) that Mutter's fallback on
  disconnect matches the layout from before the session, as in the test VMs.
- Observe what `monitors-changed` and `GetCurrentState` show when the client resizes its window,
  so that part 4's rule is tested against the real change.
- What `disable()` does to the temporary primary during a session: the window snapshot and
  restore decision.
