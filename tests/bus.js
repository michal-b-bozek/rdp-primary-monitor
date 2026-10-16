// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * A fake Mutter DisplayConfig on a private D-Bus daemon the test starts and
 * stops itself. Nothing here uses the session bus: GIO keeps a session bus
 * connection it already holds even after DBUS_SESSION_BUS_ADDRESS changes, so
 * a test that relied on it could reach the live Mutter and change the real
 * display configuration. Every connection is opened to the private daemon's own
 * address, and the fake must own the DisplayConfig name there before a test
 * may call anything.
 */

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

const NAME = 'org.gnome.Mutter.DisplayConfig'
const PATH = '/org/gnome/Mutter/DisplayConfig'

/** The two methods display.js calls, with Mutter's signatures. */
const INTERFACE_XML = `<node>
  <interface name="${NAME}">
    <method name="GetCurrentState">
      <arg type="u" direction="out"/>
      <arg type="a((ssss)a(siiddada{sv})a{sv})" direction="out"/>
      <arg type="a(iiduba(ssss)a{sv})" direction="out"/>
      <arg type="a{sv}" direction="out"/>
    </method>
    <method name="ApplyMonitorsConfig">
      <arg type="u" direction="in"/>
      <arg type="u" direction="in"/>
      <arg type="a(iiduba(ssa{sv}))" direction="in"/>
      <arg type="a{sv}" direction="in"/>
    </method>
  </interface>
</node>`

/** `RequestName` flag and reply: fail rather than queue; we own it now. */
const DO_NOT_QUEUE = 4
const PRIMARY_OWNER = 1

/**
 * @typedef {object} FakeMutter
 * @property {Gio.DBusProxy} proxy A DisplayConfig proxy on the private bus,
 *   made as display.js's createProxy makes it.
 * @property {GLib.Variant[]} applied The parameters of every
 *   `ApplyMonitorsConfig` call, oldest first.
 * @property {(error: string | null) => void} failApply The D-Bus error name
 *   `ApplyMonitorsConfig` answers with from now on; null to accept.
 * @property {(hold: boolean) => void} holdReads Keep `GetCurrentState`
 *   unanswered while true.
 */

/**
 * Run `fn` with a fake Mutter serving `state` on a private bus, then tear
 * everything down, whether `fn` succeeds or not.
 *
 * @param {GLib.Variant} state The `GetCurrentState` reply.
 * @param {(mutter: FakeMutter) => Promise<void>} fn
 * @returns {Promise<void>} Settles once the bus is gone.
 */
export async function withFakeMutter(state, fn) {
  const dir = GLib.dir_make_tmp('rdppm-bus-XXXXXX')
  /** @type {(() => void)[]} */
  const undo = [
    () => {
      removeDirectory(dir)
    },
  ]
  try {
    const address = startDaemon(dir, undo)
    const service = connect(address, undo)
    const client = connect(address, undo)

    /** @type {string | null} */
    let applyError = null
    let holding = false
    /** @type {Gio.DBusMethodInvocation[]} */
    const heldReads = []
    /** @type {GLib.Variant[]} */
    const applied = []

    const exported = Gio.DBusExportedObject.wrapJSObject(INTERFACE_XML, {
      /**
       * @param {unknown} _parameters
       * @param {Gio.DBusMethodInvocation} invocation
       */
      GetCurrentStateAsync(_parameters, invocation) {
        if (holding) heldReads.push(invocation)
        else invocation.return_value(state)
      },
      /**
       * @param {unknown} _parameters
       * @param {Gio.DBusMethodInvocation} invocation
       */
      ApplyMonitorsConfigAsync(_parameters, invocation) {
        applied.push(invocation.get_parameters())
        if (applyError === null) invocation.return_value(null)
        else invocation.return_dbus_error(applyError, 'rejected by the fake')
      },
    })
    exported.export(service, PATH)
    undo.push(() => {
      exported.unexport()
    })
    ownName(service)

    const proxy = Gio.DBusProxy.new_sync(
      client,
      Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES |
        Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS,
      null,
      NAME,
      PATH,
      NAME,
      null,
    )

    await fn({
      proxy,
      applied,
      failApply: (error) => {
        applyError = error
      },
      holdReads: (hold) => {
        holding = hold
        if (hold) return
        for (const invocation of heldReads.splice(0)) {
          invocation.return_value(state)
        }
      },
    })
  } catch (error) {
    // The test's own error wins over any teardown error.
    tearDown(undo)
    throw error
  }
  const errors = tearDown(undo)
  if (errors.length > 0) {
    throw new Error(
      `tearing down the fake Mutter failed in ${String(errors.length)} step(s)`,
      { cause: errors[0] },
    )
  }
}

/**
 * Run every step of `undo`, last first, even if one throws, so the daemon
 * still stops and its directory still goes.
 *
 * @param {(() => void)[]} undo
 * @returns {unknown[]} What the steps threw.
 */
function tearDown(undo) {
  /** @type {unknown[]} */
  const errors = []
  for (const step of undo.reverse()) {
    try {
      step()
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

/**
 * Start a session-type dbus-daemon listening in `dir` only.
 *
 * @param {string} dir
 * @param {(() => void)[]} undo Gets the step that stops it.
 * @returns {string} The daemon's address.
 */
function startDaemon(dir, undo) {
  const config = `${dir}/bus.conf`
  GLib.file_set_contents(
    config,
    `<busconfig>
  <type>session</type>
  <listen>unix:dir=${dir}</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>`,
  )
  // A shell holds the daemon until its stdin closes, then stops it and
  // removes `dir`. The pipe closes when the teardown closes it and also when
  // the test process exits without one, as after a test that timed out, so
  // no daemon outlives the run. The shell lets go of stdout at once, so a
  // daemon that fails to start ends the output instead of leaving the read
  // below waiting.
  const daemon = Gio.Subprocess.new(
    [
      'sh',
      '-c',
      'dbus-daemon --config-file="$1" --nofork --print-address=1 & pid=$!; ' +
        'exec > /dev/null; cat > /dev/null; kill "$pid"; wait "$pid"; rm -rf "$2"',
      'sh',
      config,
      dir,
    ],
    Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE,
  )
  undo.push(() => {
    daemon.get_stdin_pipe()?.close(null)
    daemon.wait(null)
  })
  const stdout = daemon.get_stdout_pipe()
  if (stdout === null) throw new Error('dbus-daemon has no stdout')
  const reader = new Gio.DataInputStream({ base_stream: stdout })
  const [line] = reader.read_line_utf8(null)
  reader.close(null)
  const address = line?.trim() ?? ''
  if (address === '') {
    throw new Error('dbus-daemon did not start (is it installed?)')
  }
  // Confirms the daemon is the private one, not the live session bus.
  if (!address.startsWith(`unix:path=${dir}/`)) {
    throw new Error(`dbus-daemon gave an unexpected address: ${address}`)
  }
  return address
}

/**
 * @param {string} address
 * @param {(() => void)[]} undo Gets the step that closes it.
 * @returns {Gio.DBusConnection} A connection to the private daemon.
 */
function connect(address, undo) {
  const connection = Gio.DBusConnection.new_for_address_sync(
    address,
    Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT |
      Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
    null,
    null,
  )
  undo.push(() => {
    connection.close_sync(null)
  })
  return connection
}

/**
 * Own the DisplayConfig name on `connection`'s bus, or throw.
 *
 * @param {Gio.DBusConnection} connection
 * @returns {void}
 */
function ownName(connection) {
  const reply = connection.call_sync(
    'org.freedesktop.DBus',
    '/org/freedesktop/DBus',
    'org.freedesktop.DBus',
    'RequestName',
    new GLib.Variant('(su)', [NAME, DO_NOT_QUEUE]),
    new GLib.VariantType('(u)'),
    Gio.DBusCallFlags.NONE,
    -1,
    null,
  )
  const result = reply.get_child_value(0).get_uint32()
  if (result !== PRIMARY_OWNER) {
    throw new Error(
      `the fake does not own ${NAME} (RequestName: ${String(result)})`,
    )
  }
}

/**
 * Remove `dir` and the files in it (the config, and the socket if the
 * daemon left it).
 *
 * @param {string} dir
 * @returns {void}
 */
function removeDirectory(dir) {
  const directory = Gio.File.new_for_path(dir)
  // The daemon's shell removes it once it stops; this is for a shell that
  // never started.
  if (!directory.query_exists(null)) return
  const children = directory.enumerate_children(
    'standard::name',
    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
    null,
  )
  for (const info of children) {
    directory.get_child(info.get_name()).delete(null)
  }
  directory.delete(null)
}
