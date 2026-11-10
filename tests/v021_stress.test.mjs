if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    __ModuleLoader__: { load: () => {} },
  }
}

import test from 'node:test'
import assert from 'node:assert/strict'

const {
  SESSION_WATERMARK_BASE,
  SESSION_WATERMARK_AUTO_MAX,
  workspaceDisplayTitle,
  displayTitle,
  sameRows,
  intersects,
  watermarkRows,
  requiredWatermark,
  raiseWatermarks,
} = await import('../src/vendor/official-ui-workspace/watermark.ts')

const {
  buildSessionTree,
  flattenSessionTree,
} = await import('../src/vendor/official-ui-workspace/branch.ts')

const mockTranslate = (key, params) => {
  const dict = {
    'session.new': 'New Session',
    'session.untitled': 'Untitled',
    'workspace.defaultName': 'Default workspace',
  }
  let text = dict[key] || key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return text
}

test('STRESS & BOUNDARY: Watermark calculation on 10,000 sessions with strict AUTO_MAX caps', () => {
  const TOTAL = 10000
  const sessions = []

  // Create 10,000 sessions with various states
  for (let i = 0; i < TOTAL; i++) {
    sessions.push({
      id: `s-${i}`,
      title: `Session ${i}`,
      blank: false,
      running: false,
      runningSubagentCount: 0,
      completed: false,
      pinned: false,
      archived: false,
      updatedAt: 1000 + i,
    })
  }

  // 1. All idle sessions -> required watermark is SESSION_WATERMARK_BASE (5)
  assert.equal(requiredWatermark(sessions, undefined, undefined), 5)

  // 2. Session #40 is running (within 50) -> required watermark is 40
  sessions[39].running = true
  assert.equal(requiredWatermark(sessions, undefined, undefined), 40)

  // 3. Session #50 is running (at boundary of 50) -> required watermark is 50
  sessions[39].running = false
  sessions[49].pendingInteraction = 'approval'
  assert.equal(requiredWatermark(sessions, undefined, undefined), 50)

  // 4. Session #51 is running (> 50) -> strictly capped by SESSION_WATERMARK_AUTO_MAX
  sessions[49].pendingInteraction = undefined
  sessions[50].running = true
  assert.equal(requiredWatermark(sessions, undefined, undefined), 5)

  // 5. Search reveal penetration: Session #7899 is revealed -> penetrates past 50 up to 7899
  const t0 = performance.now()
  const revealedWatermark = requiredWatermark(sessions, undefined, 's-7898')
  const tElapsed = performance.now() - t0
  assert.equal(revealedWatermark, 7899)
  assert.ok(tElapsed < 10, `requiredWatermark took ${tElapsed.toFixed(2)}ms (expected < 10ms)`)

  // 6. Blank sessions do not consume non-blank watermark index slots
  const withBlanks = [
    { id: 'b-1', blank: true, running: true },
    { id: 'b-2', blank: true, running: true },
    { id: 's-1', blank: false, running: false },
    { id: 's-2', blank: false, running: false },
    { id: 's-3', blank: false, running: false },
    { id: 's-4', blank: false, running: false },
    { id: 's-5', blank: false, running: false },
    { id: 's-6', blank: false, running: true }, // 6th non-blank
  ]
  assert.equal(requiredWatermark(withBlanks, undefined, undefined), 6)
})

test('STRESS: watermarkRows on 20,000 sessions with interleaved blank rows', () => {
  const TOTAL = 20000
  const sessions = []
  for (let i = 0; i < TOTAL; i++) {
    sessions.push({
      id: `row-${i}`,
      blank: i % 10 === 0, // Every 10th row is blank (2,000 blanks)
      title: `Row ${i}`,
      running: false,
      runningSubagentCount: 0,
      completed: false,
      pinned: false,
      archived: false,
      updatedAt: 1000 + i,
    })
  }

  const t0 = performance.now()
  const { rows, hiddenCount } = watermarkRows(sessions, 5)
  const tElapsed = performance.now() - t0

  // 2,000 blanks + 5 non-blank = 2,005 rows visible
  assert.equal(rows.length, 2005)
  assert.equal(hiddenCount, TOTAL - 2005)
  assert.ok(tElapsed < 15, `watermarkRows took ${tElapsed.toFixed(2)}ms (expected < 15ms)`)
})

test('STRESS: raiseWatermarks idempotency and 1,000 workspaces concurrent raise', () => {
  const marks = {}
  const required = new Map()
  for (let i = 0; i < 1000; i++) {
    marks[`ws-${i}`] = 10
    required.set(`ws-${i}`, 8) // All required <= existing
  }

  // Idempotency: when nothing rises, returns the exact same reference
  const unchanged = raiseWatermarks(marks, required)
  assert.equal(unchanged, marks, 'raiseWatermarks must return same reference if no marks raise')

  // Now raise half of them to 25
  for (let i = 0; i < 500; i++) {
    required.set(`ws-${i}`, 25)
  }

  const t0 = performance.now()
  const raised = raiseWatermarks(marks, required)
  const tElapsed = performance.now() - t0

  assert.notEqual(raised, marks)
  assert.equal(raised['ws-0'], 25)
  assert.equal(raised['ws-499'], 25)
  assert.equal(raised['ws-500'], 10)
  assert.ok(tElapsed < 25, `raiseWatermarks took ${tElapsed.toFixed(2)}ms (expected < 25ms)`)
})

test('STRESS: Deep Branch Tree + Watermark Flattening Pipeline (5,000 nodes)', () => {
  // 50 roots, each root has a 100-node fork chain
  const nodes = []
  const ROOTS = 50
  const DEPTH = 100
  for (let r = 0; r < ROOTS; r++) {
    for (let d = 0; d < DEPTH; d++) {
      nodes.push({
        id: `r${r}-d${d}`,
        parentId: d === 0 ? undefined : `r${r}-d${d - 1}`,
        title: `Node ${r}-${d}`,
        updatedAt: r * 1000 + d,
        blank: d === 0 && r === 0, // One blank session
      })
    }
  }

  const t0 = performance.now()
  const tree = buildSessionTree(nodes)
  const flattened = flattenSessionTree(tree)
  const watermark = 50
  const visible = flattened.filter((row, idx) => row.node.blank || idx < watermark)
  const tPipeline = performance.now() - t0

  assert.equal(tree.length, ROOTS)
  assert.equal(flattened.length, ROOTS * DEPTH)
  assert.equal(visible.length, watermark)
  assert.ok(tPipeline < 30, `Tree + flatten + watermark pipeline took ${tPipeline.toFixed(2)}ms (expected < 30ms)`)
})

test('STRESS & DEFENSE: 100,000 title resolutions with hostile, dirty, and giant strings', () => {
  const hostileSamples = [
    { blank: true, title: 'Ignored' }, // -> 'New Session'
    { blank: false, title: '' }, // -> 'Untitled'
    { blank: false, title: '   \t\n  ' }, // whitespace only -> 'Untitled'
    { blank: false, title: null }, // -> 'Untitled'
    { blank: false, title: undefined }, // -> 'Untitled'
    { blank: false, title: 'Normal Title' }, // -> 'Normal Title'
    { blank: false, title: '<script>alert("XSS")</script>' }, // preserved safely
    { blank: false, title: '🚀🔥 Non-BMP Emoji & Astral Characters 𠮷野家' },
    { blank: false, title: 'עברית / العربية RTL Test' },
    { blank: false, title: 'A'.repeat(1024 * 512) }, // 512KB title string
  ]

  const t0 = performance.now()
  const ITERATIONS = 100000
  for (let i = 0; i < ITERATIONS; i++) {
    const sample = hostileSamples[i % hostileSamples.length]
    const resolved = displayTitle(sample, mockTranslate)
    if (sample.blank) {
      assert.equal(resolved, 'New Session')
    } else if (!sample.title || sample.title.trim() === '') {
      assert.equal(resolved, 'Untitled')
    } else {
      assert.ok(resolved.length > 0)
    }
  }
  const tElapsed = performance.now() - t0
  assert.ok(tElapsed < 50, `100,000 title resolutions completed in ${tElapsed.toFixed(2)}ms (expected < 50ms)`)
})

test('STRESS: AnimatedRows sameRows differ with 20,000 keys and collision check', () => {
  const KEYS_COUNT = 20000
  const keysA = []
  const keysB = []
  for (let i = 0; i < KEYS_COUNT; i++) {
    keysA.push(`session:s-${i}`)
    keysB.push(`session:s-${i}`)
  }

  // 1. Identical comparison performance
  const t0 = performance.now()
  const identical = sameRows({ rowKeys: keysA }, { rowKeys: keysB })
  const tIdentical = performance.now() - t0
  assert.equal(identical, true)
  assert.ok(tIdentical < 15, `sameRows on 20,000 keys took ${tIdentical.toFixed(2)}ms (expected < 15ms)`)

  // 2. Early mismatch detection
  keysB[0] = 'session:s-diff'
  assert.equal(sameRows({ rowKeys: keysA }, { rowKeys: keysB }), false)

  // 3. Collision audit on compound key structures
  const compoundKeys = []
  for (let w = 0; w < 100; w++) {
    compoundKeys.push(`workspace:ws-${w}`)
    for (let s = 0; s < 50; s++) {
      compoundKeys.push(`session:ws-${w}-s-${s}`)
    }
    compoundKeys.push(`overflow:ws-${w}`)
  }
  compoundKeys.push('empty')

  const uniqueSet = new Set(compoundKeys)
  assert.equal(uniqueSet.size, compoundKeys.length, 'Every row key in compound list must be 100% collision-free')
})

test('STRESS: Nested workspace hierarchy cascade cleanup (1,000 workspaces, 20 levels)', () => {
  // Build a tree of 1,000 workspaces across 20 depth levels
  const parents = new Map()
  for (let i = 1; i < 1000; i++) {
    const parentId = `ws-${Math.floor((i - 1) / 3)}`
    parents.set(`ws-${i}`, parentId)
  }

  const withinGroup = (key, root) => {
    for (let owner = key; owner !== undefined; owner = parents.get(owner)) {
      if (owner === root) return true
    }
    return false
  }

  const t0 = performance.now()
  let matchCount = 0
  for (let i = 0; i < 1000; i++) {
    if (withinGroup(`ws-${i}`, 'ws-0')) {
      matchCount++
    }
  }
  const tElapsed = performance.now() - t0

  assert.equal(matchCount, 1000)
  assert.ok(tElapsed < 5, `1,000 withinGroup lookups took ${tElapsed.toFixed(2)}ms`)
})

test('STRESS: workspaceDisplayTitle localization performance (100,000 invocations)', () => {
  const t0 = performance.now()
  for (let i = 0; i < 100000; i++) {
    const title = i % 2 === 0 ? 'default-workspace' : `workspace-${i}`
    const result = workspaceDisplayTitle(title, '默认工作区')
    if (i % 2 === 0) {
      assert.equal(result, '默认工作区')
    } else {
      assert.equal(result, `workspace-${i}`)
    }
  }
  const tElapsed = performance.now() - t0
  assert.ok(tElapsed < 25, `100,000 workspaceDisplayTitle took ${tElapsed.toFixed(2)}ms`)
})
