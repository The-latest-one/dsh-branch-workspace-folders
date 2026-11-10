if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    __ModuleLoader__: { load: () => {} },
  }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { distinguishingPathSuffixes } = await import(
  '../src/vendor/official-ui-workspace/path-suffix.ts'
)

const { deriveSearchResults } = await import(
  '../src/vendor/official-ui-workspace/tree.ts'
)

test('DSH v0.2.2-rc.1: distinguishingPathSuffixes correctly disambiguates same-titled workspaces', () => {
  const workspaces = [
    { id: 'ws-1', title: 'web', path: '/home/user/projectA/apps/web' },
    { id: 'ws-2', title: 'web', path: '/home/user/projectB/apps/web' },
    { id: 'ws-3', title: 'unique-workspace', path: '/home/user/unique' },
    { id: 'ws-4', title: 'docs', path: '/home/user/deep/nested/docs' },
    { id: 'ws-5', title: 'docs', path: '/home/user/shallow/nested/docs' },
  ]

  const suffixes = distinguishingPathSuffixes(workspaces)

  // Unique workspace gets no suffix
  assert.equal(suffixes.get('ws-3'), undefined)

  // Same-titled workspaces get the shortest distinguishing trailing path segments
  assert.equal(suffixes.get('ws-1'), 'projectA/apps/web')
  assert.equal(suffixes.get('ws-2'), 'projectB/apps/web')
  assert.equal(suffixes.get('ws-4'), 'deep/nested/docs')
  assert.equal(suffixes.get('ws-5'), 'shallow/nested/docs')
})

test('DSH v0.2.2-rc.1: deriveSearchResults matches session ID substrings', () => {
  const list = {
    ids: ['sess-abc-12345', 'sess-xyz-98765'],
    byId: {
      'sess-abc-12345': {
        id: 'sess-abc-12345',
        title: 'Alpha Project',
        blank: false,
        running: false,
        updatedAt: 1000,
        retainedBy: {},
      },
      'sess-xyz-98765': {
        id: 'sess-xyz-98765',
        title: 'Beta Project',
        blank: false,
        running: false,
        updatedAt: 2000,
        retainedBy: {},
      },
    },
  }

  const workspaces = [
    { workspaceId: 'ws-main', title: 'Main Workspace', sessionIds: ['sess-abc-12345'] },
  ]

  const statuses = new Map()

  // 1. Search by session ID substring '12345'
  const resId = deriveSearchResults(
    list,
    workspaces,
    '12345',
    [],
    'default',
    statuses,
    { items: [], hasMore: false },
    20,
  )
  assert.equal(resId.items.length, 1)
  assert.equal(resId.items[0].id, 'sess-abc-12345')

  // 2. Search by session ID prefix 'xyz'
  const resPrefix = deriveSearchResults(
    list,
    workspaces,
    'xyz',
    [],
    'default',
    statuses,
    { items: [], hasMore: false },
    20,
  )
  assert.equal(resPrefix.items.length, 1)
  assert.equal(resPrefix.items[0].id, 'sess-xyz-98765')
})

test('DSH v0.2.2-rc.1: built client bundle includes v0.2.2 tokens, trailing slot, and dialogs', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

  // 1. Slot: sidebar.session.row.trailing
  assert.match(client, /sidebar\.session\.row\.trailing/)

  // 2. Container: rowResting
  assert.match(client, /rowResting/)

  // 3. Tokens: --dsh-sidebar-paint-inset & --dsh-sidebar-row-padding & --dsh-sidebar-label-gap
  assert.match(client, /--dsh-sidebar-paint-inset/)
  assert.match(client, /--dsh-sidebar-row-padding/)
  assert.match(client, /--dsh-sidebar-label-gap/)

  // 4. Path disambiguation
  assert.match(client, /distinguishingPathSuffixes/)
  assert.match(client, /disambiguated/)

  // 5. WorkspaceDialogs
  assert.match(client, /WorkspaceDialogs/)

  // 6. 24px iconButton
  assert.match(client, /width:\s*24px/)

  // 7. Touch and coarse pointer rules
  assert.match(client, /pointer:\s*coarse/)
  assert.match(client, /hover:\s*none/)

  // 8. Drag preview
  assert.match(client, /useRowDragPreview/)
  assert.match(client, /dragPreview/)

  // 9. Context menu integration
  assert.match(client, /openSessionMenu/)
  assert.match(client, /openWorkspaceMenu/)
})
