import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('built client retains branch-tree and search-load-more capabilities', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /buildSessionTree/)
  assert.match(client, /flattenSessionTree/)
  assert.match(client, /search\.hasMore/)
  assert.match(client, /treeRowCount/)
  assert.match(client, /outside its branch parent/)
})

test('host no longer exposes the unused full-decompression clusters endpoint', () => {
  const host = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(host, /API_PREFIX\}\/clusters/)
  assert.doesNotMatch(host, /parseAllSessions/)
})

test('host exports buildClusters for legacy/tests', async () => {
  const { buildClusters } = await import('../lib/index.js')
  assert.equal(typeof buildClusters, 'function')
})
