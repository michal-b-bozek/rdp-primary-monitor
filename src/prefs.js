// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * The preferences window: the three settings docs/design.md lets the user turn
 * off or change (Focusing). The timing and debug-logging keys stay hidden.
 * Runs in the preferences process, not in the Shell.
 */

import Adw from 'gi://Adw'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Gtk from 'gi://Gtk'
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

/** @import { GatherMode } from './lib/gather.js' */

/** The action group prefix of the gather-mode radio rows. */
const ACTIONS = 'rdppm'

export default class RdpPrimaryMonitorPreferences extends ExtensionPreferences {
  /**
   * @override
   * @param {Adw.PreferencesWindow} window
   * @returns {Promise<void>}
   */
  fillPreferencesWindow(window) {
    // The bindings and the action keep the settings alive with the window.
    const settings = this.getSettings()
    const actions = new Gio.SimpleActionGroup()
    actions.add_action(settings.create_action('gather-mode'))
    window.insert_action_group(ACTIONS, actions)

    const connect = new Adw.PreferencesGroup({
      title: 'When a client connects',
    })
    connect.add(
      switchRow(
        settings,
        'make-primary',
        'Make the remote monitor primary',
        'The top bar and notifications move to it',
      ),
    )

    const gather = new Adw.PreferencesGroup({
      title: 'Move windows to the remote monitor',
      description:
        'Every window keeps its workspace while the remote monitor is primary',
    })
    gather.add(gatherRow('all-workspaces', 'From all workspaces'))
    gather.add(gatherRow('current-workspace', 'From the current workspace'))
    gather.add(gatherRow('off', 'Don’t move windows'))

    const disconnect = new Adw.PreferencesGroup({
      title: 'When the client disconnects',
    })
    disconnect.add(
      switchRow(
        settings,
        'restore-on-disconnect',
        'Put the windows back',
        'Each moved window returns to where it was, if its monitor still exists',
      ),
    )

    const page = new Adw.PreferencesPage()
    page.add(connect)
    page.add(gather)
    page.add(disconnect)
    // libadwaita deprecates the whole PreferencesWindow for PreferencesDialog,
    // but fillPreferencesWindow() is still given one, and add() is the way to
    // fill it.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- see above
    window.add(page)
    return Promise.resolve()
  }
}

/**
 * @param {Gio.Settings} settings
 * @param {'make-primary' | 'restore-on-disconnect'} key A boolean key.
 * @param {string} title
 * @param {string} subtitle
 * @returns {Adw.SwitchRow} A switch bound to `key`.
 */
function switchRow(settings, key, title, subtitle) {
  const row = new Adw.SwitchRow({ title, subtitle })
  settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT)
  return row
}

/**
 * @param {GatherMode} mode
 * @param {string} title
 * @returns {Adw.ActionRow} A radio row that sets `gather-mode` to `mode`.
 */
function gatherRow(mode, title) {
  const check = new Gtk.CheckButton({
    action_name: `${ACTIONS}.gather-mode`,
    action_target: new GLib.Variant('s', mode),
    valign: Gtk.Align.CENTER,
  })
  const row = new Adw.ActionRow({ title, activatable_widget: check })
  row.add_prefix(check)
  return row
}
