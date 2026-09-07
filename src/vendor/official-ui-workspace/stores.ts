/**
 * The workspace browser's viewing store: the session-list grouping mode,
 * persisted across reloads. Module level exports the factory only (a
 * module-level handle would pin the store identity across plugin reloads);
 * register() receives the factory and the browser derives its PropsStore
 * share from the return type.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Browser-local order account for the hierarchy-free flat Session list. */
export const FLAT_SESSION_ORDER_KEY = '__flat_session_order__'

/** Session-list grouping mode: workspace sections or one flat recency list. */
export type SessionGroupBy = 'workspace' | 'flat'
/** Session order: user-arranged only, or user-arranged plus activity promotion. */
export type SessionOrderBy = 'manual' | 'updated'

/** Workspace browser viewing state persisted across surface remounts and reloads. */
type WorkspaceViewState = {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  /** Explicit zero-or-five-session state keyed by Workspace group identity. */
  groupExpansion: Record<string, boolean>
  /** Shared editable order per Workspace group plus the browser-local flat-list account. */
  sessionOrderByAccount: Record<string, string[]>
  /** Last observed update timestamps per order account for one-time promotion events. */
  sessionUpdatedAtByAccount: Record<string, Record<string, number>>
    /**
     * Branch-collapse state per order account: each entry lists the branch
     * root Session ids whose descendant rows are currently hidden.
     */
    collapsedBranchesByAccount: Record<string, string[]>
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type WorkspaceViewActions = {
  setGroupBy: (draft: WorkspaceViewState, mode: SessionGroupBy) => void
  setOrderBy: (draft: WorkspaceViewState, mode: SessionOrderBy) => void
  setGroupExpanded: (draft: WorkspaceViewState, key: string, expanded: boolean) => void
  retainAccountKeys: (draft: WorkspaceViewState, workspaceKeys: readonly string[]) => void
  syncSessionOrderAccount: (
    draft: WorkspaceViewState,
    accountKey: string,
    order: string[],
    updatedAt: Record<string, number>,
  ) => void
  setSessionOrder: (draft: WorkspaceViewState, accountKey: string, order: string[]) => void
    setBranchCollapsed: (draft: WorkspaceViewState, accountKey: string, nodeId: string, collapsed: boolean) => void
    setAllBranchesCollapsed: (
      draft: WorkspaceViewState,
      accountKey: string,
      nodeIds: readonly string[],
      collapsed: boolean,
    ) => void
}

/**
 * Create the workspace browser viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createWorkspaceViewStore(): EngineStoreHandle<WorkspaceViewState, WorkspaceViewActions> {
  return defineStore({
    init: (): WorkspaceViewState => ({
      groupBy: 'workspace',
      orderBy: 'updated',
      groupExpansion: {},
      sessionOrderByAccount: {},
      sessionUpdatedAtByAccount: {},
        collapsedBranchesByAccount: {},
    }),
      persist: 'dsh.workspace.view.v6',
    actions: {
      setGroupBy: (d, mode: SessionGroupBy) => { d.groupBy = mode },
      setOrderBy: (d, mode: SessionOrderBy) => { d.orderBy = mode },
      setGroupExpanded: (d, key: string, expanded: boolean) => { d.groupExpansion[key] = expanded },
      retainAccountKeys: (d, workspaceKeys: readonly string[]) => {
        const retained = new Set(workspaceKeys)
        d.groupExpansion = Object.fromEntries(
          Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)),
        )
        d.sessionOrderByAccount = Object.fromEntries(
          Object.entries(d.sessionOrderByAccount).filter(([key]) => retained.has(key)),
        )
        d.sessionUpdatedAtByAccount = Object.fromEntries(
          Object.entries(d.sessionUpdatedAtByAccount).filter(([key]) => retained.has(key)),
        )
        d.collapsedBranchesByAccount = Object.fromEntries(
          Object.entries(d.collapsedBranchesByAccount).filter(([key]) => retained.has(key)),
        )
      },
      syncSessionOrderAccount: (d, accountKey: string, order: string[], updatedAt: Record<string, number>) => {
        d.sessionOrderByAccount[accountKey] = order
        d.sessionUpdatedAtByAccount[accountKey] = updatedAt
      },
        setBranchCollapsed: (d, accountKey: string, nodeId: string, collapsed: boolean) => {
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
        },
        setAllBranchesCollapsed: (d, accountKey: string, nodeIds: readonly string[], collapsed: boolean) => {
          const prev = new Set(
            Array.isArray(d.collapsedBranchesByAccount[accountKey])
              ? d.collapsedBranchesByAccount[accountKey]
              : [],
          )
          for (const id of nodeIds) {
            if (collapsed) prev.add(id)
            else prev.delete(id)
          }
          d.collapsedBranchesByAccount[accountKey] = Array.from(prev)
        },
      setSessionOrder: (d, accountKey: string, order: string[]) => {
        d.sessionOrderByAccount[accountKey] = order
      },
    },
  })
}
