import test from 'node:test'
import assert from 'node:assert/strict'
import { collectFamilyIds, isForkChildLike } from '../src/host/lineage.ts'

test('collectFamilyIds includes a missing archived child when its parent chain is known', () => {
  const lineage = [
    { sessionId: 'root', parentId: undefined },
    // The child's directory may already be gone; purge must still remove it
    // from archivedSessionIds via the durable metadata parent chain.
    { sessionId: 'missing-child', parentId: 'root' },
  ]
  const family = collectFamilyIds(lineage, 'root')
  assert.deepEqual([...family].sort(), ['missing-child', 'root'])
})

test('collectFamilyIds walks up to the root and down every descendant', () => {
  const lineage = [
    { sessionId: 'grand', parentId: undefined },
    { sessionId: 'root', parentId: 'grand' },
    { sessionId: 'child-a', parentId: 'root' },
    { sessionId: 'child-b', parentId: 'root' },
    { sessionId: 'grandchild', parentId: 'child-a' },
  ]
  const family = collectFamilyIds(lineage, 'child-b')
  assert.deepEqual(
    [...family].sort(),
    ['child-a', 'child-b', 'grand', 'grandchild', 'root'],
  )
})

test('collectFamilyIds is cycle-safe', () => {
  const lineage = [
    { sessionId: 'a', parentId: 'b' },
    { sessionId: 'b', parentId: 'a' },
  ]
  const family = collectFamilyIds(lineage, 'a')
  assert.ok(family.has('a'))
  assert.ok(family.has('b'))
})

test('isForkChildLike ignores self-parenting entries', () => {
  assert.equal(isForkChildLike({ sessionId: 'a', parentId: 'a' }), false)
  assert.equal(isForkChildLike({ sessionId: 'a', parentId: 'b' }), true)
})
