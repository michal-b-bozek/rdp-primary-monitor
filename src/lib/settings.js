// SPDX-License-Identifier: MIT
/**
 * The extension's settings as the rest of the code reads them: one getter per
 * key, called when the value is needed, so a change takes effect at the next
 * step that uses it (docs/design.md, Focusing).
 */

/**
 * @import Gio from 'gi://Gio'
 * @import { GatherMode } from './gather.js'
 */

/**
 * @typedef {object} Settings
 * @property {() => boolean} makePrimary
 * @property {() => GatherMode} gatherMode
 * @property {() => boolean} restoreOnDisconnect
 * @property {() => number} debounceMs
 * @property {() => number} settleMs
 * @property {() => boolean} debugLogging
 */

/**
 * The `GatherMode` enum's nicks in the schema, keyed by the type so that a
 * mode added to one and not the other fails the type-check.
 *
 * @type {Readonly<Record<GatherMode, true>>}
 */
const GATHER_MODES = {
  'all-workspaces': true,
  'current-workspace': true,
  off: true,
}

/**
 * The settings, read through the extension's GSettings on every call.
 * The schema holds the defaults and the ranges.
 *
 * @param {Gio.Settings} gsettings From `getSettings()`.
 * @returns {Settings} Getters over `gsettings`.
 */
export function settingsFrom(gsettings) {
  return {
    makePrimary: () => gsettings.get_boolean('make-primary'),
    gatherMode: () => toGatherMode(gsettings.get_string('gather-mode')),
    restoreOnDisconnect: () => gsettings.get_boolean('restore-on-disconnect'),
    debounceMs: () => gsettings.get_uint('debounce-ms'),
    settleMs: () => gsettings.get_uint('settle-ms'),
    debugLogging: () => gsettings.get_boolean('debug-logging'),
  }
}

/**
 * @param {string} nick
 * @returns {GatherMode} `nick`, narrowed.
 */
function toGatherMode(nick) {
  // The schema's enum allows only these nicks; another one means the schema
  // and this list have drifted apart.
  if (!isGatherMode(nick)) throw new Error(`unknown gather-mode "${nick}"`)
  return nick
}

/**
 * @param {string} nick
 * @returns {nick is GatherMode} Whether `nick` is one of the modes.
 */
function isGatherMode(nick) {
  return Object.hasOwn(GATHER_MODES, nick)
}
