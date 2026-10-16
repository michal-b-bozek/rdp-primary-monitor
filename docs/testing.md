# Manual test protocol

Run this before every release, on GNOME Shell 49 and on 50; it is what the ADRs call the release
checks. `mise run test` checks the extension's logic against a fake desk and a fake Mutter; this
protocol checks what only a real Shell, a real Mutter and real monitors show. A **Check** must hold,
or the case fails; a **Record** is an observation to write down. The reasons behind each check are
in [the design](design.md) and the [ADRs](architecture/decisions/).

**Status:** written before its first run. Fix any step that turns out wrong while running it.

## Where each case runs

- **Test VMs** (`f43` for 49, `f44` for 50): cases 1–4, 7 and 8; case 4 only without "Allow
  Locked Remote Desktop", which the VMs do not have.
- **A workstation with real monitors:** every case. Case 5 needs a dock, case 6 a client machine
  with two monitors, case 9 two monitors on the workstation.

Run the VM cases on both releases; run the workstation cases on the release the workstation has.
Write down, per release: `gnome-shell --version`, where each case ran, and pass or what differed.

## Before you start

In a VM, every `gsettings`, `gdbus` and `gnome-extensions` command needs the session bus of the
logged-in user `tester`; the VM commands below set
`DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus` for that. Quote a VM command whole, as
below, so that your own shell expands nothing in it (`~` above all).

1. Pack the extension on the host: `mise run pack`. The zip is
   `build/rdp-primary-monitor@michal-b-bozek.github.io.shell-extension.zip`.
2. Install it so that it is enabled **at login**. An extension enabled during the session can be
   disabled and enabled again by the Shell at the first lock, which would upset case 4
   ([design, Lifecycle](design.md#lifecycle-inside-the-shell)).
   - **Test VM** (here `f44`; the same for `f43`):

     ```sh
     mise run vm:start f44
     mise run vm:ssh f44 -- 'cat > /tmp/rdppm.zip' \
       < build/rdp-primary-monitor@michal-b-bozek.github.io.shell-extension.zip
     mise run vm:ssh f44 -- 'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
       gnome-extensions install --force /tmp/rdppm.zip'
     mise run vm:ssh f44 -- "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
       gsettings set org.gnome.shell enabled-extensions \
       \"['rdp-primary-monitor@michal-b-bozek.github.io']\""
     mise run vm:ssh f44 -- 'sudo systemctl restart gdm'
     ```

   - **Workstation:** `gnome-extensions install --force` the zip, log out and in,
     `gnome-extensions enable rdp-primary-monitor@michal-b-bozek.github.io`, then log out and in
     once more.

3. Turn on the debug lines and follow them in a second terminal. Each state change logs a line
   such as `idle -> focusing on check`; applies and gathers log too.
   - **Workstation:** the `gsettings` command in the [README's Settings](../README.md#settings),
     then `journalctl --user -f -g 'RDP Primary Monitor'`.
   - **Test VM:**

     ```sh
     mise run vm:ssh f44 -- 'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
       gsettings --schemadir \
       ~/.local/share/gnome-shell/extensions/rdp-primary-monitor@michal-b-bozek.github.io/schemas \
       set org.gnome.shell.extensions.rdp-primary-monitor debug-logging true'
     mise run vm:ssh f44 -- "journalctl --user -f -g 'RDP Primary Monitor'"
     ```

     A session restart (`systemctl restart gdm`) ends the `journalctl`; start it again.

4. Take the sum of the stored display layouts: `sha256sum ~/.config/monitors.xml`, or in a VM
   `mise run vm:ssh f44 -- 'sha256sum ~/.config/monitors.xml'`. If the file does not exist, "no
   such file" is the baseline. Take it again at the end of every case: **Check:** unchanged. The
   extension applies temporary configurations only
   ([ADR-0003](architecture/decisions/0003-apply-the-primary-temporarily.md)). Settings → Displays
   writes the file itself, so in cases 3 and 9 take a new sum right after that change and compare
   against it.
5. Open windows and spread them out: on two workspaces and more than one monitor; one maximized,
   one maximized in one direction only, one tiled to half the screen, one fullscreen, one minimized,
   and an application with two windows. Note where each one is; that is the layout a disconnect
   must bring back.

To connect a client to a VM, run `mise run vm:connect f44 --size 1600x900`; to disconnect it, close
the FreeRDP window. On the workstation, connect from another machine with any RDP client. To read
the display state (read-only), use the `gdbus` command in the
[fixtures README](../tests/fixtures/display-config/README.md).

## 1. Connect and disconnect

1. Connect a client.
2. **Check:** within about a second the client's monitor becomes primary: the top bar and
   notifications move to it, and every window from the setup is on it, in its state. The journal
   shows `idle -> focusing` and then `focusing -> focused`.
3. **Record** (workstation): whether the connect itself moved windows on the real monitors before
   the extension acted ([ADR-0004](architecture/decisions/0004-snapshot-and-restore-windows.md),
   part 1).
4. Resize the client's window. **Check:** the journal shows no apply and no state change, and no
   window moves. **Record:** what the display state shows for the client's monitor before and after
   ([ADR-0003](architecture/decisions/0003-apply-the-primary-temporarily.md), part 4).
5. Through the client: move, resize and maximize windows; tile one window, and untile the one tiled
   in the setup; make one fullscreen and minimize another; close one gathered window; open one new
   window.
6. Disconnect.
7. **Check:** the layout from before the connect comes back. The monitors have the same positions
   and the same primary as before; every gathered window is back on its monitor and workspace, in
   its position, size and state; the closed window is skipped with no error in the journal; the new
   window stays where GNOME put it. On the workstation this checks Mutter's own fallback on real
   hardware ([ADR-0003](architecture/decisions/0003-apply-the-primary-temporarily.md)).
   **Record:** whether the tiled windows came back tiled
   ([ADR-0004](architecture/decisions/0004-snapshot-and-restore-windows.md), Tracked separately).

## 2. Settings off

Repeat case 1's steps 1, 2, 6 and 7 once for each setting below, with only that one changed in the
preferences, and change it back afterwards. Read case 1's checks with that setting's effect.

- **Make the remote monitor primary** off. **Check:** the client's monitor does not become primary;
  windows still move to it and come back; the journal shows no `dismissed`.
- **Don’t move windows.** **Check:** the client's monitor becomes primary; the extension moves no
  window (the journal shows no gather), at connect or at disconnect.
- **From the current workspace.** **Check:** only that workspace's windows move and come back.
- **Put the windows back** off. **Check:** windows move at connect and stay where Mutter puts them
  at disconnect.

## 3. The user takes the primary back

1. Connect a client; wait for the windows to move.
2. In Settings → Displays, make a real monitor primary and keep the change. Take a new sum of
   `monitors.xml`: Settings has written it, storing a layout that includes the client's monitor.
3. **Check:** the extension stands aside (journal: `-> dismissed`); it moves nothing and
   does not take the primary back.
4. Disconnect. **Check:** the gathered windows come back as in case 1, except that a window put back
   on a monitor that is no longer primary stays on all workspaces while
   `org.gnome.mutter workspaces-only-on-primary` is on ([design, Restoring](design.md#states));
   `monitors.xml` matches the sum from step 2.

## 4. Lock the screen

Lock with Super+L on the workstation; in a VM, lock and unlock over ssh:

```sh
mise run vm:ssh f44 -- 'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus gdbus call --session \
  --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver \
  --method org.gnome.ScreenSaver.Lock'
mise run vm:ssh f44 -- 'sudo loginctl unlock-sessions'
```

**Without "Allow Locked Remote Desktop"** (stock GNOME, as in the VMs): connect, wait for the windows to move, then lock.
**Check:** the lock ends the client's session; the extension moves nothing behind the lock (Mutter
may park windows when the client leaves); at unlock the windows come back as in case 1
([ADR-0005](architecture/decisions/0005-keep-the-session-through-the-lock-screen.md)).

**With "Allow Locked Remote Desktop"** (workstation, extension enabled at login):

- **Connect while locked:** lock, connect, and look at the client. **Record:** whether the unlock
  dialog is visible and usable on the client's monitor; if not, that is the revisit trigger of
  ADR-0005 parts 2 and 3. Unlock. **Check:** the monitor becomes primary and the windows move only
  after the unlock.
- **Disconnect while locked:** connect, wait for the windows to move, lock, disconnect, unlock.
  **Check:** the extension moves nothing behind the lock (Mutter may park windows when the client
  leaves); the windows come back right after the unlock.
- **Both:** lock, connect, disconnect, unlock. **Check:** the extension moved nothing; the layout is
  as before.
- **Through a lock:** connect, wait for the windows to move, lock, unlock. **Check:** the session
  goes on; nothing moved.
- **Enabled during the session** (needs another extension that runs only in the `user` session
  mode, enabled before this one): turn the extension off and on, connect, wait for the windows to
  move, lock, unlock. **Check:**
  the windows go back behind the lock and move to the client's monitor again at unlock, with no
  error in the journal (ADR-0005, part 1 and its amendments). Log out and in afterwards, so the
  extension is enabled at login again.

## 5. Undock during a session

Workstation with a dock only.

1. Connect a client; wait for the windows to move.
2. Undock, wait a few seconds, dock again. The dock may give its monitors new connector names.
3. **Check:** the windows on the client's monitor stay there. **Record:** whether the client's
   monitor is still primary; if Mutter applied a stored layout at the re-dock, the primary moved and
   the extension stands aside as in case 3.
4. Disconnect. **Check:** every window comes back to the monitor it was on, found by vendor, product
   and serial even if its connector name changed.
5. Repeat with the disconnect while undocked. **Check:** windows from the dock's monitors stay where
   Mutter put them, with a journal line for each; the others come back.

## 6. Two clients

The VMs cannot run this case: `vm:connect` opens one client window with one monitor.

1. From a client machine with two monitors, connect with both (FreeRDP `/multimon`, or `/monitors`
   to pick them). **Check:** one of the two becomes primary and gets the windows. **Record:** how
   many virtual monitors Desktop Sharing created, their serials and positions, and the order they
   appeared in the journal
   ([ADR-0002](architecture/decisions/0002-match-the-virtual-monitor.md)). Save the display state
   as a fixture, sanitized as [AGENTS.md](../AGENTS.md) says.
2. If Desktop Sharing accepts a second client while one is connected, connect it. **Check:** the
   first session keeps its monitor and windows. Disconnect the first. **Check:** the journal shows
   `restoring -> idle` and then `idle -> focusing` for the second client's monitor; its windows
   come back and move straight on to the second client's monitor.

## 7. Turn the extension off during a session

1. Connect a client; wait for the windows to move.
2. Turn the extension off (Extensions app, or `gnome-extensions disable`).
3. **Check:** every gathered window goes back at once to its monitor, position, size and state; the
   client's monitor stays primary until the client disconnects; the journal shows no error. With
   `org.gnome.mutter workspaces-only-on-primary` on (the default), windows put back on the monitor
   that was primary before the session lose their workspace and stay on all workspaces, now and
   after the disconnect; that is expected
   ([design, Lifecycle](design.md#lifecycle-inside-the-shell);
   [ADR-0004](architecture/decisions/0004-snapshot-and-restore-windows.md), part 5).
4. Turn the extension on again with the client still connected. **Check:** a new session starts and
   the windows move to the client's monitor.
5. Disconnect. **Check:** the windows come back to their monitor, position, size and state as when
   you turned the extension on in step 4.
6. Repeat steps 1–3 with **Put the windows back** off. **Check:** turning the extension off still puts the
   windows back.

## 8. Log out and in

1. **Without a client:** connect, disconnect, log out and in (in a VM:
   `mise run vm:ssh f44 -- 'sudo systemctl restart gdm'`). **Check:** no error from the extension
   in the journal; the primary is a real monitor.
2. **With a client** (workstation, if the client stays connected through the log out): connect, log
   out and in. **Check:** at login the extension goes straight to `focusing` and the client's
   monitor becomes primary. Disconnect. **Check:** the windows go back to where they were at login,
   not to where they were before the first connect
   ([design, Lifecycle](design.md#lifecycle-inside-the-shell)).

## 9. Mirrored monitors

Workstation with two monitors.

1. In Settings → Displays, mirror two monitors and keep the change; take a new sum of
   `monitors.xml`.
2. Connect a client. **Check:** no monitor goes dark and the mirrored pair stays mirrored.
   **Record:** whether the client's monitor became primary; if Mutter rejected the layout, the
   journal shows the apply failing twice and `focusing -> dismissed`, and nothing else changes.
3. Disconnect. **Check:** the mirrored layout comes back; `monitors.xml` matches the sum from
   step 1.
4. Undo the mirroring, and take a new sum as the baseline for the next case.

## 10. Other virtual monitors

If anything on the machine adds a virtual monitor without Desktop Sharing, such as a screen cast
with a virtual source, start it with no client connected. **Record:** the monitor's vendor and
product, and whether the journal shows `idle -> focusing`. It does if the monitor carries Desktop
Sharing's vendor and product, which ADR-0002 part 1 would match; that is its revisit trigger
([ADR-0002](architecture/decisions/0002-match-the-virtual-monitor.md)).

## After the run

Turn the debug lines off again. Record any failed check, and anything the design does not describe,
before the release goes ahead; a difference between 49 and 50 goes into the ADR that covers that
behaviour.
