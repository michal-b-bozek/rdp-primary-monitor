# DisplayConfig state fixtures

Replies of `org.gnome.Mutter.DisplayConfig.GetCurrentState`, as printed by `gdbus call`
(GVariant text, type `(ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv})`). They were
captured in the project's test VMs (`mise run vm:*`): `gnome49-*` from Fedora 43 with GNOME
Shell 49.10, `gnome50-*` from Fedora 44 with GNOME Shell 50.5. Both VMs have two QEMU display
heads, laid out logically (`layout-mode` 1): `Virtual-2` at 5120×2160, scale 2.67, primary at
(0,0), and `Virtual-1` at 1920×1080, scale 1, beside it. The RDP client connected with a
1600×900 window.

| File suffix        | State                                                                           |
| ------------------ | ------------------------------------------------------------------------------- |
| `idle`             | No client: `Virtual-2` primary, `Virtual-1` beside it                           |
| `connected`        | Client connected: virtual monitor `Meta-0` added, not primary                   |
| `primary-applied`  | After `ApplyMonitorsConfig` (temporary) made `Meta-0` primary                   |
| `after-disconnect` | Client gone: Mutter's own fallback to the `idle` layout                         |
| `reconnected`      | Client back: `Meta-0` not primary again, with a new monitor serial (`0x000002`) |

The reply's leading state serial counts monitor changes, not applied configurations:
`connected` and `primary-applied` share it.

To capture a state again, run this in the VM's session (for example through
`mise run vm:ssh f43 -- '…'`):

```sh
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus gdbus call --session \
  --dest org.gnome.Mutter.DisplayConfig --object-path /org/gnome/Mutter/DisplayConfig \
  --method org.gnome.Mutter.DisplayConfig.GetCurrentState
```

A rebuilt VM installs the current GNOME point release: update the versions above, and treat
any difference in the reply as a possible Mutter change.

`connected` was taken with `mise run vm:connect <vm> --size 1600x900` open. `primary-applied`
followed this call, which keeps the logical monitors as they are and marks only `Meta-0`
primary; `SERIAL` is the first number of the `GetCurrentState` reply and `1` is the temporary
method:

```sh
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus gdbus call --session \
  --dest org.gnome.Mutter.DisplayConfig --object-path /org/gnome/Mutter/DisplayConfig \
  --method org.gnome.Mutter.DisplayConfig.ApplyMonitorsConfig "$SERIAL" 1 \
  "[(0, 0, 2.6666667461395264, uint32 0, false, [('Virtual-2', '5120x2160@50.000', @a{sv} {})]),
    (1920, 0, 1.0, uint32 0, false, [('Virtual-1', '1920x1080@74.998', @a{sv} {})]),
    (3840, 0, 1.0, uint32 0, true, [('Meta-0', '1600x900@60.000', @a{sv} {})])]" \
  "{'layout-mode': <uint32 1>}"
```

The fixtures are inputs for unit tests of the code that reads a `GetCurrentState` reply (finding the
virtual monitor, its logical monitor and the current modes) and builds the `ApplyMonitorsConfig`
argument from it. `gnome49-apply-args.gvariant` and `gnome50-apply-args.gvariant` hold that
argument, the logical monitors and properties of the call above (type `(a(iiduba(ssa{sv}))a{sv})`):
the expected output of the build for `connected`. `primary-applied` is the state Mutter reports
after applying it. Tests must parse these files with their type (`GLib.Variant.parse`) and compare
values with `equal()`, never the text, which pins incidental formatting such as the digits of the
copied scale. [`tests/fixtures.js`](../../fixtures.js) loads them that way; the tests of the
monitor matching and the layout are in [`tests/lib/monitors.test.js`](../../lib/monitors.test.js).

They cover one topology: one monitor per logical monitor, no transform, one virtual monitor, logical
layout. Riskier cases (two virtual monitors, a transform, a mirrored logical monitor) need fixtures
of their own, captured or derived by hand and labelled as such here
([ADR-0002](../../../docs/architecture/decisions/0002-match-the-virtual-monitor.md) asks for the
two-virtual-monitor case), and so do two states the design names
([ADR-0003](../../../docs/architecture/decisions/0003-apply-the-primary-temporarily.md), part 4):
the virtual monitor's mode changing after the client resizes its window, and the primary moved off
the virtual monitor while it is present.

The VMs carry no personal data: the QEMU heads report vendor `RHT`, product `QEMU Monitor` and
serial `0x00000000`. Fixtures captured anywhere else follow the sanitizing rule in
[AGENTS.md](../../../AGENTS.md).
