import test from 'node:test'
import assert from 'node:assert/strict'
import { buildClusters } from '../lib/index.js'

function session(id, parentId, title = id) {
  return {
    sessionId: id,
    parentId,
    title,
    turns: [],
    maxTurn: 0,
    running: false,
    blank: true,
  }
}

test('buildClusters groups descendants under the root session', () => {
  const clusters = buildClusters([
    session('root', undefined, 'root'),
    session('child', 'root', 'child'),
    session('grand', 'child', 'grand'),
    session('other-root', undefined, 'other'),
  ])
  assert.equal(clusters.length, 2)
  const rootCluster = clusters.find((c) => c.rootSessionId === 'root')
  assert.ok(rootCluster)
  assert.deepEqual(rootCluster.sessions.map((s) => s.sessionId), ['root', 'child', 'grand'])
})

test('buildClusters treats missing parent as its own root', () => {
  const clusters = buildClusters([
    session('orphan', 'missing-parent', 'orphan'),
  ])
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].rootSessionId, 'orphan')
})

test('buildClusters is cycle-safe', () => {
  const clusters = buildClusters([
    session('a', 'b', 'a'),
    session('b', 'a', 'b'),
  ])
  assert.ok(clusters.length >= 1)
})

test('buildClusters keeps descendants reachable from a cycle member', () => {
  const clusters = buildClusters([
    session('a', 'b', 'a'),
    session('b', 'a', 'b'),
    session('c', 'a', 'c'),
  ])
  const cluster = clusters.find((c) => c.sessions.some((s) => s.sessionId === 'c'))
  assert.ok(cluster)
  assert.ok(cluster.sessions.some((s) => s.sessionId === 'a'))
  assert.ok(cluster.sessions.some((s) => s.sessionId === 'b'))
})
