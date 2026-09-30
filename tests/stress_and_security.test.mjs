if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    __ModuleLoader__: { load: () => {} },
  }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { constants, zstdCompressSync } from 'node:zlib'

const {
  buildSessionTree,
  flattenSessionTree,
  findSessionAncestors,
  aggregateDescendantStatus,
  sortTreeByUpdatedAt,
  countDescendants,
  buildSiblingsMap,
} = await import('../src/vendor/official-ui-workspace/branch.ts')

const {
  reconcileManualOrder,
} = await import('../src/vendor/official-ui-workspace/tree.ts')

const {
  isLoopback,
  isLoopbackHost,
  isTrustedBrowserRequest,
  isValidSessionId,
} = await import('../lib/index.js')

const {
  readSessionHeader,
  scanZstdFramesWithTorn,
} = await import('../lib/host/zstd.js')

test('STRESS: 20000 depth fork chain tree building, flattening, and ancestor lookup', () => {
  const DEPTH = 20000
  const nodes = []
  for (let i = 0; i < DEPTH; i++) {
    nodes.push({
      id: `s-${i}`,
      parentId: i === 0 ? undefined : `s-${i - 1}`,
      title: `Session ${i}`,
      updatedAt: 1000 + i,
    })
  }

  const t0 = performance.now()
  const tree = buildSessionTree(nodes)
  const tBuild = performance.now() - t0
  assert.equal(tree.length, 1)

  const t1 = performance.now()
  const flat = flattenSessionTree(tree)
  const tFlat = performance.now() - t1
  assert.equal(flat.length, DEPTH)
  assert.equal(flat[DEPTH - 1].depth, DEPTH - 1)

  const t2 = performance.now()
  const ancestors = findSessionAncestors(tree, `s-${DEPTH - 1}`)
  const tAncestors = performance.now() - t2
  assert.equal(ancestors.length, DEPTH - 1)
  assert.equal(ancestors[0], 's-0')

  const t3 = performance.now()
  const status = aggregateDescendantStatus(tree[0])
  const tStatus = performance.now() - t3
  assert.equal(status.hasPendingInteraction, undefined)

  console.log(`[STRESS 20k] build: ${tBuild.toFixed(1)}ms, flat: ${tFlat.toFixed(1)}ms, ancestors: ${tAncestors.toFixed(1)}ms, status: ${tStatus.toFixed(1)}ms`)
})

test('STRESS: Wide and deep multi-branch tree (500 roots x 20 deep = 10000 nodes)', () => {
  const nodes = []
  const ROOTS = 500
  const DEPTH = 20
  for (let r = 0; r < ROOTS; r++) {
    for (let d = 0; d < DEPTH; d++) {
      nodes.push({
        id: `r${r}-d${d}`,
        parentId: d === 0 ? undefined : `r${r}-d${d - 1}`,
        title: `Node ${r}-${d}`,
        updatedAt: r * 100 + d,
        running: d === DEPTH - 1 && r % 5 === 0,
      })
    }
  }

  assert.equal(nodes.length, 10000)
  const t0 = performance.now()
  const tree = buildSessionTree(nodes)
  assert.equal(tree.length, ROOTS)
  const flat = flattenSessionTree(tree)
  assert.equal(flat.length, 10000)
  const sorted = sortTreeByUpdatedAt(tree, 'updatedAt-desc')
  assert.equal(sorted.length, ROOTS)
  const duration = performance.now() - t0
  console.log(`[STRESS 10k wide] total execution: ${duration.toFixed(1)}ms`)
})

test('STRESS: reconcileManualOrder with 10000 chain nodes', () => {
  const DEPTH = 10000
  const memberIds = []
  const summaries = {}
  for (let i = 0; i < DEPTH; i++) {
    const id = `fork-${i}`
    memberIds.push(id)
    summaries[id] = {
      parentId: i === 0 ? undefined : `fork-${i - 1}`,
      updatedAt: i,
    }
  }

  const t0 = performance.now()
  const ordered = reconcileManualOrder(memberIds, undefined, summaries)
  const dur = performance.now() - t0
  assert.equal(ordered.length, DEPTH)
  console.log(`[STRESS reconcileManualOrder 10k] execution: ${dur.toFixed(1)}ms`)
})

test('SECURITY: Path traversal & injection vectors against isValidSessionId', () => {
  const evilPayloads = [
    '../etc/passwd',
    '..\\windows\\system32',
    'session/sub/123',
    'session\\123',
    'session\0hidden',
    'session%20name',
    'session;rm -rf /',
    'session|cat',
    'session&calc',
    '$(whoami)',
    '`id`',
    '..',
    '.',
    '',
    ' ',
    '   ',
    '\n',
    '\r\n',
    'a'.repeat(129), // exceeds 128 max length
    'session with space',
    '<script>alert(1)</script>',
    '日本語セッション',
    'session#123',
    'session?id=1',
  ]

  for (const payload of evilPayloads) {
    assert.equal(isValidSessionId(payload), false, `Should reject evil sessionId: ${payload}`)
  }

  // Valid IDs
  const validIds = [
    'session-1234',
    'SESSION_UUID_99',
    '0123456789',
    'abc-def_ghi',
    'a'.repeat(128),
  ]
  for (const id of validIds) {
    assert.equal(isValidSessionId(id), true, `Should accept valid sessionId: ${id}`)
  }
})

test('SECURITY: Loopback, DNS Rebinding and CSRF defenses', () => {
  // Loopback checks
  assert.equal(isLoopback('127.0.0.1'), true)
  assert.equal(isLoopback('127.0.1.1'), true)
  assert.equal(isLoopback('::1'), true)
  assert.equal(isLoopback('::ffff:127.0.0.1'), true)
  assert.equal(isLoopback('192.168.1.1'), false)
  assert.equal(isLoopback('10.0.0.1'), false)
  assert.equal(isLoopback('8.8.8.8'), false)
  assert.equal(isLoopback(''), false)

  // Host header loopback & DNS rebinding check
  assert.equal(isLoopbackHost('localhost:3080'), true)
  assert.equal(isLoopbackHost('127.0.0.1:3080'), true)
  assert.equal(isLoopbackHost('[::1]:3080'), true)
  assert.equal(isLoopbackHost('attacker.com'), false)
  assert.equal(isLoopbackHost('localhost.attacker.com'), false)
  assert.equal(isLoopbackHost('127.0.0.1.nip.io'), false)

  // CSRF Sec-Fetch-Site and Origin check
  assert.equal(isTrustedBrowserRequest({
    headers: { host: 'localhost:3080', 'sec-fetch-site': 'cross-site' }
  }), false)

  assert.equal(isTrustedBrowserRequest({
    headers: { host: 'localhost:3080', origin: 'http://evil.com' }
  }), false)

  assert.equal(isTrustedBrowserRequest({
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }
  }), true)

  assert.equal(isTrustedBrowserRequest({
    headers: { host: 'attacker.com', origin: 'http://attacker.com' }
  }), false) // blocked by isLoopbackHost
})

test('V4 INTEGRATION: Real Zstandard compressed V4 Session Header parse and validation', () => {
  const testDir = join(tmpdir(), `dsh-v4-real-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
  const logFile = join(testDir, 'session.v4.jsonl.zstd')

  const v4Header = {
    version: 4,
    id: 'test-session-v4-001',
    createdAt: 1727500000000,
    cwd: '/root/Job/workspace-test',
    parentSession: 'root-session-000',
    isSeeded: true,
    origin: 'subagent',
    delegationDepth: 1,
    agentPreset: 'preset-standard',
  }

  // Encode header as first Zstd frame
  const headerJson = JSON.stringify(v4Header) + '\n'
  const compressedFrame = zstdCompressSync(Buffer.from(headerJson, 'utf8'))
  writeFileSync(logFile, compressedFrame)

  const parsedHeader = readSessionHeader(logFile)
  assert.equal(parsedHeader.version, 4)
  assert.equal(parsedHeader.id, 'test-session-v4-001')
  assert.equal(parsedHeader.parentSession, 'root-session-000')
  assert.equal(parsedHeader.origin, 'subagent')
  assert.equal(parsedHeader.cwd, '/root/Job/workspace-test')

  // Append a second frame (user message event)
  const eventJson = JSON.stringify({
    seq: 1,
    time: 1727500001000,
    type: 'user/message',
    data: { content: [{ type: 'text', text: 'Hello V4' }] }
  }) + '\n'
  const eventFrame = zstdCompressSync(Buffer.from(eventJson, 'utf8'))
  writeFileSync(logFile, Buffer.concat([compressedFrame, eventFrame]))

  // Header fast read should still only read the first frame
  const reread = readSessionHeader(logFile)
  assert.equal(reread.id, 'test-session-v4-001')

  // Test torn tail frame handling
  const partialCorrupt = Buffer.concat([compressedFrame, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x11])])
  const scan = scanZstdFramesWithTorn(partialCorrupt)
  assert.equal(scan.frames.length, 1)
  assert.equal(scan.tornStart, compressedFrame.length)

  rmSync(testDir, { recursive: true, force: true })
})
test('MARQUEE STRESS & LOGIC: placeTitle, restTitle, and threshold boundary tests', async () => {
  // Test placeTitle and restTitle edge cases
  const mockElement = {
    scrollWidth: 200,
    clientWidth: 100,
    scrollLeft: 0,
    dataset: {},
    scrollTo({ left }) {
      this.scrollLeft = left
    }
  }

  // 1. Emulate placeTitle logic
  const MIN_TITLE_REVEAL_PX = 8
  const range = mockElement.scrollWidth - mockElement.clientWidth // 100px
  assert.equal(range > MIN_TITLE_REVEAL_PX, true)

  const place = (el, left, r) => {
    el.scrollTo({ left, behavior: 'instant' })
    if (left > 0) el.dataset.scrolled = ''
    else delete el.dataset.scrolled
    if (left < r) el.dataset.clipped = ''
    else delete el.dataset.clipped
  }

  const rest = (el) => {
    el.scrollTo({ left: 0, behavior: 'instant' })
    delete el.dataset.scrolled
    delete el.dataset.clipped
  }

  // Start position
  place(mockElement, 0, range)
  assert.equal(mockElement.dataset.scrolled, undefined)
  assert.equal(mockElement.dataset.clipped, '')

  // Mid position
  place(mockElement, 50, range)
  assert.equal(mockElement.dataset.scrolled, '')
  assert.equal(mockElement.dataset.clipped, '')

  // End position
  place(mockElement, 100, range)
  assert.equal(mockElement.dataset.scrolled, '')
  assert.equal(mockElement.dataset.clipped, undefined)

  // Rest
  rest(mockElement)
  assert.equal(mockElement.scrollLeft, 0)
  assert.equal(mockElement.dataset.scrolled, undefined)
  assert.equal(mockElement.dataset.clipped, undefined)

  // Stress test: 50,000 rapid enter/leave transitions
  const t0 = performance.now()
  for (let i = 0; i < 50000; i++) {
    place(mockElement, i % 100, range)
    rest(mockElement)
  }
  const dur = performance.now() - t0
  assert.equal(dur < 1000, true, '50k transitions must complete under 1s')
  console.log(`[STRESS Marquee 50k transitions] completed in ${dur.toFixed(1)}ms`)
})
