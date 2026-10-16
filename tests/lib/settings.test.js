// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * src/lib/settings.js against the shipped schema, compiled into a temporary
 * directory with the host's glib-compile-schemas and read through a memory
 * backend: each getter reads its own key, each read sees the current value,
 * and the code and the schema agree on the gather modes.
 */

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { settingsFrom } from '../../src/lib/settings.js'
import { assertEqual, assertTrue, test } from '../harness.js'

const SCHEMA_ID = 'org.gnome.shell.extensions.rdp-primary-monitor'

const SCHEMAS_DIR = Gio.File.new_for_uri(import.meta.url)
  .resolve_relative_path('../../../src/schemas')
  .get_path()

/** @type {Gio.SettingsSchema | null} Compiled once, on first use. */
let compiled = null

/**
 * @returns {Gio.SettingsSchema} The shipped schema, compiled.
 */
function schema() {
  if (compiled !== null) return compiled
  if (SCHEMAS_DIR === null) throw new Error('src/schemas has no local path')
  const target = GLib.dir_make_tmp('rdppm-schemas-XXXXXX')
  try {
    const process = Gio.Subprocess.new(
      [
        'glib-compile-schemas',
        '--strict',
        `--targetdir=${target}`,
        SCHEMAS_DIR,
      ],
      Gio.SubprocessFlags.STDERR_PIPE,
    )
    const [, , stderr] = process.communicate_utf8(null, null)
    if (!process.get_successful()) {
      throw new Error(`glib-compile-schemas failed: ${stderr}`)
    }
    const source = Gio.SettingsSchemaSource.new_from_directory(
      target,
      Gio.SettingsSchemaSource.get_default(),
      false,
    )
    const found = source.lookup(SCHEMA_ID, false)
    if (found === null) throw new Error(`${SCHEMA_ID} is not in the schema`)
    compiled = found
    return found
  } finally {
    // The source has read the compiled file, if there is one; neither it nor
    // the directory is needed now.
    removeIfPresent(`${target}/gschemas.compiled`)
    removeIfPresent(target)
  }
}

/**
 * @param {string} path
 * @returns {void}
 */
function removeIfPresent(path) {
  try {
    Gio.File.new_for_path(path).delete(null)
  } catch (error) {
    if (
      !(error instanceof GLib.Error) ||
      !error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)
    ) {
      throw error
    }
  }
}

/**
 * @returns {Gio.Settings} Settings of the shipped schema in a memory backend.
 */
function gsettings() {
  return new Gio.Settings({
    settings_schema: schema(),
    backend: Gio.memory_settings_backend_new(),
  })
}

/** The boolean keys, each with its getter. */
const BOOLEANS = /** @type {const} */ ([
  ['make-primary', 'makePrimary'],
  ['restore-on-disconnect', 'restoreOnDisconnect'],
  ['debug-logging', 'debugLogging'],
])

for (const [key, getter] of BOOLEANS) {
  test(`${getter} reads ${key}`, () => {
    const backing = gsettings()
    for (const [other] of BOOLEANS) backing.set_boolean(other, other === key)

    const settings = settingsFrom(backing)

    assertEqual(
      BOOLEANS.map(([, name]) => settings[name]()),
      BOOLEANS.map(([other]) => other === key),
    )
  })
}

test('debounceMs and settleMs read their own keys', () => {
  const backing = gsettings()
  backing.set_uint('debounce-ms', 1234)
  backing.set_uint('settle-ms', 567)

  const settings = settingsFrom(backing)

  assertEqual([settings.debounceMs(), settings.settleMs()], [1234, 567])
})

test('a getter returns the current value each time it is called', () => {
  const backing = gsettings()
  const settings = settingsFrom(backing)
  const before = settings.debounceMs()

  backing.set_uint('debounce-ms', before + 100)

  assertEqual(settings.debounceMs(), before + 100)
})

test('every gather mode the schema allows is one the code knows', () => {
  const backing = gsettings()
  const settings = settingsFrom(backing)
  const [kind, nicks] = /** @type {[string, string[]]} */ (
    schema().get_key('gather-mode').get_range().recursiveUnpack()
  )
  assertEqual(kind, 'enum')
  assertTrue(nicks.length > 0, 'the schema lists gather modes')

  const read = nicks.map((nick) => {
    backing.set_string('gather-mode', nick)
    return settings.gatherMode()
  })

  assertEqual(read, nicks)
})
