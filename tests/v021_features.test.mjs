import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('DSH v0.2.1-rc.3: displayTitle implementation falls back to session.untitled for unnamed sessions', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  // Verify displayTitle contains t("session.untitled") fallback
  assert.match(client, /node\.blank \? t\(["']session\.new["']\) : node\.title(?:\?\.trim\(\))? \|\| t\(["']session\.untitled["']\)/)
})

test('DSH v0.2.1-rc.3: client bundle includes AnimatedRows, overflow key and EmptySessions', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

  // Verify AnimatedRows integration
  assert.match(client, /AnimatedRows/)

  // Verify overflow row key for watermark animation
  assert.match(client, /overflow:/)

  // Verify emptyState data-row-key
  assert.match(client, /["']data-row-key["']:\s*["']empty["']/)

  // Verify session.untitled translation inclusion
  assert.match(client, /session\.untitled/)

  // Verify default-workspace localization
  assert.match(client, /default-workspace/)
})

test('DSH v0.2.1-rc.3: locales contain complete official keys including untitled, empty state and shortcuts', async () => {
  const { zh, en } = await import('../src/vendor/official-ui-workspace/locales.ts')

  assert.equal(zh['session.untitled'], '未命名')
  assert.equal(en['session.untitled'], 'Untitled')

  assert.equal(zh['empty.noneArchived'], '暂无已归档会话')
  assert.equal(en['empty.noneArchived'], 'No archived sessions yet')

  assert.equal(zh['empty.viewOthers'], '查看其他会话')
  assert.equal(en['empty.viewOthers'], 'View other sessions')

  assert.equal(zh['workspace.defaultName'], '默认工作区')
  assert.equal(en['workspace.defaultName'], 'Default workspace')
})
