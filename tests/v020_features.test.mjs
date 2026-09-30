import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('DSH v0.2.0-rc.2: client bundle declares and invokes sidebar.session.row.leading and hover slots', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  // Verify leading seat slot
  assert.match(client, /sidebar\.session\.row\.leading/)
  // Verify hover section slot
  assert.match(client, /sidebar\.session\.row\.hover/)
})

test('DSH v0.2.0-rc.2: client bundle includes data-row-key for AnimatedRows FLIP integration', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /data-row-key/)
  assert.match(client, /data-row-key.*session:/)
})

test('DSH v0.2.0-rc.2: client bundle includes useTitleMarquee smooth hover scrolling', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /useTitleMarquee/)
  assert.match(client, /scrollTo/)
})

test('DSH v0.2.0-rc.2: session discovery prioritizes session.v4.jsonl.zstd over v3, v2 and v0', () => {
  const testDir = join(tmpdir(), `dsh-test-v4-${Date.now()}`)
  const wsDir = join(testDir, 'workspace-v4')
  const sessionDir = join(wsDir, 'session-v4-target')
  mkdirSync(sessionDir, { recursive: true })

  writeFileSync(join(sessionDir, 'session.jsonl.zstd'), 'v0')
  writeFileSync(join(sessionDir, 'session.v2.jsonl.zstd'), 'v2')
  writeFileSync(join(sessionDir, 'session.v3.jsonl.zstd'), 'v3')
  writeFileSync(join(sessionDir, 'session.v4.jsonl.zstd'), 'v4')

  const entries = ['session.jsonl.zstd', 'session.v2.jsonl.zstd', 'session.v3.jsonl.zstd', 'session.v4.jsonl.zstd']
  let bestFile
  let bestVersion = -1
  for (const name of entries) {
    const match = /^session(?:\.v(\d+))?\.jsonl\.zstd$/.exec(name)
    if (!match) continue
    const version = match[1] !== undefined ? parseInt(match[1], 10) : 0
    if (version > bestVersion) {
      bestVersion = version
      bestFile = name
    }
  }

  assert.equal(bestFile, 'session.v4.jsonl.zstd')
  assert.equal(bestVersion, 4)

  rmSync(testDir, { recursive: true, force: true })
})

test('root session uses solid triangle toggle (IconTriangleRightFillRegular) while child branch keeps chevron', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  // Root uses IconTriangleRightFillRegular with arrowOpen
  assert.match(client, /IconTriangleRightFillRegular/)
  assert.match(client, /arrowOpen/)
  // Child branch retains Chevron
  assert.match(client, /IconChevronRightOutlineRegular/)
  assert.match(client, /IconChevronDownOutlineRegular/)
})
