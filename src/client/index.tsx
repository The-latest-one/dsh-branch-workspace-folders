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
      if (this.state.failed) {
        const Fallback = original
        return Fallback ? <Fallback {...this.props} /> : null
      }
      return <WorkspaceBrowser {...this.props} />
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
  //   - replace its renderer with our vendored WorkspaceBrowser,
  //   - patch the already-registered official store handle to add the
  //     branch-collapse actions/state that the official store lacks,
  //   - wrap its inject to add refreshSessions(),
  //   - restore everything only while we still own them.
  const replaced = new Map<any, { original: any; originalInject?: any; wrappedInject?: any; swappedComponent?: any; patchedActions?: any; patchedInit?: any }>()

  const isOfficialEntry = (candidate: any): boolean => !!candidate && (
    candidate.children?.['sidebar.workspaces.directoryFlow'] ||
    candidate.options?.children?.['sidebar.workspaces.directoryFlow']
  )

  const patchStoreActions = (store: any): any => {
    if (!store || !store.spec || !store.spec.actions) return undefined
    // Clone spec.actions so we do not leak into the shared official spec across reloads before restore
    const actions = { ...store.spec.actions }
    store.spec = { ...store.spec, actions }
    const patched: any = {}

    if (typeof actions.setBranchCollapsed !== 'function') {
      actions.setBranchCollapsed = (d: any, accountKey: string, nodeId: string, collapsed: boolean) => {
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
      patched.setBranchCollapsed = actions.setBranchCollapsed
    }

    if (typeof actions.setAllBranchesCollapsed !== 'function') {
      actions.setAllBranchesCollapsed = (d: any, accountKey: string, nodeIds: string[], collapsed: boolean) => {
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
      patched.setAllBranchesCollapsed = actions.setAllBranchesCollapsed
    }

    const originalInit = store.spec.init
    if (typeof originalInit === 'function') {
      const wrappedInit = () => {
        try {
          const base = originalInit()
          return {
            ...(base || {}),
            collapsedBranchesByAccount: (base && base.collapsedBranchesByAccount) || {},
          }
        } catch (e) {
          console.error('[dsh-branch-workspace-folders] workspace view init failed, using empty state', e)
          return { groupBy: 'workspace', orderBy: 'updated', groupExpansion: {}, collapsedBranchesByAccount: {} } as any
        }
      }
      store.spec.init = wrappedInit
      patched.init = originalInit
      patched.wrappedInit = wrappedInit
    }

    return patched
  }

  const restoreStorePatch = (store: any, patched: any) => {
    if (!store || !store.spec || !store.spec.actions || !patched) return
    if (patched.setBranchCollapsed && store.spec.actions.setBranchCollapsed === patched.setBranchCollapsed) {
      delete store.spec.actions.setBranchCollapsed
    }
    if (patched.setAllBranchesCollapsed && store.spec.actions.setAllBranchesCollapsed === patched.setAllBranchesCollapsed) {
      delete store.spec.actions.setAllBranchesCollapsed
    }
    if (patched.wrappedInit && store.spec.init === patched.wrappedInit) {
      store.spec.init = patched.init
    }
    // If another plugin wrapped `init` after us, leave the wrapper in place.
  }

  const restoreEntry = (entry: any, state: any) => {
    if (state.swappedComponent !== undefined && entry.component === state.swappedComponent) entry.component = state.original
    else if (entry.component === WorkspaceBrowser) entry.component = state.original
    const currentInject = entry.inject ?? entry.options?.inject
    if (state.wrappedInject !== undefined && currentInject === state.wrappedInject) {
      if (entry.inject === state.wrappedInject) entry.inject = state.originalInject
      if (entry.options && entry.options.inject === state.wrappedInject) entry.options.inject = state.originalInject
    }
    if (state.store && state.patchedActions) restoreStorePatch(state.store, state.patchedActions)
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
    const store = official.store ?? official.options?.store
    const SafeWorkspaceBrowser = createSafeWorkspaceBrowser(original)
    const state: any = { original, originalInject, swappedComponent: SafeWorkspaceBrowser, store }

    official.component = SafeWorkspaceBrowser
    state.patchedActions = patchStoreActions(store)

    if (typeof originalInject === 'function') {
      const wrappedInject = () => {
        const base = originalInject()
        return {
          ...(base || {}),
          refreshSessions: () => {
            const liveSessions = ctx.get('sessions')
            if (liveSessions && typeof liveSessions.refresh === 'function') return liveSessions.refresh()
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
