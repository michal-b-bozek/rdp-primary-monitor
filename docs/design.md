# Design

**Status:** design for the first release; the code that implements it is being written.

The extension is a five-state machine inside `gnome-shell`, driven by the monitor check (see
[States](#states)). The reasons behind its decisions will be recorded as architecture decision
records under `docs/architecture/decisions/`.

## Where it runs

The extension is code inside the `gnome-shell` process, loaded by the Shell's extension system.
Everything it reads and changes is on the same machine:

- **Monitor changes** (input): the Shell's `Main.layoutManager` emits `monitors-changed` whenever
  a monitor appears, disappears or is reconfigured. GNOME Desktop Sharing adds an RDP client's
  monitor this way: a virtual monitor with vendor `MetaVendor` and product
  `Virtual remote monitor`, sized to the client window.
- **The monitor list** (input): `global.backend.get_monitor_manager().get_monitors()` gives each
  monitor's vendor, product and connector; `get_monitor_for_connector()` maps a connector to the
  monitor index that the window API uses.
- **Window placement** (input): `global.display.list_all_windows()` and each `Meta.Window`'s
  frame, monitor, workspace and maximized, fullscreen and minimized state.
- **Display configuration** (input and output): Mutter's `org.gnome.Mutter.DisplayConfig` D-Bus
  interface, called asynchronously from inside the Shell. `GetCurrentState` reads the layout;
  `ApplyMonitorsConfig` with the _temporary_ method changes which monitor is primary. A temporary
  configuration is never written to `~/.config/monitors.xml`.
- **Window moves** (output): `Meta.Window` methods (`move_to_monitor`, `move_resize_frame`,
  `maximize`, `unmaximize`, `make_fullscreen`, `unmake_fullscreen`).

## States

Monitor changes arrive in bursts (a connecting client produces several), so the extension acts on
`monitors-changed` only after a quiet period set by the debounce setting. What it does then is the
_monitor check_, which also runs at `enable()` and on unlock.

```mermaid
stateDiagram-v2
    [*] --> Idle: no virtual monitor at enable
    [*] --> Focusing: virtual monitor present at enable
    Idle --> Focusing: virtual monitor present
    Focusing --> Focused: primary applied, windows gathered
    Focusing --> Restoring: virtual monitor gone
    Focusing --> Dismissed: apply failed
    Focused --> Restoring: virtual monitor gone
    Focused --> Dismissed: primary moved off the virtual monitor
    Dismissed --> Restoring: virtual monitor gone
    Restoring --> Idle: windows restored
    Restoring --> Focusing: virtual monitor back
```

_The extension's lifecycle for one remote client, including a reconnect during restore. Arrows
labelled with a monitor condition follow the monitor check; the others follow the extension's own
work finishing or failing._

**Idle.** No virtual monitor. The extension keeps the placement record (next section) up to date; it
does so only in Idle, and only while the screen is unlocked (see [Lifecycle inside the
Shell](#lifecycle-inside-the-shell)). On entering Idle it rebuilds the record from the current
placement of every normal window, as `enable()` does; if the screen is locked then, the rebuild is
deferred to unlock.

**Focusing.** A virtual monitor matched the vendor and product (the most recently added one, if
several do). The extension:

1. takes the placement record as the session's snapshot, unless it already holds one from a
   session that is still being restored;
2. reads `GetCurrentState` and sends the same layout back with only the virtual monitor's
   logical monitor marked primary, using the configuration serial from that reply;
3. waits for the resulting `monitors-changed`, so that work areas and the top bar have moved;
4. moves each snapshotted normal window (all workspaces or only the current one, per a setting) to
   the virtual monitor with `move_to_monitor`. Maximized, fullscreen and minimized windows are
   moved too and keep their state.

Mutter does not remember a temporary configuration, so the extension applies it again on every
connect. The virtual monitor's serial changes with each session; matching ignores it.

**Focused.** The remote user works on the virtual monitor, which now holds the top bar,
notifications and the gathered windows. Windows opened during the session are left where GNOME
places them and are not restored later. A client resizing its window changes the virtual
monitor's mode, which is not a reason to act. If the primary moves off the virtual monitor while
it is still present, the extension treats it as a deliberate rearrangement and moves to
Dismissed. What happens when a second virtual monitor arrives during a session, and whether
"virtual monitor gone" means the focused one or any of them, is not settled yet.

**Dismissed.** A virtual monitor is present but the extension no longer acts on it: the apply
failed, or the user took the primary back. It changes neither windows nor the layout while the
client stays connected.

**Restoring.** The client disconnected. Mutter removes the virtual monitor and returns to the
previous layout by itself; it parks the gathered windows on the remaining primary monitor. The
extension then puts back each window it gathered, and only those: monitor first, then maximized
state, then the frame rectangle for windows that were not maximized, then fullscreen, then
minimized. If the apply failed, nothing was gathered and nothing moves. Windows that closed during
the session are skipped, and so are windows whose original monitor no longer exists. If the client
reconnects before this finishes, the extension goes back to Focusing with the same snapshot, so the
windows still return to where they were before the first connect.

## The placement record

The snapshot has to describe the layout from _before_ the virtual monitor arrived, but by the
time the extension sees `monitors-changed`, Mutter may already have moved windows as part of the
same monitor change. The extension therefore keeps a continuous record of where each normal
window last _settled_:

- it listens to each window's position, size, workspace, maximized, fullscreen and minimized
  changes, and to window creation and removal;
- a change is committed to the record only after the window has been still for a short period
  (the settle setting);
- the first `monitors-changed` of a burst discards every change not yet committed and stops commits
  until the monitor check has run, so moves Mutter makes during a monitor change never reach the
  record, however late in the burst they come.

A window moved by the user within the settle period before a client connects is restored to its
previous position; that is the cost of the rule.

## Lifecycle inside the Shell

`enable()` connects the signals, creates the D-Bus proxy asynchronously and builds the first
placement record; nothing happens at import time. If a virtual monitor is already present (the
extension was enabled, or the user logged in, with a client connected), it goes straight to Focusing
and takes the placement record it has just built as the snapshot. That record shows the layout after
the virtual monitor arrived, including any moves Mutter made then, so a disconnect restores windows
to where they were at `enable()`. `disable()` disconnects every signal and removes every timeout;
what it does to a session in progress (the gathered windows, the temporary primary, the
snapshot) is not settled yet.

The extension runs in the `user` and `unlock-dialog` session modes, so locking the screen does not
disable it. When the screen locks, a pending monitor check is dropped; while it is locked the
extension starts nothing: gathered windows stay where they are, the snapshot is kept and the
placement record is not updated. Focusing work already under way finishes, including gathering the
windows, and so does a restore. An `enable()` while the screen is locked waits and runs in full at
unlock. Otherwise, on unlock the extension first carries out a deferred rebuild of the placement
record, if one is waiting, and then runs the monitor check. A client that disconnected while the
screen was locked has its windows restored right away. One that connected meanwhile goes to Focusing
with the record as it stood when the screen locked, or as rebuilt at unlock if a restore finished
while the screen was locked. The rebuilt record, like one built at `enable()`, already includes
any moves Mutter made when the client connected.
