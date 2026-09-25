if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    __ModuleLoader__: { load: () => {} },
  }
}

import test from 'node:test'
import assert from 'node:assert/strict'

const {
  buildSessionTree,
  flattenSessionTree,
  findSessionAncestors,
  buildSiblingsMap,
  sortTreeByUpdatedAt,
  aggregateDescendantStatus,
} = await import('../src/vendor/official-ui-workspace/branch.ts')

const {
  reconcileManualOrder,
} = await import('../src/vendor/official-ui-workspace/tree.ts')

test('buildSessionTree safely promotes child when parent is archived/missing', () => {
  const sessions = [
    { id: 'child-1', parentId: 'archived-parent', title: 'Child 1' },
    { id: 'child-2', parentId: 'child-1', title: 'Child 2' },
  ]
  const tree = buildSessionTree(sessions)
  assert.equal(tree.length, 1)
  assert.equal(tree[0].id, 'child-1')
  assert.equal(tree[0].orphan, true)
  assert.equal(tree[0].children?.length, 1)
  assert.equal(tree[0].children?.[0].id, 'child-2')
})

test('flattenSessionTree respects branch collapse per account', () => {
  const sessions = [
    { id: 'root', title: 'Root' },
    { id: 'child-1', parentId: 'root', title: 'Child 1' },
    { id: 'grandchild-1', parentId: 'child-1', title: 'Grandchild 1' },
  ]
  const tree = buildSessionTree(sessions)
  // When 'root' is collapsed
  const collapsedRoot = new Set(['root'])
  const rowsCollapsed = flattenSessionTree(tree, 0, [], new Set(), collapsedRoot)
  assert.equal(rowsCollapsed.length, 1)
  assert.equal(rowsCollapsed[0].node.id, 'root')

  // When 'root' is open, but 'child-1' is collapsed
  const collapsedChild = new Set(['child-1'])
  const rowsChildCollapsed = flattenSessionTree(tree, 0, [], new Set(), collapsedChild)
  assert.equal(rowsChildCollapsed.length, 2)
  assert.equal(rowsChildCollapsed[0].node.id, 'root')
  assert.equal(rowsChildCollapsed[1].node.id, 'child-1')
  assert.equal(rowsChildCollapsed[1].depth, 1)
})

test('findSessionAncestors resolves path to deep child', () => {
  const sessions = [
    { id: 'root', title: 'Root' },
    { id: 'child-1', parentId: 'root', title: 'Child 1' },
    { id: 'grandchild-1', parentId: 'child-1', title: 'Grandchild 1' },
  ]
  const tree = buildSessionTree(sessions)
  const ancestors = findSessionAncestors(tree, 'grandchild-1')
  assert.deepEqual(ancestors, ['root', 'child-1'])
})

test('reconcileManualOrder places pinned ahead and archived at bottom', () => {
  const memberIds = ['normal-1', 'pinned-1', 'archived-1', 'normal-2']
  const summaries = {
    'normal-1': { id: 'normal-1', updatedAt: 100 },
    'pinned-1': { id: 'pinned-1', updatedAt: 50 },
    'archived-1': { id: 'archived-1', updatedAt: 200 },
    'normal-2': { id: 'normal-2', updatedAt: 80 },
  }
  const rowState = {
    pinnedSessionIds: ['pinned-1'],
    archivedSessionIds: ['archived-1'],
    archivedFilter: 'show',
  }
  const order = reconcileManualOrder(memberIds, undefined, summaries, rowState)
  // Pinned leading
  assert.equal(order[0], 'pinned-1')
  // Archived trailing
  assert.equal(order[order.length - 1], 'archived-1')
})

test('flattenSessionTree and findSessionAncestors handle extreme recursion depth without stack overflow', () => {
  const depth = 5000
  const sessions = []
  for (let i = 0; i < depth; i++) {
    sessions.push({
      id: 'chain-' + i,
      parentId: i === 0 ? undefined : 'chain-' + (i - 1),
      title: 'Chain ' + i,
    })
  }
  const tree = buildSessionTree(sessions)
  assert.equal(tree.length, 1)

  // Test non-recursive flattening
  const flat = flattenSessionTree(tree)
  assert.equal(flat.length, depth)
  assert.equal(flat[depth - 1].node.id, 'chain-' + (depth - 1))
  assert.equal(flat[depth - 1].depth, depth - 1)

  // Test non-recursive ancestor lookup
  const ancestors = findSessionAncestors(tree, 'chain-' + (depth - 1))
  assert.ok(ancestors)
  assert.equal(ancestors.length, depth - 1)
  assert.equal(ancestors[0], 'chain-0')
  assert.equal(ancestors[ancestors.length - 1], 'chain-' + (depth - 2))
})

test('reconcileManualOrder clusters forks ahead of parent root via placeFork', () => {
  const summaries = {
    'root': { id: 'root', updatedAt: 100 },
    'fork1': { id: 'fork1', parentId: 'root', updatedAt: 200 },
    'fork2': { id: 'fork2', parentId: 'root', updatedAt: 300 },
    'other': { id: 'other', updatedAt: 50 },
  }
  const members = ['root', 'fork1', 'fork2', 'other']
  const order = reconcileManualOrder(members, undefined, summaries)
  const rootIdx = order.indexOf('root')
  const fork1Idx = order.indexOf('fork1')
  const fork2Idx = order.indexOf('fork2')
  assert.ok(fork1Idx < rootIdx)
  assert.ok(fork2Idx < rootIdx)
})

test('reconcileManualOrder handles 15000 fork chain depth without stack overflow', () => {
  const depth = 15000
  const summaries = {}
  const members = []
  for (let i = 0; i < depth; i++) {
    const id = 'chain-' + i
    members.push(id)
    summaries[id] = { id, parentId: i === 0 ? undefined : 'chain-' + (i - 1), updatedAt: 100000 - i }
  }
  const order = reconcileManualOrder(members, undefined, summaries)
  assert.equal(order.length, depth)
  assert.equal(order[0], 'chain-' + (depth - 1))
})

test('buildSiblingsMap handles 15000 depth without stack overflow', () => {
  const depth = 15000
  const sessions = []
  for (let i = 0; i < depth; i++) {
    sessions.push({
      id: 'sib-' + i,
      parentId: i === 0 ? undefined : 'sib-' + (i - 1),
      title: 'Sib ' + i,
    })
  }
  const tree = buildSessionTree(sessions)
  const map = buildSiblingsMap(tree)
  assert.equal(map.size, depth)
})

test('sortTreeByUpdatedAt correctly sorts sessions by updatedAt (desc/asc/none)', () => {
  const nodes = [
    { id: 'old', updatedAt: 100 },
    { id: 'new', updatedAt: 500 },
    { id: 'mid', updatedAt: 300 },
  ]
  const desc = sortTreeByUpdatedAt(nodes, 'updatedAt-desc')
  assert.deepEqual(desc.map((n) => n.id), ['new', 'mid', 'old'])

  const asc = sortTreeByUpdatedAt(nodes, 'updatedAt-asc')
  assert.deepEqual(asc.map((n) => n.id), ['old', 'mid', 'new'])

  const none = sortTreeByUpdatedAt(nodes, 'none')
  assert.deepEqual(none.map((n) => n.id), ['old', 'new', 'mid'])
})

test('sortTreeByUpdatedAt handles 15000 depth without stack overflow', () => {
  const depth = 15000
  const root = { id: 'root', updatedAt: 0, children: [] }
  let curr = root
  for (let i = 1; i < depth; i++) {
    const next = { id: 'n-' + i, updatedAt: i, children: [] }
    curr.children = [next]
    curr = next
  }
  const sorted = sortTreeByUpdatedAt([root], 'updatedAt-desc')
  assert.equal(sorted.length, 1)
})

test('client bundle contains typography hierarchy, deep rail mesh, and archived contrast rules', async () => {
  const { readFileSync } = await import('node:fs')
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /branchParent/)
  assert.match(client, /deepBranch/)
  assert.match(client, /--dsh-branch-depth/)
  assert.match(client, /archived[a-zA-Z0-9_.]*branchChild/)
})

test('aggregateDescendantStatus handles 5000 depth without stack overflow', () => {
  const depth = 5000
  const root = { id: 'root', children: [] }
  let curr = root
  for (let i = 1; i < depth; i++) {
    const next = { id: 'node-' + i, children: [] }
    curr.children = [next]
    curr = next
  }
  curr.running = true

  const status = aggregateDescendantStatus(root)
  assert.equal(status.hasRunning, true)
})

test('aggregateDescendantStatus safely terminates on cycles (A -> B -> A)', () => {
  const nodeA = { id: 'node-A', children: [] }
  const nodeB = { id: 'node-B', children: [], running: true }
  nodeA.children = [nodeB]
  nodeB.children = [nodeA]

  const status = aggregateDescendantStatus(nodeA)
  assert.equal(status.hasRunning, true)
})

test('aggregateDescendantStatus priority: pendingInteraction (warning) takes precedence over running (ongoing)', () => {
  const root = {
    id: 'root',
    children: [
      { id: 'child-1', running: true },
      { id: 'child-2', pendingInteraction: 'approval' },
    ],
  }
  const status = aggregateDescendantStatus(root)
  assert.equal(status.hasPendingInteraction, 'approval')
  assert.equal(status.hasRunning, true)
})

test('aggregateDescendantStatus bubbles running and subagents correctly when no pendingInteraction', () => {
  const root = {
    id: 'root',
    children: [
      { id: 'child-1', running: true, runningSubagentCount: 2 },
      { id: 'child-2', runningSubagentCount: 1 },
    ],
  }
  const status = aggregateDescendantStatus(root)
  assert.equal(status.hasPendingInteraction, undefined)
  assert.equal(status.hasRunning, true)
  assert.equal(status.runningSubagentCount, 3)
})

test('aggregateDescendantStatus bubbles completed when idle', () => {
  const root = {
    id: 'root',
    children: [
      { id: 'child-1', completed: true },
    ],
  }
  const status = aggregateDescendantStatus(root)
  assert.equal(status.hasCompleted, true)
  assert.equal(status.hasRunning, undefined)
})
