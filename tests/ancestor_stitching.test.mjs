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
  collectBranchIds,
  resolveSurvivingParent,
} = await import('../src/vendor/official-ui-workspace/branch.ts')

const {
  reconcileManualOrder,
} = await import('../src/vendor/official-ui-workspace/tree.ts')

test('resolveSurvivingParent correctly traverses invisible parent chain and handles dirty types', () => {
  const allSessions = {
    'root': { id: 'root' },
    'b1': { id: 'b1', parentId: 'root' },
    'b2': { id: 'b2', parentId: 'b1' },
    'c': { id: 'c', parentId: 'b2' },
    'empty_parent': { id: 'empty_parent', parentId: '' },
    'null_parent': { id: 'null_parent', parentId: null },
  }
  const lookupParent = (id) => allSessions[id]?.parentId
  const visibleMap = new Map([
    ['root', { id: 'root', title: 'Root' }],
    ['c', { id: 'c', title: 'C' }],
  ])

  // Direct parent 'b2' is invisible, but ancestor 'root' is visible
  const parent = resolveSurvivingParent('b2', visibleMap, lookupParent)
  assert.ok(parent)
  assert.equal(parent.id, 'root')

  // When no ancestor is visible
  const lonelyMap = new Map([['c', { id: 'c', title: 'C' }]])
  const lonelyParent = resolveSurvivingParent('b2', lonelyMap, lookupParent)
  assert.equal(lonelyParent, undefined)

  // Cycle safe in ancestor lookup
  const cycleLookup = (id) => (id === 'cycle1' ? 'cycle2' : id === 'cycle2' ? 'cycle1' : undefined)
  const cycleParent = resolveSurvivingParent('cycle1', visibleMap, cycleLookup)
  assert.equal(cycleParent, undefined)

  // Empty string, null, and non-string parent defenses
  assert.equal(resolveSurvivingParent('', visibleMap, lookupParent), undefined)
  assert.equal(resolveSurvivingParent(null, visibleMap, lookupParent), undefined)
  assert.equal(resolveSurvivingParent(undefined, visibleMap, lookupParent), undefined)
  assert.equal(resolveSurvivingParent('empty_parent', visibleMap, lookupParent), undefined)
  assert.equal(resolveSurvivingParent('null_parent', visibleMap, lookupParent), undefined)
})

test('buildSessionTree stitches surviving children under root when Layer 2 parent is archived', () => {
  // A -> B -> C -> D (4 layers)
  // B is archived (invisible), so only A, C, D are passed to buildSessionTree
  const allSessions = {
    'sess-a': { id: 'sess-a', title: 'Session A' },
    'sess-b': { id: 'sess-b', parentId: 'sess-a', title: 'Session B (Archived)' },
    'sess-c': { id: 'sess-c', parentId: 'sess-b', title: 'Session C' },
    'sess-d': { id: 'sess-d', parentId: 'sess-c', title: 'Session D' },
  }
  const lookupParent = (id) => allSessions[id]?.parentId

  const visibleSessions = [
    { id: 'sess-a', title: 'Session A' },
    { id: 'sess-c', parentId: 'sess-b', title: 'Session C' },
    { id: 'sess-d', parentId: 'sess-c', title: 'Session D' },
  ]

  const tree = buildSessionTree(visibleSessions, { lookupParent })

  // Assert: C and D do NOT escape into top-level roots; only A is root!
  assert.equal(tree.length, 1, 'Only root A should be at the top level')
  assert.equal(tree[0].id, 'sess-a')
  assert.equal(tree[0].children?.length, 1, 'A should have 1 child (stitched C)')
  assert.equal(tree[0].children?.[0].id, 'sess-c')
  assert.equal(tree[0].children?.[0].bypassedParents, true)
  assert.equal(tree[0].children?.[0].children?.length, 1, 'C should have 1 child (D)')
  assert.equal(tree[0].children?.[0].children?.[0].id, 'sess-d')

  // Flattened tree verify
  const rows = flattenSessionTree(tree)
  assert.equal(rows.length, 3)
  assert.equal(rows[0].node.id, 'sess-a')
  assert.equal(rows[0].depth, 0)
  assert.equal(rows[1].node.id, 'sess-c')
  assert.equal(rows[1].depth, 1)
  assert.equal(rows[2].node.id, 'sess-d')
  assert.equal(rows[2].depth, 2)

  // findSessionAncestors verify
  const ancestorsOfD = findSessionAncestors(tree, 'sess-d')
  assert.deepEqual(ancestorsOfD, ['sess-a', 'sess-c'])
  const ancestorsOfC = findSessionAncestors(tree, 'sess-c')
  assert.deepEqual(ancestorsOfC, ['sess-a'])

  // collectBranchIds verify
  const branchIds = collectBranchIds(visibleSessions, { lookupParent })
  assert.ok(branchIds.includes('sess-a'))
  assert.ok(branchIds.includes('sess-c'))
  assert.ok(!branchIds.includes('sess-d'))
})

test('buildSessionTree handles multi-layer consecutive archived ancestors (A -> B1 -> B2 -> C)', () => {
  const allSessions = {
    'sess-a': { id: 'sess-a', title: 'Session A' },
    'sess-b1': { id: 'sess-b1', parentId: 'sess-a', title: 'B1' },
    'sess-b2': { id: 'sess-b2', parentId: 'sess-b1', title: 'B2' },
    'sess-c': { id: 'sess-c', parentId: 'sess-b2', title: 'C' },
  }
  const lookupParent = (id) => allSessions[id]?.parentId

  const visibleSessions = [
    { id: 'sess-a', title: 'Session A' },
    { id: 'sess-c', parentId: 'sess-b2', title: 'C' },
  ]

  const tree = buildSessionTree(visibleSessions, { lookupParent })
  assert.equal(tree.length, 1)
  assert.equal(tree[0].id, 'sess-a')
  assert.equal(tree[0].children?.length, 1)
  assert.equal(tree[0].children?.[0].id, 'sess-c')
  assert.equal(tree[0].children?.[0].bypassedParents, true)
})

test('buildSessionTree safely promotes child to root orphan when root itself is also archived', () => {
  const allSessions = {
    'sess-a': { id: 'sess-a', title: 'Session A (Archived)' },
    'sess-b': { id: 'sess-b', parentId: 'sess-a', title: 'Session B (Archived)' },
    'sess-c': { id: 'sess-c', parentId: 'sess-b', title: 'Session C' },
  }
  const lookupParent = (id) => allSessions[id]?.parentId

  const visibleSessions = [
    { id: 'sess-c', parentId: 'sess-b', title: 'Session C' },
  ]

  const tree = buildSessionTree(visibleSessions, { lookupParent })
  assert.equal(tree.length, 1)
  assert.equal(tree[0].id, 'sess-c')
  assert.equal(tree[0].orphan, true)
})

test('reconcileManualOrder stitches placeFork clustering under real production data (including archived members)', () => {
  // Production scenario: memberIds contains ALL sessions including archived sess-b
  const memberIds = ['sess-a', 'sess-other', 'sess-b', 'sess-c']
  const summaries = {
    'sess-a': { id: 'sess-a', updatedAt: 100 },
    'sess-other': { id: 'sess-other', updatedAt: 150 },
    'sess-b': { id: 'sess-b', parentId: 'sess-a', updatedAt: 120 },
    'sess-c': { id: 'sess-c', parentId: 'sess-b', updatedAt: 130 },
  }
  const rowState = {
    pinnedSessionIds: [],
    archivedSessionIds: ['sess-b'],
    archivedFilter: 'default',
  }

  // sess-c's direct parent sess-b is archived. sess-c must stitch to surviving ancestor sess-a,
  // clustering immediately ahead of sess-a, NOT trailing behind sess-other into the archives zone!
  const result = reconcileManualOrder(memberIds, ['sess-a', 'sess-other'], summaries, rowState)
  assert.deepEqual(result, ['sess-c', 'sess-a', 'sess-other', 'sess-b'])
})

test('STRESS: buildSessionTree with ancestor stitching handles 20000 depth with intermediate archives', () => {
  const DEPTH = 20000
  const allSessions = {}
  const visible = []

  for (let i = 0; i < DEPTH; i++) {
    const id = `node-${i}`
    const parentId = i === 0 ? undefined : `node-${i - 1}`
    allSessions[id] = { id, parentId }
    // Archive every 5th node
    if (i % 5 !== 0) {
      visible.push({ id, parentId })
    } else if (i === 0) {
      // Keep root visible
      visible.push({ id, parentId })
    }
  }

  const lookupParent = (id) => allSessions[id]?.parentId

  const t0 = performance.now()
  const tree = buildSessionTree(visible, { lookupParent })
  const t1 = performance.now()

  assert.equal(tree.length, 1, 'Single root must remain')
  assert.equal(tree[0].id, 'node-0')
  assert.ok(t1 - t0 < 500, `Execution took ${t1 - t0}ms, must be < 500ms`)
})
