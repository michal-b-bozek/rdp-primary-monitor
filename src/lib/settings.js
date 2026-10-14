// SPDX-License-Identifier: MIT
/**
 * The extension's settings as the rest of the code reads them: one getter per
 * key, called when the value is needed, so a change takes effect at the next
 * step that uses it (docs/design.md, Focusing).
 */

/** @import { GatherMode } from './gather.js' */

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
 * The defaults docs/design.md gives (States, Focusing), for use until the
 * GSettings schema exists.
 *
 * @returns {Settings} Getters that return the defaults.
 */
export function defaultSettings() {
  return {
    makePrimary: () => true,
    gatherMode: () => 'all-workspaces',
    restoreOnDisconnect: () => true,
    debounceMs: () => 500,
    settleMs: () => 250,
    debugLogging: () => false,
  }
}
