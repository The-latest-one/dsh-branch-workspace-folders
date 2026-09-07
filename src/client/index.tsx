import { Component } from 'react'
import { WorkspaceBrowser } from './vendor-runtime'
import { ArchivedSettingsSection, archivedLocales, archivedNamespace } from './archived-settings'

function createSafeWorkspaceBrowser(original: any): any {
  return class SafeWorkspaceBrowser extends Component<any, { failed: boolean }> {
    state = { failed: false }

    static getDerivedStateFromError() {
      return { failed: true }
    }

    componentDidCatch(error: any) {
      console.error('[dsh-branch-workspace-folders] WorkspaceBrowser crashed, falling back to official renderer', error)
    }

    componentDidUpdate(prevProps: any) {
      if (this.state.failed && prevProps !== this.props) {
        // Allow retry when the underlying data changes (e.g. after sessions refresh)
        // The next render will attempt WorkspaceBrowser again; if it crashes again we fallback.
        // We do not auto-reset on every update to avoid loops, but prop identity change is a signal.
      }
    }

    render() {
      const props = this.props as any
      if (this.state.failed) {
        const Fallback = original as any
        return Fallback ? <Fallback {...props} /> : null
      }
      return <WorkspaceBrowser {...props} />
    }
  }
}

export const name = 'dsh-branch-workspace-folders'

export const inject = ['slots', 'sessions', 'workspaces', 'locale']

interface ClientContext {
  get(name: string): any
  effect(effect: () => (() => void) | void, name?: string): unknown
}

export function apply(ctx: ClientContext): void {
  const slots = ctx.get('slots')
  if (!slots || typeof slots.inject !== 'function' || typeof slots.entries !== 'function' || typeof slots.subscribe !== 'function') return

  // Settings UI: archived-session management page.
  const locale = ctx.get('locale')
  if (locale && typeof locale.register === 'function' && typeof ctx.effect === 'function') {
    ctx.effect(() => locale.register(archivedNamespace, archivedLocales), 'dsh-branch-workspace-folders: archive locales')
  }
  const t = locale && typeof locale.bind === 'function'
    ? locale.bind(archivedNamespace)
    : ((key: string, params?: any) => {
        const dict: Record<string, string> = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language) ? archivedLocales.zh : archivedLocales.en
        const template = dict[key] ?? key
        if (!params) return template
        return template.replace(/\{(\w+)\}/g, (_: string, name: string) => (name in params ? String(params[name]) : ''))
      })
  const refreshSidebar = async () => {
    const liveSessions = ctx.get('sessions')
    const liveWorkspaces = ctx.get('workspaces')
    try {
      await liveSessions?.refresh?.()
    } catch {
      // best-effort; the next host/workspace sync will also converge
    }
    try {
      await liveWorkspaces?.refresh?.()
    } catch {
      // best-effort; the next host/workspace sync will also converge
    }
  }
  const ArchivedSection = (props: any) => <ArchivedSettingsSection {...props} t={t} onMutated={refreshSidebar} />
  slots.inject('settings.section', () => slots.register({
    name: 'settings.section',
    id: 'branch-workspace-archives',
    order: 20,
    label: () => (t('nav') as string) || archivedLocales.zh.nav,
    locale: archivedNamespace,
    inject: () => ({ t }),
  }, ArchivedSection))

  // The official ui-workspace entry owns the `sidebar.workspaces.directoryFlow`
  // child declaration (needed for the framework to pass `renderSlot` to
  // WorkspaceBrowser), so we cannot register a parallel entry that re-declares
  // that child. Instead we shadow the official entry in place:
  //   - replace its renderer with our vendored WorkspaceBrowser (official
  //     0.1.2-rc.1 baseline + branch features),
  //   - patch the already-registered official store handle IN PLACE: the
  //     renderer pins store handles by identity at register() time
  //     (resolveStore looks the live `entry.store` up in its private
  //     handle map and throws for unregistered handles), so replacing
  //     `entry.store` with our own handle would kill the whole region.
  //     The engine's create() reads the spec object captured in the
  //     defineStore closure, so patching must mutate the spec's own
  //     properties (actions/init/persist) rather than swapping the
  //     handle.spec reference.
  //   - restore everything only while we still own them.
  const replaced = new Map<any, {
    original: any
    swappedComponent?: any
    restoreSpec?: () => void
  }>()

  const isOfficialEntry = (candidate: any): boolean => !!candidate && (
    candidate.children?.['sidebar.workspaces.directoryFlow'] ||
    candidate.options?.children?.['sidebar.workspaces.directoryFlow']
  )

  const patchStoreSpec = (store: any): (() => void) | undefined => {
    if (!store || !store.spec || !store.spec.actions) return undefined
    const spec = store.spec
    const actions = spec.actions
    const added: Array<{ key: string; fn: any }> = []

    if (typeof actions.setBranchCollapsed !== 'function') {
      const fn = (d: any, accountKey: string, nodeId: string, collapsed: boolean) => {
        if (!d.collapsedBranchesByAccount) d.collapsedBranchesByAccount = {}
        const list = Array.isArray(d.collapsedBranchesByAccount[accountKey])
          ? d.collapsedBranchesByAccount[accountKey].slice()
          : []
        const index = list.indexOf(nodeId)
        if (collapsed) {
          if (index === -1) list.push(nodeId)
        } else if (index !== -1) {
          list.splice(index, 1)
        }
        d.collapsedBranchesByAccount[accountKey] = list
      }
      actions.setBranchCollapsed = fn
      added.push({ key: 'setBranchCollapsed', fn })
    }

    if (typeof actions.setAllBranchesCollapsed !== 'function') {
      const fn = (d: any, accountKey: string, nodeIds: string[], collapsed: boolean) => {
        if (!d.collapsedBranchesByAccount) d.collapsedBranchesByAccount = {}
        const prev = new Set(Array.isArray(d.collapsedBranchesByAccount[accountKey])
          ? d.collapsedBranchesByAccount[accountKey]
          : [])
        for (const id of nodeIds) {
          if (collapsed) prev.add(id)
          else prev.delete(id)
        }
        d.collapsedBranchesByAccount[accountKey] = Array.from(prev)
      }
      actions.setAllBranchesCollapsed = fn
      added.push({ key: 'setAllBranchesCollapsed', fn })
    }

    const originalInit = spec.init
    const patchedInit = () => {
      try {
        const base = originalInit()
        return {
          ...(base || {}),
          collapsedBranchesByAccount: (base && base.collapsedBranchesByAccount) || {},
        }
      } catch (error) {
        console.error('[dsh-branch-workspace-folders] workspace view init failed, using empty state', error)
        return { groupBy: 'workspace', orderBy: 'updated', groupExpansion: {}, collapsedBranchesByAccount: {} } as any
      }
    }
    spec.init = patchedInit
    const originalPersist = spec.persist
    // Keep the v0.1.14 persist key: existing users keep their view state
    // (the official 0.1.2-rc.1 renamed it to v5, which would discard it).
    spec.persist = 'dsh.workspace.view.v6'

    return () => {
      for (const { key, fn } of added) {
        if (actions[key] === fn) delete actions[key]
      }
      if (spec.init === patchedInit) spec.init = originalInit
      if (spec.persist === 'dsh.workspace.view.v6') spec.persist = originalPersist
    }
  }

  const restoreEntry = (entry: any, state: any) => {
    if (state.swappedComponent !== undefined && entry.component === state.swappedComponent) {
      entry.component = state.original
    }
    if (state.restoreSpec !== undefined) state.restoreSpec()
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
    if (!official || replaced.has(official)) return

    const original = official.component
    const store = official.store ?? official.options?.store
    const SafeWorkspaceBrowser = createSafeWorkspaceBrowser(original)
    const restoreSpec = patchStoreSpec(store)
    official.component = SafeWorkspaceBrowser
    replaced.set(official, {
      original,
      swappedComponent: SafeWorkspaceBrowser,
      restoreSpec,
    })
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
