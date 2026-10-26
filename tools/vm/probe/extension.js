// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * Test-VM-only helper for docs/testing.md, never shipped: `org.rdppm.Probe`
 * on the session bus reports the windows and monitors (`State`) and arranges
 * windows (`Do`), so the VM cases can run over ssh (`mise run vm:probe`).
 * Both methods take a file path, because JSON quoted for gdbus and ssh breaks.
 */

import Clutter from 'gi://Clutter'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Meta from 'gi://Meta'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

const INTERFACE = `<node><interface name="org.rdppm.Probe">
  <method name="State"><arg type="s" direction="in" name="path"/></method>
  <method name="Do">
    <arg type="s" direction="in" name="path"/>
    <arg type="s" direction="out" name="result"/>
  </method>
</interface></node>`

/**
 * @typedef {'key' | 'monitor' | 'workspace' | 'frame' | 'maximize'
 *   | 'unmaximize' | 'fullscreen' | 'unfullscreen' | 'minimize' | 'unminimize'
 *   | 'close'} OperationName
 */

/**
 * One operation of `Do`: a window, chosen by `wm_class` and its `nth` window
 * of that class (by id), and what to do to it. `key` presses `keyval` on the
 * focused window and needs no window.
 *
 * @typedef {object} Operation
 * @property {OperationName} op
 * @property {string} [cls]
 * @property {number} [nth]
 * @property {number} [index] Monitor or workspace index.
 * @property {[number, number, number, number]} [frame] x, y, width, height.
 * @property {number} [flags] Maximize flags: 1 horizontal, 2 vertical, 3
 *   both (the default); anything else is an error.
 * @property {number} [keyval]
 */

/**
 * @typedef {object} WindowState
 * @property {number} id
 * @property {string | null} cls
 * @property {string | null} monitor
 * @property {number} workspace -1 when on all workspaces.
 * @property {number[]} frame x, y, width, height.
 * @property {number} maximize
 * @property {boolean} fullscreen
 * @property {boolean} minimized
 */

/**
 * @typedef {object} ProbeState
 * @property {string | null} primary
 * @property {number} activeWorkspace
 * @property {number} workspaces
 * @property {{ connector: string, index: number, geometry: number[] }[]} monitors
 * @property {WindowState[]} windows
 */

/**
 * @param {Meta.Window} window
 * @returns {boolean} True for a window the extension handles.
 */
function isNormal(window) {
  return (
    window.get_window_type() === Meta.WindowType.NORMAL &&
    !window.is_skip_taskbar()
  )
}

/** @returns {Meta.Window[]} The normal windows, by id. */
function normalWindows() {
  return global.display
    .list_all_windows()
    .filter(isNormal)
    .sort((a, b) => a.get_id() - b.get_id())
}

/** @returns {{ connector: string, index: number, geometry: number[] }[]} */
function monitors() {
  const manager = global.backend.get_monitor_manager()
  return (manager.get_monitors() ?? []).map((monitor) => {
    const connector = monitor.get_connector()
    const index = manager.get_monitor_for_connector(connector)
    const g = index < 0 ? null : global.display.get_monitor_geometry(index)
    return {
      connector,
      index,
      geometry: g === null ? [] : [g.x, g.y, g.width, g.height],
    }
  })
}

/** @returns {ProbeState} What `State` writes. */
function state() {
  const present = monitors()
  const connectorOf = (/** @type {number} */ index) =>
    present.find((m) => m.index === index)?.connector ?? null
  return {
    primary: connectorOf(global.display.get_primary_monitor()),
    activeWorkspace: global.workspace_manager.get_active_workspace_index(),
    workspaces: global.workspace_manager.get_n_workspaces(),
    monitors: present,
    windows: normalWindows().map((w) => {
      const f = w.get_frame_rect()
      return {
        id: w.get_id(),
        cls: w.get_wm_class(),
        monitor: connectorOf(w.get_monitor()),
        workspace: w.is_on_all_workspaces() ? -1 : w.get_workspace().index(),
        frame: [f.x, f.y, f.width, f.height],
        maximize: w.get_maximize_flags(),
        fullscreen: w.is_fullscreen(),
        minimized: w.minimized,
      }
    }),
  }
}

/**
 * @template T
 * @param {T | undefined | null} value
 * @param {string} name
 * @returns {T} The value; a missing one throws, naming it.
 */
function required(value, name) {
  if (value === undefined || value === null) throw new Error(`needs ${name}`)
  return value
}

export default class Probe extends Extension {
  /** @type {Gio.DBusExportedObject | null} */
  #exported = null
  /** @type {number} */
  #name = 0
  /** @type {Clutter.VirtualInputDevice | null} */
  #keyboard = null

  /** @override */
  enable() {
    this.#keyboard = Clutter.get_default_backend()
      .get_default_seat()
      .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE)
    this.#exported = Gio.DBusExportedObject.wrapJSObject(INTERFACE, {
      State: (/** @type {string} */ path) => {
        GLib.file_set_contents(path, JSON.stringify(state(), null, 1))
      },
      Do: (/** @type {string} */ path) => this.#run(path),
    })
    this.#exported.export(Gio.DBus.session, '/org/rdppm/Probe')
    this.#name = Gio.bus_own_name_on_connection(
      Gio.DBus.session,
      'org.rdppm.Probe',
      Gio.BusNameOwnerFlags.NONE,
      null,
      null,
    )
  }

  /** @override */
  disable() {
    this.#exported?.unexport()
    this.#exported = null
    if (this.#name !== 0) Gio.bus_unown_name(this.#name)
    this.#name = 0
    this.#keyboard = null
  }

  /**
   * @param {string} path A JSON file of operations.
   * @returns {string} One line per operation: `ok` or `ERR` and why.
   */
  #run(path) {
    const [, bytes] = GLib.file_get_contents(path)
    /** @type {unknown} */
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    if (!Array.isArray(parsed)) return 'ERR the file holds no JSON array'
    const operations = /** @type {Operation[]} */ (parsed)
    return operations
      .map((operation, i) => {
        let label = `#${String(i)}`
        try {
          label = `${operation.op} ${operation.cls ?? ''}`.trim()
          this.#apply(operation)
          return `ok ${label}`
        } catch (error) {
          return `ERR ${label}: ${String(error)}`
        }
      })
      .join('\n')
  }

  /**
   * @param {Operation} operation
   * @returns {void}
   */
  #apply(operation) {
    if (operation.op === 'key') {
      const keyval = operation.keyval
      if (keyval === undefined) throw new Error('key needs a keyval')
      const now = GLib.get_monotonic_time()
      this.#keyboard?.notify_keyval(now, keyval, Clutter.KeyState.PRESSED)
      this.#keyboard?.notify_keyval(
        now + 1000,
        keyval,
        Clutter.KeyState.RELEASED,
      )
      return
    }
    const window = normalWindows().filter(
      (w) => w.get_wm_class() === operation.cls,
    )[operation.nth ?? 0]
    if (window === undefined) throw new Error('no such window')
    switch (operation.op) {
      case 'monitor':
        window.move_to_monitor(required(operation.index, 'index'))
        break
      case 'workspace':
        window.change_workspace_by_index(
          required(operation.index, 'index'),
          false,
        )
        break
      case 'frame': {
        const [x, y, width, height] = required(operation.frame, 'frame')
        window.move_resize_frame(true, x, y, width, height)
        break
      }
      case 'maximize':
        // Mutter 49 and 50: maximize() means both directions.
        if (operation.flags === undefined || operation.flags === 3) {
          window.maximize()
        } else if (operation.flags === 1) {
          window.set_maximize_flags(Meta.MaximizeFlags.HORIZONTAL)
        } else if (operation.flags === 2) {
          window.set_maximize_flags(Meta.MaximizeFlags.VERTICAL)
        } else {
          throw new Error(`no maximize flags ${String(operation.flags)}`)
        }
        break
      case 'unmaximize':
        window.unmaximize()
        break
      case 'fullscreen':
        window.make_fullscreen()
        break
      case 'unfullscreen':
        window.unmake_fullscreen()
        break
      case 'minimize':
        window.minimize()
        break
      case 'unminimize':
        window.unminimize()
        break
      case 'close':
        window.delete(global.get_current_time())
        break
      default: {
        /** @type {never} */
        const unknown = operation.op
        throw new Error(`unknown op ${String(unknown)}`)
      }
    }
  }
}
