// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * Run every `*.test.js` under tests/ in GJS (`gjs -m tests/run.js`, which
 * `mise run test` does): import each file in path order, run its tests one at a
 * time, print one line per test and a summary, and exit with 1 if a test
 * failed, a file failed to load or no test ran.
 *
 * A GLib main loop runs meanwhile, so tests can await GLib's async calls. A
 * test fails when it throws or rejects, when it has not settled after
 * `TIMEOUT_MS`, or when GLib logs a warning or worse while it runs, which is
 * how GJS reports an exception thrown in a callback (a signal handler, an
 * idle). GJS reports an unhandled rejection only when it exits, too late to
 * fail a test, so tests must await their promises. Every warning counts,
 * expected or not: code under test logs through a fake where a test checks a
 * warning. A test that timed out may leave callbacks behind that fail the
 * next one; read the first failure after a timeout.
 */

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import System from 'system'

import { takeTests } from './harness.js'

const TIMEOUT_MS = 5000

const WARNING_OR_WORSE =
  GLib.LogLevelFlags.LEVEL_ERROR |
  GLib.LogLevelFlags.LEVEL_CRITICAL |
  GLib.LogLevelFlags.LEVEL_WARNING

/** Warnings and worse logged so far; they still reach stderr. */
let logged = 0
GLib.log_set_writer_func((level) => {
  if ((level & WARNING_OR_WORSE) !== 0) logged += 1
  return GLib.LogWriterOutput.UNHANDLED
})

/**
 * @param {Gio.File} dir
 * @returns {Gio.File[]} The `*.test.js` files under `dir`, at any depth.
 */
function findTestFiles(dir) {
  /** @type {Gio.File[]} */
  const found = []
  const children = dir.enumerate_children(
    'standard::name,standard::type',
    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
    null,
  )
  for (const info of children) {
    const child = dir.get_child(info.get_name())
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
      found.push(...findTestFiles(child))
    } else if (info.get_name().endsWith('.test.js')) {
      found.push(child)
    }
  }
  return found
}

/**
 * Run `fn`, failing it when it runs longer than `TIMEOUT_MS` or when GLib logs
 * a warning or worse meanwhile.
 *
 * @param {() => unknown} fn
 * @returns {Promise<void>} Settles when `fn` has.
 */
async function runChecked(fn) {
  const before = logged
  const timer = { id: 0, fired: false }
  const timeout = new Promise((_resolve, reject) => {
    timer.id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TIMEOUT_MS, () => {
      timer.fired = true
      reject(new Error(`timed out after ${String(TIMEOUT_MS)} ms`))
      return GLib.SOURCE_REMOVE
    })
  })
  try {
    await Promise.race([fn(), timeout])
  } finally {
    // Removing a source that already ran would log a critical.
    if (!timer.fired) GLib.source_remove(timer.id)
  }
  if (logged > before) {
    throw new Error(
      `GLib logged ${String(logged - before)} warning(s) or worse (above)`,
    )
  }
}

/**
 * @returns {Promise<number>} The exit status.
 */
async function main() {
  const testsDir = Gio.File.new_for_uri(import.meta.url).get_parent()
  if (testsDir === null) throw new Error('run.js has no parent directory')
  const files = findTestFiles(testsDir)
    .map((file) => ({ file, path: relativePath(testsDir, file) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  let passed = 0
  let failed = 0
  for (const { file, path } of files) {
    takeTests()
    try {
      await runChecked(() => import(file.get_uri()))
    } catch (error) {
      failed += 1
      print(`not ok - ${path}: failed to load`)
      printerr(describe(error))
      continue
    }
    for (const { name, fn } of takeTests()) {
      try {
        await runChecked(fn)
        passed += 1
        print(`ok - ${path}: ${name}`)
      } catch (error) {
        failed += 1
        print(`not ok - ${path}: ${name}`)
        printerr(describe(error))
      }
    }
  }
  print(`${String(passed)} passed, ${String(failed)} failed`)
  if (passed + failed === 0) {
    printerr('error: no tests found under tests/')
    return 1
  }
  return failed === 0 ? 0 : 1
}

/**
 * @param {Gio.File} dir
 * @param {Gio.File} file A file under `dir`.
 * @returns {string} The path of `file` relative to `dir`.
 */
function relativePath(dir, file) {
  const path = dir.get_relative_path(file)
  if (path === null) throw new Error(`${file.get_uri()} is outside tests/`)
  return path
}

/**
 * @param {unknown} error
 * @returns {string} The error with its stack and causes, indented under the
 *   test line.
 */
function describe(error) {
  /** @type {string[]} */
  const parts = []
  /** @type {Set<unknown>} A cause chain can loop back on itself. */
  const seen = new Set()
  /** @type {unknown} */
  let current = error
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)
    parts.push(render(current).trimEnd())
    current =
      current instanceof Error && current.cause !== undefined
        ? current.cause
        : undefined
    if (seen.has(current)) parts.push('caused by: (an error above)')
    else if (current !== undefined) parts.push('caused by:')
  }
  return parts
    .join('\n')
    .trimEnd()
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

/**
 * @param {unknown} error
 * @returns {string} One error with its stack, if it has one: a `GLib.Error`
 *   is not an `Error` in GJS but has a stack too.
 */
function render(error) {
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : error instanceof GLib.Error
        ? `GLib.Error: ${error.message}`
        : toText(error)
  const stack =
    typeof error === 'object' && error !== null && 'stack' in error
      ? error.stack
      : undefined
  return typeof stack === 'string' ? `${text}\n${stack}` : text
}

/**
 * @param {unknown} value Something thrown that is not an error.
 * @returns {string} Its text, even for an object that cannot be converted.
 */
function toText(value) {
  try {
    return String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

const loop = new GLib.MainLoop(null, false)
let status = 1
main()
  .then((code) => {
    status = code
  })
  .catch((/** @type {unknown} */ error) => {
    printerr(`error: the runner failed\n${describe(error)}`)
  })
  .finally(() => {
    loop.quit()
  })
loop.run()
System.exit(status)
