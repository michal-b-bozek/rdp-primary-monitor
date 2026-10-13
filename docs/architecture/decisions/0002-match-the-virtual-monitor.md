# 2. Match the virtual monitor

- **Status:** accepted
- **Date:** 2026-10-12
- **Deciders:** Michał Bogusław Bożek (maintainer)
- **Related:** builds on [ADR-0001](0001-record-architecture-decisions.md).

## Context

The extension acts only when an RDP client of GNOME Desktop Sharing has added a virtual monitor,
so every monitor check has to answer which monitor, if any, is that client's. In the feasibility
spike (GNOME Shell 49.10 and 50.5, test VMs, a FreeRDP client) and on the maintainer's
workstation, the virtual monitor looked like this:

- vendor `MetaVendor`, product `Virtual remote monitor`, both in `Meta.Monitor` inside the Shell
  and in the `GetCurrentState` reply over D-Bus;
- `is_virtual()` true in the Shell (the D-Bus reply carries no such property);
- connector `Meta-0` in both observed sessions;
- monitor serial `0x000001` in the first session and `0x000002` after a reconnect;
- the workstation's `~/.config/monitors.xml` holds one stored layout with two virtual monitors,
  `Meta-0` and `Meta-1`.

Two identifiers are unreliable, and two situations need a rule:

- **Connector names are reused.** The reconnected client got `Meta-0` again, so a connector
  name says neither which client a monitor belongs to nor which came last. Physical connectors
  are no better: the workstation's Thunderbolt dock renames its two monitors' connectors on
  every re-dock (`DP-6`/`DP-8`, `DP-7`/`DP-12`, …).
- **The serial changes every session.** A rule that stores a serial matches only the session it
  was taken from.
- **More than one virtual monitor can be present.** The stored two-monitor layout shows it happens.
  A likely source is one client that uses two of its own monitors, which would add both in the same
  burst of monitor changes, so the order of the monitor checks cannot tell them apart. With several
  present, "the virtual monitor is gone" is ambiguous too: the one the extension focused, or the
  last of them.
- **A newcomer can arrive mid-session.** Another client, or the same client adding a monitor,
  can add a virtual monitor while the extension already holds a focused session: windows
  gathered, primary set.

## Decision

### 1. Match on vendor and product only

Recognising a monitor as a remote client's uses **only** its vendor, `MetaVendor`, and its product,
`Virtual remote monitor`; never the connector name (`Meta-0`) or the monitor serial. Within the
running Shell, part 2 orders monitors by serial and part 3 tracks the session's monitor by connector
and serial; the extension also uses the connector to look up the monitor's index with
`get_monitor_for_connector()` and its logical monitor in `GetCurrentState`. Neither connector nor
serial is kept from one session to the next.

Explicitly not `is_virtual()`: by its name it marks any virtual monitor, not a remote client's in
particular, while vendor and product are what the spike saw on Desktop Sharing's monitor, on both
49 and 50. Neither claim is verified beyond that: the spike did not check which other monitors are
virtual, or whether any of them (a screen cast's virtual source, for example) carry the same
strings; one that did would be treated as a remote client. Revisit if such a monitor turns up, or
if Mutter changes the strings.

### 2. Pick the newest arrival, then the lowest serial

When the monitor check finds several matching monitors and no monitor is focused (in Idle, or for a
reconnect in Restoring), the extension takes those that appeared at the most recent monitor check
that added any; among them, the one with the lowest serial, read as a hexadecimal number. A monitor
present when the extension is enabled counts as appearing at that first check, so at a late start
the lowest serial of all of them wins. The same holds at unlock: monitors that appeared while the
screen was locked all count as appearing at the unlock check, even if they came one after another
(lock behaviour: [ADR-0005](0005-keep-the-session-through-the-lock-screen.md)).

The newest arrival wins because the client that connected last is the most likely to belong to the
person about to work. Revisit if users report that the longest-connected client should win.

Explicitly not:

- the oldest arrival: by the reason above, its user is the less likely one to be working;
- the highest connector number: connector names are reused, so the number does not follow
  arrival;
- the largest monitor: size says nothing about which client is newest, and a client changes it
  by resizing its window;
- "do nothing when there are several": a client with two monitors would never get focus;
- the leftmost or topmost monitor: position comes from the layout Mutter gives the new monitors
  and says no more than the serial about which one is the client's main screen, while the
  serial at least appears to follow creation order;
- waiting for a test with a two-monitor client before deciding: the code needs a rule now, and
  the test (see [Tracked separately](#tracked-separately)) is this rule's revisit trigger.

Revisit the lowest-serial tie-break if a two-monitor client turns out to create its monitors in an
order unrelated to its own monitor layout, or if serials stop rising with each new virtual monitor
or a serial repeats; part 3's identity check depends on serials not repeating.

### 3. A session stays on its monitor

A session is tied to the monitor it focused, identified by connector and serial together while that
monitor exists. A virtual monitor that appears in Focusing, Focused or Dismissed is ignored: the
primary and the gathered windows stay where they are. In Restoring, a matching monitor that appears
is the client coming back: the extension returns to Focusing with the same snapshot, choosing among
several under part 2. The same holds for a matching monitor that is new at the very check that finds
the session's monitor gone, as when a client reconnects within the debounce period. A monitor that
was already present before that check waits for the check after the restore (part 4).

Explicitly not switching to the newcomer: the windows would move under a remote user who is
working, and the newcomer may be a second monitor of the same client. Revisit if users report
that a second client should take over.

### 4. The session ends when its monitor goes

"Virtual monitor gone" means the session's own monitor is gone, whether or not other virtual
monitors remain. The extension restores the gathered windows; once the restore finishes, it runs the
monitor check again (at unlock, if the screen is locked;
[ADR-0005](0005-keep-the-session-through-the-lock-screen.md)), and a virtual monitor still present
starts a new session under part 2.

Explicitly not waiting until every virtual monitor is gone: the windows would stay where Mutter
parked them, on monitors the session never chose, for as long as any other client stays
connected.

## Considered options

- **Vendor and product, newest arrival, lowest serial among those added at the same check
  (chosen).**
- **Connector name.** Readable and stable within a session; reused across sessions and renamed
  by docks.
- **Monitor serial.** Unique per session; changes every session, so it can order monitors but
  cannot match them.
- **`is_virtual()`.** Shell API, no strings; by its name broader than Desktop Sharing's monitor,
  untested beyond it.

## Consequences

- **Good:** matching survives reconnects, re-docks and both supported Shell versions without
  any stored identifier.
- **Good:** with two clients, the gathered windows never jump to a monitor that arrived later while
  the focused client stays connected.
- **Cost:** the extension has to record at which monitor check each virtual monitor appeared,
  keyed by connector and serial, so it can find the newest arrivals even at a check that adds
  none; the state machine carries that record.
- **Cost:** the tie-break and part 3's identity check rest on two observed serials (`0x000001`,
  then `0x000002`), not on a documented Mutter guarantee. A serial that repeated, for example after
  a restart of Desktop Sharing, would make a quick reconnect look like the session's own monitor
  still present.
- **Cost:** while the first client stays connected, a second client's user gets no top bar and
  no gathered windows on their monitor.
- **Cost:** when the focused client leaves while another stays, the windows go back to their
  original monitors and are then gathered again onto the remaining client's monitor.
- **Cost:** two clients that connect one after another while the screen is locked count as arriving
  together, so the older one, whose serial is presumably lower, gets the session.
- **Cost:** a new monitor counts as a reconnect if it appears within the debounce period or during
  the restore, and a locked screen extends that to the whole time it is locked: if the session's
  monitor goes and another matching monitor appears before unlock, even another client's, the
  windows are gathered onto it with the old snapshot instead of being restored.

## Tracked separately

- Connect a client with two monitors (FreeRDP `/monitors`) to the GNOME 49 and 50 test VMs and
  record what Desktop Sharing creates: how many virtual monitors, their serials, positions and
  creation order. Part 2's tie-break is to be checked against it.
- `GetCurrentState` fixtures with two virtual monitors, for the unit tests of part 2.
- Which other monitors are virtual, and whether any of them (a screen cast's virtual source)
  carry the same vendor and product, which would make part 1 match them.
