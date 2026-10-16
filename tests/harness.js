// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * The test API: `test()` registers a test while its file is imported, and the
 * assertions throw an `AssertionError` that `run.js` reports. GJS has no
 * `node:assert`, so the few assertions the tests need live here.
 */

/**
 * @typedef {object} Test
 * @property {string} name
 * @property {() => void | Promise<void>} fn
 */

/** @type {Test[]} */
const registered = []

/**
 * Register a test. Call it at the top level of a `*.test.js` file.
 *
 * @param {string} name What the test shows, as a lowercase clause.
 * @param {() => void | Promise<void>} fn Throws (or rejects) to fail.
 * @returns {void}
 */
export function test(name, fn) {
  registered.push({ name, fn })
}

/**
 * Hand the tests registered since the last call to the runner.
 *
 * @returns {Test[]} The tests, in the order they were registered.
 */
export function takeTests() {
  return registered.splice(0)
}

export class AssertionError extends Error {
  /** @override */
  name = 'AssertionError'
}

/**
 * Fail unless `value` is true.
 *
 * @param {boolean} value
 * @param {string} message What was expected.
 * @returns {asserts value}
 */
export function assertTrue(value, message) {
  if (!value) throw new AssertionError(message)
}

/**
 * Fail unless `actual` and `expected` are structurally equal: the same
 * primitives (by `Object.is`), arrays with equal items in the same order, and
 * plain objects with the same own keys and equal values.
 *
 * @template T
 * @param {T} actual
 * @param {T} expected
 * @returns {void}
 */
export function assertEqual(actual, expected) {
  const difference = findDifference(actual, expected, '')
  if (difference !== null) {
    throw new AssertionError(
      `${difference}\n  actual:   ${show(actual)}\n  expected: ${show(expected)}`,
    )
  }
}

/**
 * Fail unless `fn` throws an instance of `type` whose message matches
 * `pattern`.
 *
 * @param {() => unknown} fn
 * @param {abstract new (...args: never[]) => Error} type
 * @param {RegExp} pattern
 * @returns {void}
 */
export function assertThrows(fn, type, pattern) {
  try {
    fn()
  } catch (error) {
    checkError(error, type, pattern)
    return
  }
  throw new AssertionError(`expected ${type.name} matching ${String(pattern)}`)
}

/**
 * @param {unknown} error
 * @param {abstract new (...args: never[]) => Error} type
 * @param {RegExp} pattern
 * @returns {void}
 */
function checkError(error, type, pattern) {
  if (!(error instanceof type)) {
    throw new AssertionError(`expected ${type.name}, got ${show(error)}`, {
      cause: error,
    })
  }
  if (!pattern.test(error.message)) {
    throw new AssertionError(
      `expected a message matching ${String(pattern)}, got "${error.message}"`,
      { cause: error },
    )
  }
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} path Where in the compared values, for the message.
 * @returns {string | null} The first difference, or null for none.
 */
function findDifference(actual, expected, path) {
  const where = path === '' ? 'value' : path
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${where}: expected an array`
    if (actual.length !== expected.length) {
      return `${where}: expected length ${String(expected.length)}, got ${String(actual.length)}`
    }
    for (const [i, item] of expected.entries()) {
      const difference = findDifference(
        actual[i],
        item,
        `${path}[${String(i)}]`,
      )
      if (difference !== null) return difference
    }
    return null
  }
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return `${where}: expected a plain object`
    const actualKeys = Object.keys(actual).sort()
    const expectedKeys = Object.keys(expected).sort()
    if (show(actualKeys) !== show(expectedKeys)) {
      return `${where}: expected keys ${show(expectedKeys)}, got ${show(actualKeys)}`
    }
    for (const key of expectedKeys) {
      const difference = findDifference(
        actual[key],
        expected[key],
        `${path}.${key}`,
      )
      if (difference !== null) return difference
    }
    return null
  }
  return Object.is(actual, expected) ? null : `${where}: not equal`
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>} True for an object literal or a
 *   null-prototype object.
 */
function isPlainObject(value) {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * @param {unknown} value
 * @returns {string} A one-line rendering for a failure message.
 */
function show(value) {
  // JSON has no undefined, function or symbol: stringify() returns undefined.
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    return String(value)
  }
  try {
    // JSON writes -0 as 0, which would hide why Object.is told them apart.
    return JSON.stringify(value, (_key, item) =>
      Object.is(item, -0) ? '-0' : /** @type {unknown} */ (item),
    )
  } catch {
    // A cycle, a BigInt or a GObject.
    return Object.prototype.toString.call(value)
  }
}
