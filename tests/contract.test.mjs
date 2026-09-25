import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('built client retains branch-tree, workspace-tree and archived filter capabilities', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /buildSessionTree/)
  assert.match(client, /flattenSessionTree/)
  assert.match(client, /hasMore/)
  assert.match(client, /setBranchCollapsed/)
  assert.match(client, /workspace-tree/)
  assert.match(client, /archivedFilter/)
  assert.match(client, /onUnarchive/)
  assert.match(client, /IconTreeCornerRegular/)
  assert.match(client, /--dsh-branch-indent/)
  assert.match(client, /--dsh-branch-depth/)
  assert.match(client, /branchParent/)
  assert.match(client, /deepBranch/)
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
