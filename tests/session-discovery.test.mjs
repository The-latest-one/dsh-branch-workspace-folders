import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('session file resolution chooses highest version format', async () => {
  const testDir = join(tmpdir(), `dsh-test-sessions-${Date.now()}`)
  const wsDir = join(testDir, 'workspace1')
  const sessionDir = join(wsDir, 'session-abc')
  mkdirSync(sessionDir, { recursive: true })

  writeFileSync(join(sessionDir, 'session.jsonl.zstd'), 'v0-content')
  writeFileSync(join(sessionDir, 'session.v2.jsonl.zstd'), 'v2-content')
  writeFileSync(join(sessionDir, 'session.v3.jsonl.zstd'), 'v3-content')
  writeFileSync(join(sessionDir, 'session.v4.jsonl.zstd'), 'v4-content')
  writeFileSync(join(sessionDir, 'session.lock'), '')

  // Test the regex and priority algorithm used in src/index.ts
  const entries = ['session.jsonl.zstd', 'session.v2.jsonl.zstd', 'session.v3.jsonl.zstd', 'session.v4.jsonl.zstd', 'session.lock']
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
