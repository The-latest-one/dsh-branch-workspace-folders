// @ts-ignore - vendored official WorkspaceBrowser module (CJS)
declare const require: any
const WorkspaceBrowserModule = require('../vendor/workspace-browser/client.cjs') as any
const { WorkspaceBrowser } = WorkspaceBrowserModule as any

export const name = 'dsh-branch-workspace-folders'

export const inject = ['slots', 'sessions', 'workspaces']

interface ClientContext {
  get(name: string): any
  effect(effect: () => (() => void) | void, name?: string): unknown
}

export function apply(ctx: ClientContext): void {
  const slots = ctx.get('slots')
  if (!slots || typeof slots.inject !== 'function' || typeof slots.entries !== 'function' || typeof slots.subscribe !== 'function') return

  // We intentionally do not register a second `sidebar.workspaces` entry because
  // the official ui-workspace already declares the `sidebar.workspaces.directoryFlow`
  // child slot; a second declaration would collide. Instead we watch the official
  // registration and swap only its renderer with the vendored/modified browser.
  // Subscribing to registration changes makes the replacement robust against:
  //   - the official entry appearing after this plugin loads,
  //   - the official entry being removed/re-added later,
  //   - multiple candidate entries (we only ever take the first official-like one),
  //   - unload restoring the exact original component/inject only while we still own them.
  const replaced = new Map<any, { original: any; originalInject: any; wrappedInject?: any }>()

  const isOfficialEntry = (candidate: any): boolean => !!candidate && (
    candidate.children?.['sidebar.workspaces.directoryFlow'] ||
    candidate.options?.children?.['sidebar.workspaces.directoryFlow']
  )

  const restoreEntry = (entry: any, state: any) => {
    if (entry.component === WorkspaceBrowser) entry.component = state.original
    const currentInject = entry.inject ?? entry.options?.inject
    if (state.wrappedInject !== undefined && currentInject === state.wrappedInject) {
      if (entry.inject === state.wrappedInject) entry.inject = state.originalInject
      if (entry.options && entry.options.inject === state.wrappedInject) entry.options.inject = state.originalInject
    }
  }

  const restoreReplaced = () => {
    for (const [entry, state] of replaced) {
      restoreEntry(entry, state)
    }
    replaced.clear()
  }

  const sync = () => {
    const entries = slots.entries('sidebar.workspaces') as any[]

    // Remove stale entries that have been unregistered.
    for (const [entry, state] of replaced) {
      if (!entries.includes(entry)) {
        restoreEntry(entry, state)
        replaced.delete(entry)
      }
    }

    const official = entries.find(isOfficialEntry)
    if (!official || replaced.has(official) || official.component === WorkspaceBrowser) return

    const original = official.component
    const originalInject = official.inject ?? official.options?.inject
    const state: any = { original, originalInject }
    official.component = WorkspaceBrowser

    if (typeof originalInject === 'function') {
      const sessions = ctx.get('sessions')
      const wrappedInject = () => {
        const base = originalInject()
        return {
          ...(base || {}),
          refreshSessions: () => {
            if (sessions && typeof sessions.refresh === 'function') return sessions.refresh()
            return undefined
          },
        }
      }
      if (typeof official.inject === 'function') official.inject = wrappedInject
      if (official.options && typeof official.options.inject === 'function') official.options.inject = wrappedInject
      state.wrappedInject = wrappedInject
    }

    replaced.set(official, state)
  }

  ctx.effect(() => {
    const unsubscribe = slots.subscribe('sidebar.workspaces', sync)
    sync()
    return () => {
      unsubscribe()
      restoreReplaced()
    }
  }, 'dsh-branch-workspace-folders: workspace browser renderer')
}
