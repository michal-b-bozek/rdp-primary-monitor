// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * Load the captured DisplayConfig replies and the `ApplyMonitorsConfig`
 * arguments in tests/fixtures/display-config/ (its README says what each one
 * holds) as GLib variants of their D-Bus type.
 */

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

/** @typedef {'gnome49' | 'gnome50'} Release */

/**
 * @typedef {'idle' | 'connected' | 'primary-applied' | 'after-disconnect'
 *   | 'reconnected'} StateName
 */

/** @typedef {'single' | 'desk' | 'desk-redocked'} DerivedLayout */

/**
 * @typedef {`${DerivedLayout}-connected` | 'two-clients-connected'}
 *   DerivedStateName
 */

/** Both releases the fixtures were captured on. */
export const RELEASES = /** @type {const} */ (['gnome49', 'gnome50'])

/** `GetCurrentState`'s reply type. */
const STATE_TYPE = '(ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv})'

/** The logical monitors and properties of `ApplyMonitorsConfig`. */
const APPLY_ARGS_TYPE = '(a(iiduba(ssa{sv}))a{sv})'

const DIR = Gio.File.new_for_uri(import.meta.url)
  .get_parent()
  ?.resolve_relative_path('fixtures/display-config')

/**
 * A `GetCurrentState` reply.
 *
 * @param {Release} release
 * @param {StateName} name
 * @returns {GLib.Variant} The reply.
 */
export function displayState(release, name) {
  return load(`${release}-${name}.gvariant`, STATE_TYPE)
}

/**
 * The logical monitors and properties sent with `ApplyMonitorsConfig` to make
 * the virtual monitor of the `connected` state primary.
 *
 * @param {Release} release
 * @returns {GLib.Variant} The arguments.
 */
export function applyArgs(release) {
  return load(`${release}-apply-args.gvariant`, APPLY_ARGS_TYPE)
}

/**
 * A `GetCurrentState` reply written by hand for a layout the test VMs cannot
 * show.
 *
 * @param {DerivedStateName} name
 * @returns {GLib.Variant} The reply.
 */
export function derivedState(name) {
  return load(`derived-${name}.gvariant`, STATE_TYPE)
}

/**
 * The logical monitors and properties, written by hand, that
 * `ApplyMonitorsConfig` takes to make the virtual monitor of the
 * `<layout>-connected` state primary.
 *
 * @param {DerivedLayout} layout
 * @returns {GLib.Variant} The arguments.
 */
export function derivedApplyArgs(layout) {
  return load(`derived-${layout}-apply-args.gvariant`, APPLY_ARGS_TYPE)
}

/**
 * @param {string} name
 * @param {string} type
 * @returns {GLib.Variant} The file's text parsed as `type`.
 */
function load(name, type) {
  if (DIR === undefined) throw new Error('tests/ has no parent directory')
  const [, bytes] = DIR.get_child(name).load_contents(null)
  const text = new TextDecoder().decode(bytes)
  return GLib.Variant.parse(new GLib.VariantType(type), text, null, null)
}
