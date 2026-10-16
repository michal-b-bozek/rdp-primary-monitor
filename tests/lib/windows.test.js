// SPDX-FileCopyrightText: 2026 Michał Bogusław Bożek
// SPDX-License-Identifier: MIT
/**
 * src/lib/windows.js: how a window's original monitor is found again and the
 * calls that put a gathered window back, in the order ADR-0004 part 4 and its
 * amendments set.
 */

import {
  findOriginalMonitor,
  planRestore,
  toMonitorFrame,
} from '../../src/lib/windows.js'
import { assertEqual, test } from '../harness.js'

/**
 * @import {
 *   CurrentWindow, MonitorKey, PresentMonitor, RestoreStep, WindowRecord,
 * } from '../../src/lib/windows.js'
 */

/** `Meta.MaximizeFlags`. */
const HORIZONTAL = 1
const VERTICAL = 2
const BOTH = 3

/**
 * @param {Partial<PresentMonitor>} [overrides]
 * @returns {PresentMonitor} A present monitor; by default the laptop panel
 *   at index 0, at the origin.
 */
function monitor(overrides = {}) {
  return {
    vendor: 'BOE',
    product: 'Panel',
    serial: '0x1',
    connector: 'eDP-1',
    index: 0,
    geometry: { x: 0, y: 0, width: 1920, height: 1200 },
    ...overrides,
  }
}

/** The external monitor the windows were on, at index 1 right of the panel. */
const EXTERNAL = monitor({
  vendor: 'DEL',
  product: 'U2720Q',
  serial: 'ABC123',
  connector: 'DP-6',
  index: 1,
  geometry: { x: 1920, y: 0, width: 2560, height: 1440 },
})

/**
 * @param {Partial<WindowRecord>} [overrides]
 * @returns {WindowRecord} A plain window on workspace 1 of EXTERNAL.
 */
function saved(overrides = {}) {
  return {
    workspace: 1,
    monitor: {
      vendor: EXTERNAL.vendor,
      product: EXTERNAL.product,
      serial: EXTERNAL.serial,
      connector: EXTERNAL.connector,
    },
    frame: { x: 100, y: 50, width: 800, height: 600 },
    maximizeFlags: 0,
    fullscreen: false,
    minimized: false,
    ...overrides,
  }
}

/**
 * @param {Partial<CurrentWindow>} [overrides]
 * @returns {CurrentWindow} A plain window on workspace 1.
 */
function now(overrides = {}) {
  return {
    workspace: 1,
    maximizeFlags: 0,
    fullscreen: false,
    minimized: false,
    ...overrides,
  }
}

/**
 * @param {WindowRecord} record
 * @param {CurrentWindow} current
 * @param {number} [workspaceCount]
 * @returns {RestoreStep[]} The plan with the panel and EXTERNAL present;
 *   throws if there is none, which only a gone monitor may cause.
 */
function plan(record, current, workspaceCount = 4) {
  const steps = planRestore(
    record,
    current,
    [monitor(), EXTERNAL],
    workspaceCount,
  )
  if (steps === null) throw new Error('no plan for a present monitor')
  return steps
}

/**
 * @param {RestoreStep[]} steps
 * @returns {string[]} The kinds of the steps, in order.
 */
function kinds(steps) {
  return steps.map((step) => step.kind)
}

// --- the monitor -----------------------------------------------------------

test('a frame is stored relative to its monitor', () => {
  assertEqual(
    toMonitorFrame(
      { x: 2020, y: 50, width: 800, height: 600 },
      { x: 1920, y: 0, width: 2560, height: 1440 },
    ),
    { x: 100, y: 50, width: 800, height: 600 },
  )
})

test('the original monitor is found by identity when its connector changed', () => {
  const key = { ...saved().monitor, connector: 'DP-8' }

  assertEqual(findOriginalMonitor(key, [monitor(), EXTERNAL]), EXTERNAL)
})

test('among monitors of the same model the serial decides, whatever the connectors', () => {
  const sibling = { ...EXTERNAL, serial: 'XYZ789', connector: 'DP-6', index: 2 }
  /** @type {MonitorKey} */
  const key = { ...saved().monitor, connector: 'DP-8' }
  const moved = { ...EXTERNAL, connector: 'DP-7' }

  assertEqual(findOriginalMonitor(key, [sibling, moved]), moved)
})

test('among monitors with the same identity the stored connector decides', () => {
  const twin = { ...EXTERNAL, connector: 'DP-7', index: 2 }
  /** @type {MonitorKey} */
  const key = { ...saved().monitor, connector: 'DP-7' }

  assertEqual(findOriginalMonitor(key, [EXTERNAL, twin]), twin)
})

test('among monitors with the same identity and none with the connector, the monitor is gone', () => {
  const twin = { ...EXTERNAL, connector: 'DP-7', index: 2 }
  /** @type {MonitorKey} */
  const key = { ...saved().monitor, connector: 'DP-9' }

  assertEqual(findOriginalMonitor(key, [EXTERNAL, twin]), null)
})

test('a window whose original monitor is gone gets no plan', () => {
  assertEqual(planRestore(saved(), now(), [monitor()], 4), null)
})

// --- a plain window --------------------------------------------------------

test('a plain window goes back to its monitor and its frame there', () => {
  assertEqual(plan(saved(), now()), [
    { kind: 'moveToMonitor', monitor: 1 },
    {
      kind: 'moveResizeFrame',
      frame: { x: 2020, y: 50, width: 800, height: 600 },
    },
  ])
})

// --- the workspace (ADR-0004 part 4 and its amendments) ---------------------

/** The workspace steps only. */
const WORKSPACE_KINDS = ['stick', 'unstick', 'changeWorkspace']

/**
 * @param {WindowRecord['workspace']} record
 * @param {CurrentWindow['workspace']} current
 * @returns {RestoreStep[]} The workspace steps the plan makes.
 */
function workspaceSteps(record, current) {
  return plan(saved({ workspace: record }), now({ workspace: current })).filter(
    (step) => WORKSPACE_KINDS.includes(step.kind),
  )
}

/**
 * Snapshot workspace × workspace now → the workspace steps, with 4
 * workspaces. 'all': on all workspaces of its own accord; 'none': on all
 * of them only for being off the primary.
 *
 * @type {[WindowRecord['workspace'], CurrentWindow['workspace'], RestoreStep[]][]}
 */
const WORKSPACE_TABLE = [
  // The first and the last workspace count like any other.
  [0, 2, [{ kind: 'changeWorkspace', workspace: 0 }]],
  [3, 2, [{ kind: 'changeWorkspace', workspace: 3 }]],
  [1, 1, []],
  [1, 2, [{ kind: 'changeWorkspace', workspace: 1 }]],
  [1, 'all', [{ kind: 'unstick' }, { kind: 'changeWorkspace', workspace: 1 }]],
  [1, 'none', [{ kind: 'unstick' }, { kind: 'changeWorkspace', workspace: 1 }]],
  ['all', 'all', []],
  ['all', 2, [{ kind: 'stick' }]],
  ['all', 'none', [{ kind: 'stick' }]],
  ['none', 2, []],
  ['none', 'all', []],
  ['none', 'none', []],
  // A workspace that no longer exists is left alone.
  [4, 2, []],
  [5, 2, []],
  [5, 'all', []],
]

for (const [record, current, expected] of WORKSPACE_TABLE) {
  test(`snapshot workspace ${String(record)}, now ${String(current)}: the workspace steps`, () => {
    assertEqual(workspaceSteps(record, current), expected)
  })
}

test('the workspace is set after the monitor', () => {
  assertEqual(kinds(plan(saved({ workspace: 1 }), now({ workspace: 'all' }))), [
    'moveToMonitor',
    'unstick',
    'changeWorkspace',
    'moveResizeFrame',
  ])
})

// --- maximized, fullscreen and minimized -----------------------------------

test('a window maximized only now is unmaximized before its frame is set', () => {
  assertEqual(kinds(plan(saved(), now({ maximizeFlags: BOTH }))), [
    'moveToMonitor',
    'unmaximize',
    'moveResizeFrame',
  ])
})

test('a window maximized in the snapshot is maximized without a frame', () => {
  assertEqual(
    plan(saved({ maximizeFlags: BOTH }), now({ maximizeFlags: BOTH })),
    [
      { kind: 'moveToMonitor', monitor: 1 },
      { kind: 'maximize', flags: BOTH },
    ],
  )
})

test('a window maximized in one direction gets its frame, then that direction', () => {
  assertEqual(plan(saved({ maximizeFlags: VERTICAL }), now()), [
    { kind: 'moveToMonitor', monitor: 1 },
    {
      kind: 'moveResizeFrame',
      frame: { x: 2020, y: 50, width: 800, height: 600 },
    },
    { kind: 'maximize', flags: VERTICAL },
  ])
})

test('a window maximized in a direction the snapshot lacks is unmaximized first', () => {
  assertEqual(
    kinds(
      plan(saved({ maximizeFlags: VERTICAL }), now({ maximizeFlags: BOTH })),
    ),
    ['moveToMonitor', 'unmaximize', 'moveResizeFrame', 'maximize'],
  )
})

test('a window maximized as in the snapshot is not unmaximized', () => {
  assertEqual(
    kinds(
      plan(
        saved({ maximizeFlags: HORIZONTAL }),
        now({ maximizeFlags: HORIZONTAL }),
      ),
    ),
    ['moveToMonitor', 'moveResizeFrame', 'maximize'],
  )
})

test('a window fullscreen only now leaves fullscreen before anything else', () => {
  assertEqual(kinds(plan(saved(), now({ fullscreen: true }))), [
    'unmakeFullscreen',
    'moveToMonitor',
    'moveResizeFrame',
  ])
})

test('a window fullscreen in the snapshot goes fullscreen after its frame', () => {
  assertEqual(kinds(plan(saved({ fullscreen: true }), now())), [
    'moveToMonitor',
    'moveResizeFrame',
    'makeFullscreen',
  ])
})

test('a window fullscreen in the snapshot and now stays fullscreen', () => {
  assertEqual(
    kinds(plan(saved({ fullscreen: true }), now({ fullscreen: true }))),
    ['moveToMonitor', 'moveResizeFrame'],
  )
})

test('a window minimized in the snapshot is minimized last', () => {
  assertEqual(
    kinds(plan(saved({ minimized: true, fullscreen: true }), now())).slice(-2),
    ['makeFullscreen', 'minimize'],
  )
})

test('a window minimized only now is unminimized last', () => {
  assertEqual(
    kinds(plan(saved(), now({ minimized: true }))).at(-1),
    'unminimize',
  )
})
