/**
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + view options + add
 * workspace), search, the grouped tree or flat list, and the workspace
 * dialogs. Wide state renders the full browser; rail state renders the two
 * region icons (search / add workspace) as 36px controls on the shell's shared
 * rail entry path, each requesting expansion through the owner share. Adding
 * is the header button's one action, so it raises the directory flow with no
 * menu in between; the flow and its error dialog live in WorkspacePicker
 * (same package — direct composition, no slot between them).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconBranchOutline16, IconCloseFill14, IconFolderClose16, IconFolderOpen16,
  IconPersonalizationOutline16, IconProjectAddOutline16, IconSearchOutline16,
  Menu, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SessionListState, SessionSearchResultItem,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { SessionNode, SessionOrderBy } from '../tree.ts'
import {
  deriveFlat, deriveGroups, deriveSearchResults, owningGroupKey, UNGROUPED_KEY,
} from '../tree.ts'
import { ProjectRowItem, SearchResultItem, SessionNodeItem } from './Rows.tsx'
import {
  buildPathMap, buildSessionTree, buildSiblingsMap, collectBranchIds,
  findSessionAncestors, flattenSessionTree,
} from '../branch.ts'
import { uiLabel } from '../ui-label.ts'
import { FLAT_SESSION_ORDER_KEY, type SessionGroupBy } from '../stores.ts'
import { WorkspacePickFlow } from '../WorkspacePicker.tsx'
import css from './WorkspaceBrowser.module.css'

/**
 * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
 * focus() forces a synchronous layout and would jank the slide.
 */
const EXPAND_SLIDE_MS = 300
/** Pause between the latest keystroke and a Host content-search request. */
const SEARCH_DEBOUNCE_MS = 250
/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
const SEARCH_QUERY_MAX_CODE_UNITS = 500
/** Session rows visible per Workspace before the local overflow control. */
const COLLAPSED_SESSION_LIMIT = 5

/** Fold one Workspace without charging its provisional New Session against the ordinary-row limit. */
function collapsedSessionRows(sessions: readonly SessionNode[]): {
  rows: readonly SessionNode[]
  hiddenCount: number
} {
  let ordinaryCount = 0
  const rows = sessions.filter((session) => {
    if (session.blank) return true
    if (ordinaryCount >= COLLAPSED_SESSION_LIMIT) return false
    ordinaryCount += 1
    return true
  })
  return { rows, hiddenCount: sessions.length - rows.length }
}

/** Keep controlled input and RPC payload inside the session.search wire contract. */
function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--
  return withoutNul.slice(0, end)
}

/** Immutable membership toggle for the local expand-all array. */
function toggled(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter(k => k !== key) : [...list, key]
}

/**
 * Accept the native drag at document level while a row drag is active: row
 * hover still owns the insertion marker, and releasing outside the list must
 * not be rendered as a rejected drop before dragend commits that last marker.
 */
function useNativeDragAcceptance(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const acceptDrag = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    }
    const acceptDrop = (event: DragEvent): void => { event.preventDefault() }
    document.addEventListener('dragover', acceptDrag)
    document.addEventListener('drop', acceptDrop)
    return () => {
      document.removeEventListener('dragover', acceptDrag)
      document.removeEventListener('drop', acceptDrop)
    }
  }, [active])
}

/** Reconcile a stored view order with the Workspace's current session account. */
function reconciledSessionOrder(sessionIds: readonly SessionId[], stored: readonly string[] | undefined): SessionId[] {
  if (stored === undefined) return [...sessionIds]
  const byId = new Map(sessionIds.map(id => [id as string, id]))
  const ordered: SessionId[] = []
  const included = new Set<string>()
  for (const key of stored) {
    const id = byId.get(key)
    if (id === undefined || included.has(key)) continue
    ordered.push(id)
    included.add(key)
  }
  for (const id of sessionIds) {
    if (included.has(id)) continue
    ordered.push(id)
  }
  return ordered
}

/** Newest update first with stable Session identity as the tie-break. */
function compareSessionRecency(a: SessionId, b: SessionId, byId: SessionListState['byId']): number {
  const aUpdatedAt = byId[a]?.updatedAt ?? Number.NEGATIVE_INFINITY
  const bUpdatedAt = byId[b]?.updatedAt ?? Number.NEGATIVE_INFINITY
  if (aUpdatedAt !== bUpdatedAt) return bUpdatedAt - aUpdatedAt
  return a < b ? -1 : 1
}

/** Reconcile one editable order account and apply its activity-promotion policy. */
function nextSessionOrderAccount({
  sessionIds, previousOrder, previousUpdatedAt, list, orderBy, sortByRecency,
}: {
  sessionIds: readonly SessionId[]
  previousOrder: readonly string[] | undefined
  previousUpdatedAt: Readonly<Record<string, number>>
  list: SessionListState
  orderBy: SessionOrderBy
  sortByRecency: boolean
}): { order: SessionId[]; updatedAt: Record<string, number>; changed: boolean } {
  let order = reconciledSessionOrder(sessionIds, previousOrder)
  if (sortByRecency) {
    order.sort((a, b) => compareSessionRecency(a, b, list.byId))
  } else if (orderBy === 'updated') {
    const promoted = sessionIds
      .filter((id) => {
        const session = list.byId[id]
        return session !== undefined
          && (previousUpdatedAt[id] === undefined || session.updatedAt > previousUpdatedAt[id])
      })
      .sort((a, b) => compareSessionRecency(a, b, list.byId))
    if (promoted.length > 0) {
      const promotedIds = new Set(promoted)
      order = [...promoted, ...order.filter(id => !promotedIds.has(id))]
    }
  }
  const updatedAt: Record<string, number> = {}
  for (const id of sessionIds) {
    const session = list.byId[id]
    if (session !== undefined) updatedAt[id] = session.updatedAt
  }
  const orderChanged = previousOrder === undefined
    || order.length !== previousOrder.length
    || order.some((id, index) => id !== previousOrder[index])
  const timestampsChanged = Object.keys(updatedAt).length !== Object.keys(previousUpdatedAt).length
    || Object.entries(updatedAt).some(([id, timestamp]) => previousUpdatedAt[id] !== timestamp)
  return { order, updatedAt, changed: orderChanged || timestampsChanged }
}

/** Grouping and ordering menu; own open state so it resets with the wide chrome. */
function ViewOptionsMenu({ groupBy, orderBy, onGroupPick, onOrderPick, t }: {
  groupBy: 'workspace' | 'flat'
  orderBy: SessionOrderBy
  onGroupPick: (mode: 'workspace' | 'flat') => void
  onOrderPick: (mode: SessionOrderBy) => void
  t: WorkspaceBrowserProps['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label' as const, id: 'group-by', text: t('groupBy.label') },
        { id: 'workspace', label: t('groupBy.workspace') },
        { id: 'flat', label: t('groupBy.flat') },
        { type: 'separator' as const, id: 'order-by-separator' },
        { type: 'label' as const, id: 'order-by', text: t('orderBy.label') },
        { id: 'manual', label: t('orderBy.manual') },
        { id: 'updated', label: t('orderBy.updated') },
      ]}
      selectedIds={[groupBy, orderBy]}
      onSelect={(id) => {
        if (id === 'workspace' || id === 'flat') onGroupPick(id)
        else if (id === 'manual' || id === 'updated') onOrderPick(id)
        setOpen(false)
      }}
      align="end"
      dense
      // Portal: the section header clips overflow, so an in-place list would
      // be cut off at the header's bounds.
      portal
      anchor={(
        <Tooltip label={t('viewOptions.label')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.wide)}
            aria-label={t('viewOptions.label')}
            onClick={() => { setOpen(v => !v) }}
          >
            <IconPersonalizationOutline16 />
          </button>
        </Tooltip>
      )}
    />
  )
}

/** More-actions menu: batch select, expand/collapse every workspace, expand/collapse every branch. */
function MoreMenu({ onBatchSelect, groupBy, allGroupsExpanded, onToggleAllGroups, allBranchesCollapsed, onToggleAllBranches }: {
  onBatchSelect: () => void
  groupBy: SessionGroupBy
  allGroupsExpanded: boolean
  onToggleAllGroups: () => void
  allBranchesCollapsed: boolean
  onToggleAllBranches: () => void
}) {
  const [open, setOpen] = useState(false)
  const items: any[] = [
    { id: 'batch-select', label: uiLabel('批量选择', 'Select multiple'), icon: <span style={{ fontSize: 14, lineHeight: 1 }}>☑</span> },
  ]
  if (groupBy !== 'flat') {
    items.push({ type: 'separator' as const, id: 'sep-tree' })
    items.push({
      id: 'toggle-workspaces',
      label: allGroupsExpanded ? uiLabel('全部折叠工作区', 'Collapse all workspaces') : uiLabel('全部展开工作区', 'Expand all workspaces'),
      icon: allGroupsExpanded ? <IconFolderClose16 size={14} /> : <IconFolderOpen16 size={14} />,
    })
    items.push({
      id: 'toggle-branches',
      label: allBranchesCollapsed ? uiLabel('全部展开分支', 'Expand all branches') : uiLabel('全部折叠分支', 'Collapse all branches'),
      icon: <IconBranchOutline16 size={13} />,
    })
  }
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={items}
      onSelect={(id) => {
        setOpen(false)
        if (id === 'batch-select') onBatchSelect()
        else if (id === 'toggle-workspaces') onToggleAllGroups()
        else if (id === 'toggle-branches') onToggleAllBranches()
      }}
      align="end"
      dense
      portal
      anchor={(
        <Tooltip label={uiLabel('更多操作', 'More actions')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.wide)}
            aria-label={uiLabel('更多操作', 'More actions')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(v => !v) }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>•••</span>
          </button>
        </Tooltip>
      )}
    />
  )
}

/** In-flight root-row drag: source identity plus the current insert marker. */
interface DragState {
  /** Workspace id, or {@link UNGROUPED_KEY} for the browser-local loose-session account. */
  accountKey: string
  sessionId: SessionNode['id']
  /** Row the marker sits on and which half (insert above/below it). */
  over: { id: SessionNode['id']; half: 'before' | 'after' } | null
}

/** In-flight Workspace-row drag: source identity plus the current marker. */
interface WorkspaceDragState {
  workspaceId: WorkspaceId
  over: { id: WorkspaceId; half: 'before' | 'after' } | null
}

/** Resolve an insertion side from the full rendered workspace group. */
function workspaceGroupHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

type SessionTreeProps = Pick<
  WorkspaceBrowserProps,
  'useSessions' | 'useSessionPendingInteraction' | 'startSession' | 'open' | 'forkSession'
  | 'insertWorkspaceBefore' | 'insertSessionBefore' | 't'
> & {
  /** Host account home for POSIX hover-path abbreviation. */
  home?: string | undefined
  workspaces: readonly WorkspaceView[]
  /** Whether the current Workspace stream has a complete Host baseline. */
  workspaceReady: boolean
  /** Explicit persisted zero-or-five-session state by Workspace group. */
  groupExpansion: Readonly<Record<string, boolean>>
  /** Persist one Workspace group's zero-or-five-session state. */
  setGroupExpanded: (key: string, expanded: boolean) => void
  /** Shared editable orders used by Workspace groups and the flat-list account. */
  sessionOrderByAccount: Readonly<Record<string, readonly string[]>>
  /** Last update timestamps observed for one-time recent-update promotions. */
  sessionUpdatedAtByAccount: Readonly<Record<string, Readonly<Record<string, number>>>>
  /** Replace one shared order and its observed timestamps. */
  syncSessionOrderAccount: (accountKey: string, order: string[], updatedAt: Record<string, number>) => void
  /** Apply a drag to one shared order. */
  setSessionOrder: (accountKey: string, order: string[]) => void
  /** Registry-global archive set (hidden rows). */
  archivedSessionIds: readonly SessionNode['id'][]
  /** Open the browser-owned rename dialog for a real Workspace group. */
  onRenameRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned delete-confirmation dialog for a real Workspace group. */
  onDeleteRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned session rename dialog. */
  onSessionRename: (sessionId: SessionNode['id'], currentTitle: string) => void
  /** Archive a session (row menu action; the row disappears on the state echo). */
  onSessionArchive: (sessionId: SessionNode['id']) => void
  /** Session order behavior: fixed after edits, or additionally promoted by user activity. */
  orderBy: SessionOrderBy
  /** One Session chosen from search that must be exposed and scrolled into view. */
  revealSessionId?: SessionId | undefined
  /** Acknowledge that the chosen Session row has been revealed. */
  onSessionRevealed: (sessionId: SessionId) => void
  /** Branch-collapse state per order account. */
  collapsedBranchesByAccount: Readonly<Record<string, readonly string[]>>
  /** Collapse/expand one branch root inside one order account. */
  setBranchCollapsed: (accountKey: string, nodeId: string, collapsed: boolean) => void
  /** Collapse/expand every branch of one order account. */
  setAllBranchesCollapsed: (accountKey: string, nodeIds: readonly string[], collapsed: boolean) => void
  /** Batch-selection mode active (row checkboxes shown). */
  selectionMode: boolean
  /** Currently batch-selected session ids. */
  selectedIds: ReadonlySet<SessionNode['id']>
  /** Toggle one row in the batch selection. */
  onToggleSelect: (id: SessionNode['id']) => void
}

const EMPTY_COLLAPSED_SET: ReadonlySet<string> = new Set<string>()

/** The scrolling session tree; unmounting drops the sessions subscription and expand-all state. */
function SessionTree({
  useSessions, useSessionPendingInteraction, startSession, open, forkSession, workspaces, archivedSessionIds,
  workspaceReady,
  onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive,
  insertWorkspaceBefore, insertSessionBefore, orderBy,
  groupExpansion, setGroupExpanded,
  sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, home, t,
  revealSessionId, onSessionRevealed,
  collapsedBranchesByAccount, setBranchCollapsed, setAllBranchesCollapsed,
  selectionMode, selectedIds, onToggleSelect,
}: SessionTreeProps) {
  const list = useSessions(s => s)
  const pendingInteractions = useSessionPendingInteraction(s => s)
  const current = list.current
  const revealGroup = revealSessionId === undefined || !workspaceReady
    ? undefined
    : owningGroupKey(workspaces, revealSessionId)
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<string[]>([])
  // Branch auto-expand overrides: a collapsed branch whose subtree holds the
  // current session is temporarily expanded so navigation always lands on a
  // visible row; manual toggles clear the override and persist the new state.
  const [temporaryExpandedByAccount, setTemporaryExpandedByAccount] = useState<Record<string, string[]>>({})
  const migratedCollapsedRef = useRef(false)
  // Transient drag marker state; the selected mode owns the resulting order.
  const [drag, setDrag] = useState<DragState | null>(null)
  const sessionDropCommitted = useRef(false)
  const [workspaceDrag, setWorkspaceDrag] = useState<WorkspaceDragState | null>(null)
  const workspaceDropCommitted = useRef(false)
  const previousOrderBy = useRef(orderBy)
  const nativeDragActive = drag !== null || workspaceDrag !== null
  useNativeDragAcceptance(nativeDragActive)
  const currentGroup = current === undefined || !workspaceReady
    ? undefined
    : owningGroupKey(workspaces, current)
  useEffect(() => {
    if (current === undefined || currentGroup === undefined || Object.hasOwn(groupExpansion, currentGroup)) return
    setGroupExpanded(currentGroup, true)
  }, [current, currentGroup, setGroupExpanded, groupExpansion])
  // One-time migration of the pre-v6 localStorage branch-collapse state into
  // the persisted store (the v6 store owns branch collapse now).
  useEffect(() => {
    if (migratedCollapsedRef.current) return
    migratedCollapsedRef.current = true
    try {
      const raw = localStorage.getItem('dsh.branch-workspace.collapsed')
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object') {
        for (const [accountKey, ids] of Object.entries(parsed)) {
          if (!Array.isArray(ids)) continue
          const valid = ids.filter((id): id is string => typeof id === 'string')
          if (valid.length === 0) continue
          if (typeof setAllBranchesCollapsed === 'function') {
            setAllBranchesCollapsed(accountKey, valid, true)
          } else if (typeof setBranchCollapsed === 'function') {
            for (const id of valid) setBranchCollapsed(accountKey, id, true)
          }
        }
      }
      localStorage.removeItem('dsh.branch-workspace.collapsed')
    } catch {
      // Ignore storage quota / privacy-mode failures.
    }
  }, [setAllBranchesCollapsed, setBranchCollapsed])
  const expandedGroups = useMemo(
    () => Object.entries(groupExpansion).filter(([, expanded]) => expanded).map(([key]) => key),
    [groupExpansion],
  )
  const ungroupedSessionIds = useMemo(() => {
    const accounted = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
    return list.ids.filter((id: SessionId) => list.byId[id] !== undefined && !accounted.has(id))
  }, [list, workspaces])
  useEffect(() => {
    if (list.phase !== 'ready') return
    const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated'
    previousOrderBy.current = orderBy
    const accounts = [
      ...workspaces.map(workspace => ({
        key: workspace.workspaceId as string,
        sessionIds: workspace.sessionIds.filter(id => list.byId[id] !== undefined),
      })),
      { key: UNGROUPED_KEY, sessionIds: ungroupedSessionIds },
    ]
    for (const { key, sessionIds } of accounts) {
      const previousOrder = sessionOrderByAccount[key]
      const previousUpdatedAt = sessionUpdatedAtByAccount[key] ?? {}
      const next = nextSessionOrderAccount({
        sessionIds,
        previousOrder,
        previousUpdatedAt,
        list,
        orderBy,
        sortByRecency: orderBy === 'updated' && (previousOrder === undefined || switchedToUpdated),
      })
      if (next.changed) {
        syncSessionOrderAccount(key, next.order.map(id => id as string), next.updatedAt)
      }
    }
  }, [list, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, ungroupedSessionIds, workspaces])
  const orderedWorkspaces = useMemo(() => {
    return workspaces.map((workspace) => {
      const stored = sessionOrderByAccount[workspace.workspaceId as string]
      const sessionIds = reconciledSessionOrder(workspace.sessionIds, stored)
      return { ...workspace, sessionIds }
    })
  }, [sessionOrderByAccount, workspaces])
  const orderedUngroupedSessionIds = useMemo(
    () => reconciledSessionOrder(ungroupedSessionIds, sessionOrderByAccount[UNGROUPED_KEY]),
    [sessionOrderByAccount, ungroupedSessionIds],
  )
  const groups = useMemo(
    () => deriveGroups(list, orderedWorkspaces, archivedSessionIds, pendingInteractions, {
      expandedGroups,
      ...(sessionOrderByAccount[UNGROUPED_KEY] === undefined
        ? {}
        : { ungroupedOrder: sessionOrderByAccount[UNGROUPED_KEY] }),
    }),
    [list, orderedWorkspaces, archivedSessionIds, pendingInteractions, expandedGroups, sessionOrderByAccount],
  )
  // Branch tree projection per expanded group: tree roots, flattened visible
  // rows (collapsed branches pruned), ancestor paths, and sibling maps.
  const collapsedByAccount = useMemo(() => {
    const map = new Map<string, Set<string>>()
    const keys = new Set([
      ...Object.keys(collapsedBranchesByAccount || {}),
      ...Object.keys(temporaryExpandedByAccount),
    ])
    for (const key of keys) {
      const collapsed = new Set((collapsedBranchesByAccount || {})[key] || [])
      const temporary = temporaryExpandedByAccount[key]
      if (temporary !== undefined) {
        for (const id of temporary) collapsed.delete(id)
      }
      map.set(key, collapsed)
    }
    return map
  }, [collapsedBranchesByAccount, temporaryExpandedByAccount])
  const collapsedFor = useCallback(
    (accountKey: string): ReadonlySet<string> => collapsedByAccount.get(accountKey) ?? EMPTY_COLLAPSED_SET,
    [collapsedByAccount],
  )
  const sessionTreeByGroup = useMemo(() => {
    const map = new Map<string, {
      sessionTree: SessionNode[]
      sessionRows: Array<{ node: SessionNode; depth: number }>
      pathByNode: Map<string, string[]>
      siblingsByNode: Map<string, SessionNode[]>
    }>()
    for (const group of groups) {
      const sessionTree = buildSessionTree(group.sessions)
      const collapsed = collapsedFor(group.key)
      const sessionRows = flattenSessionTree(sessionTree, 0, [], new Set(), collapsed)
      const pathByNode = buildPathMap(sessionTree)
      const siblingsByNode = buildSiblingsMap(sessionTree)
      map.set(group.key, { sessionTree, sessionRows, pathByNode, siblingsByNode })
    }
    return map
  }, [groups, collapsedFor])
  const visibleRowsByGroup = useMemo(() => {
    const map = new Map<string, Array<{
      accountKey: string
      node: SessionNode
      depth: number
      path: string[]
      siblings: SessionNode[]
    }>>()
    for (const [accountKey, tree] of sessionTreeByGroup) {
      const group = groups.find(candidate => candidate.key === accountKey)
      if (group === undefined) continue
      let treeRows = tree.sessionRows
      if (!expandedSessionGroups.includes(accountKey)) {
        treeRows = treeRows.slice(0, COLLAPSED_SESSION_LIMIT)
      }
      map.set(accountKey, treeRows.map(row => ({
        accountKey,
        node: row.node,
        depth: row.depth,
        path: tree.pathByNode.get(row.node.id) || [],
        siblings: tree.siblingsByNode.get(row.node.id) || [],
      })))
    }
    return map
  }, [sessionTreeByGroup, groups, expandedSessionGroups])
  // Where the current session sits (if anywhere): its account, whether its
  // row is currently visible, and the collapsed ancestor that hides it.
  const currentMarkerInfo = useMemo(() => {
    if (current === undefined) return null
    for (const group of groups) {
      if (!group.expanded) continue
      const tree = sessionTreeByGroup.get(group.key)
      if (tree === undefined) continue
      const ancestors = findSessionAncestors(tree.sessionTree, current)
      if (ancestors === null) continue
      const visibleRows = visibleRowsByGroup.get(group.key) || []
      const rowVisible = visibleRows.some(row => row.node.id === current)
      let collapsedAnchorId: string | undefined
      if (!rowVisible) {
        const visibleIds = new Set(visibleRows.map(row => row.node.id as string))
        for (let i = ancestors.length - 1; i >= 0; i--) {
          const ancestorId = ancestors[i]
          if (visibleIds.has(ancestorId)) {
            collapsedAnchorId = ancestorId
            break
          }
        }
      }
      return { accountKey: group.key, currentId: current, rowVisible, collapsedAnchorId }
    }
    return null
  }, [current, groups, sessionTreeByGroup, visibleRowsByGroup])
  // Reveal after search: expand the group and show-more so the chosen row is
  // within the rendered window (branch ancestors are handled by auto-expand).
  useEffect(() => {
    if (revealGroup === undefined || groupExpansion[revealGroup] === true) return
    setGroupExpanded(revealGroup, true)
  }, [groupExpansion, revealGroup, setGroupExpanded])
  useEffect(() => {
    if (revealSessionId === undefined || revealGroup === undefined) return
    const group = groups.find(candidate => candidate.key === revealGroup)
    if (group === undefined || !group.expanded) return
    const tree = sessionTreeByGroup.get(revealGroup)
    if (tree === undefined) return
    const rows = tree.sessionRows
    const revealIndex = rows.findIndex(row => row.node.id === revealSessionId)
    if (revealIndex >= COLLAPSED_SESSION_LIMIT && !expandedSessionGroups.includes(revealGroup)) {
      setExpandedSessionGroups(keys => [...keys, revealGroup])
    }
  }, [groups, revealGroup, revealSessionId, sessionTreeByGroup, expandedSessionGroups])
  // Keep the current row on screen: reveal a group whose current session sits
  // beyond the show-more boundary, and auto-expand collapsed branch ancestors.
  useEffect(() => {
    if (current === undefined) return
    const group = groups.find(candidate =>
      candidate.sessions.some(session => session.id === current))
    if (group === undefined || !group.expanded) return
    const tree = sessionTreeByGroup.get(group.key)
    if (tree === undefined) return
    const rows = tree.sessionRows
    const currentIndex = rows.findIndex(row => row.node.id === current)
    if (currentIndex >= COLLAPSED_SESSION_LIMIT && !expandedSessionGroups.includes(group.key)) {
      setExpandedSessionGroups(keys => [...keys, group.key])
    }
  }, [current, groups, sessionTreeByGroup, expandedSessionGroups])
  const autoExpandedCurrent = useRef<SessionId | null>(null)
  useEffect(() => {
    if (current === undefined || autoExpandedCurrent.current === current) return
    autoExpandedCurrent.current = current
    for (const [accountKey, tree] of sessionTreeByGroup) {
      const ancestors = findSessionAncestors(tree.sessionTree, current)
      if (ancestors === null) continue
      const collapsed = collapsedFor(accountKey)
      const toExpand = ancestors.filter(ancestorId => collapsed.has(ancestorId))
      if (toExpand.length > 0) {
        setTemporaryExpandedByAccount(prev => {
          const next = { ...prev }
          const set = new Set(next[accountKey] || [])
          for (const ancestorId of toExpand) set.add(ancestorId)
          next[accountKey] = Array.from(set)
          return next
        })
      }
    }
  }, [current, sessionTreeByGroup, collapsedFor])
  const toggleCollapsedSession = (accountKey: string, id: SessionNode['id']): void => {
    const collapsed = collapsedFor(accountKey)
    const next = !collapsed.has(id)
    // Manual toggles become the source of truth: remove any temporary
    // auto-expand override for this id before persisting the new state.
    setTemporaryExpandedByAccount(prev => {
      const nextState = { ...prev }
      const list = nextState[accountKey]
      if (list === undefined || list.length === 0) return nextState
      const set = new Set(list)
      set.delete(id)
      nextState[accountKey] = Array.from(set)
      return nextState
    })
    if (typeof setBranchCollapsed === 'function') {
      setBranchCollapsed(accountKey, id, next)
    }
  }
  const now = Date.now()
  const commitSessionDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (sessionDropCommitted.current) return
    sessionDropCommitted.current = true
    setDrag(null)
    const group = groups.find(candidate => candidate.key === activeDrag.accountKey)
    if (group === undefined) return
    const activeRow = visibleRowsByGroup.get(activeDrag.accountKey)
      ?.find(row => row.node.id === activeDrag.sessionId)
    const overRow = visibleRowsByGroup.get(activeDrag.accountKey)
      ?.find(row => row.node.id === over.id)
    if (!activeRow || !overRow || activeDrag.sessionId === over.id) return
    // Tree-aware drop: a session may only be reordered among its siblings
    // (same parent in the fork tree). Dropping onto a different branch or a
    // descendant is ignored instead of corrupting the flat account order.
    const siblings = activeRow.siblings || []
    if (!siblings.some(sibling => sibling.id === over.id)) {
      console.warn('[dsh-branch-workspace-folders] dropped session outside its branch parent; ignored')
      return
    }
    const accountSessionIds = activeDrag.accountKey === UNGROUPED_KEY
      ? orderedUngroupedSessionIds
      : orderedWorkspaces.find(workspace => workspace.workspaceId === activeDrag.accountKey)?.sessionIds
    if (accountSessionIds === undefined) return
    const siblingIds = new Set(siblings.map(sibling => sibling.id))
    siblingIds.add(activeDrag.sessionId)
    const siblingOrder = siblings.map(sibling => sibling.id)
    const overIndex = siblingOrder.indexOf(over.id)
    if (overIndex === -1) return
    const insertAt = over.half === 'before' ? overIndex : overIndex + 1
    siblingOrder.splice(insertAt, 0, activeDrag.sessionId)
    const currentSiblings = accountSessionIds.filter(id => siblingIds.has(id))
    if (currentSiblings.length !== siblingOrder.length) return
    if (currentSiblings.every((id, index) => id === siblingOrder[index])) return
    // Replace only the sibling subsequence inside the account's flat order.
    // Non-sibling sessions (other branches, parents) keep their slots, which
    // preserves the tree grouping while changing child order.
    const nextOrder = [...accountSessionIds]
    const positions: number[] = []
    const current: SessionId[] = []
    for (let i = 0; i < nextOrder.length; i++) {
      if (siblingIds.has(nextOrder[i])) {
        current.push(nextOrder[i])
        positions.push(i)
      }
    }
    if (current.length !== siblingOrder.length) return
    for (let i = 0; i < positions.length; i++) nextOrder[positions[i]] = siblingOrder[i]
    setSessionOrder(activeDrag.accountKey, nextOrder.map(id => id as string))
    // Updated order owns the local account order only; real Workspaces get the
    // Host call in manual order (same posture as the official renderer).
    if (orderBy === 'updated' || activeDrag.accountKey === UNGROUPED_KEY) return
    insertSessionBefore(activeDrag.accountKey as WorkspaceId, activeDrag.sessionId, over.id).catch((reason: unknown) => {
      console.warn('session reorder rejected:', reason)
    })
  }
  const commitWorkspaceDrag = (
    activeDrag: WorkspaceDragState,
    over: NonNullable<WorkspaceDragState['over']>,
  ): void => {
    if (workspaceDropCommitted.current) return
    workspaceDropCommitted.current = true
    setWorkspaceDrag(null)
    const rowIndex = workspaces.findIndex(workspace => workspace.workspaceId === over.id)
    if (rowIndex === -1) return
    const anchor = over.half === 'before' ? over.id : workspaces[rowIndex + 1]?.workspaceId
    if (anchor === activeDrag.workspaceId) return
    const sourceIndex = workspaces.findIndex(workspace => workspace.workspaceId === activeDrag.workspaceId)
    const anchorIndex = anchor === undefined
      ? workspaces.length
      : workspaces.findIndex(workspace => workspace.workspaceId === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason: unknown) => {
      console.warn('workspace reorder rejected:', reason)
    })
  }
  const jumpSibling = (dir: 'prev' | 'next', id: SessionNode['id']): void => {
    const row = Array.from(visibleRowsByGroup.values()).flat().find(candidate => candidate.node.id === id)
    if (!row || row.siblings.length < 2) return
    const index = row.siblings.findIndex(sibling => sibling.id === id)
    if (index === -1) return
    const length = row.siblings.length
    const target = dir === 'prev' ? row.siblings[(index - 1 + length) % length] : row.siblings[(index + 1) % length]
    if (target !== undefined) open(target.id)
  }
  const workspaceDropAtListStart = groups[0]?.workspaceId !== undefined
    && workspaceDrag?.over !== null
    && workspaceDrag?.over !== undefined
    && workspaceDrag.over.id === groups[0].workspaceId
    && workspaceDrag.over.half === 'before'

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      {workspaceDropAtListStart && <span className={css.listTopDropIndicator} aria-hidden="true" />}
      <div
        className={clsx(css.list, workspaceDropAtListStart && css.listTopDropActive)}
        role="tree"
        aria-label={t('section.sessions')}
      >
        {groups.length === 0 && (
          <div className={css.empty}>{t('empty.none')}</div>
        )}
        {groups.map((group) => {
          const workspaceId = group.workspaceId
          const workspaceMarker = workspaceId !== undefined
            && workspaceDrag?.over !== null
            && workspaceDrag?.over !== undefined
            && workspaceDrag.over.id === workspaceId
            ? workspaceDrag.over.half
            : null
          const workspaceDragProps = workspaceId === undefined ? undefined : {
            start: () => {
              workspaceDropCommitted.current = false
              setWorkspaceDrag({ workspaceId, over: null })
            },
            end: () => {
              if (workspaceDrag?.over !== null && workspaceDrag?.over !== undefined) {
                commitWorkspaceDrag(workspaceDrag, workspaceDrag.over)
              } else {
                setWorkspaceDrag(null)
              }
              workspaceDropCommitted.current = false
            },
          }
          const hoverWorkspace = workspaceId === undefined
            ? undefined
            : (half: 'before' | 'after') => {
              setWorkspaceDrag(active => active === null
                ? active
                : { ...active, over: { id: workspaceId, half } })
            }
          const dropWorkspace = workspaceId === undefined
            ? undefined
            : (half: 'before' | 'after') => {
              if (workspaceDrag === null) return
              commitWorkspaceDrag(workspaceDrag, { id: workspaceId, half })
            }
          const tree = sessionTreeByGroup.get(group.key)
          const treeRowCount = tree?.sessionRows.length ?? 0
          const sessionRows = visibleRowsByGroup.get(group.key) || []
          const currentMarker = currentMarkerInfo !== null && currentMarkerInfo.accountKey === group.key
            ? currentMarkerInfo
            : null
          return (
          // Group section: header row + expanded top-level session rows. The
          // inter-group breathing room is the section's own margin
          // (WorkspaceBrowser.module.css).
            <div
              key={group.key}
              className={clsx(
                css.groupSection,
                workspaceMarker === 'before' && css.workspaceDropBefore,
                workspaceMarker === 'after' && css.workspaceDropAfter,
              )}
              onDragOver={workspaceDrag === null || hoverWorkspace === undefined
                ? undefined
                : (e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  hoverWorkspace(workspaceGroupHalf(e))
                }}
              onDrop={workspaceDrag === null || dropWorkspace === undefined
                ? undefined
                : (e) => {
                  e.preventDefault()
                  dropWorkspace(workspaceGroupHalf(e))
                }}
            >
              <ProjectRowItem
                group={group}
                home={home}
                t={t}
                onToggle={() => {
                  if (group.expanded) {
                    setExpandedSessionGroups(keys => keys.filter(key => key !== group.key))
                  }
                  setGroupExpanded(group.key, !group.expanded)
                }}
                onCreate={() => {
                  if (group.workspaceId !== undefined) {
                    setGroupExpanded(group.key, true)
                    startSession(group.workspaceId)
                  }
                }}
                drag={workspaceDragProps}
                actions={group.workspaceId === undefined
                  ? undefined
                  : {
                    rename: () => {
                    /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                      if (group.workspaceId !== undefined) onRenameRequest(group.workspaceId, group.label)
                    },
                    delete: () => {
                    /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                      if (group.workspaceId !== undefined) onDeleteRequest(group.workspaceId, group.label)
                    },
                  }}
              />
              {sessionRows.map(({ node, depth, path, siblings }) => {
              // Session drag never leaves its group. Ungrouped writes only the
              // browser-local account; real Workspaces may also write Host order.
                const sameGroupDrag = drag !== null && drag.accountKey === group.key
                const isCurrent = currentMarker !== null && node.id === currentMarker.currentId
                const isCurrentCollapsedAncestor = currentMarker !== null
                  && !isCurrent
                  && currentMarker.collapsedAnchorId !== undefined
                  && node.id === currentMarker.collapsedAnchorId
                const dragProps = {
                  start: () => {
                    sessionDropCommitted.current = false
                    setDrag({ accountKey: group.key, sessionId: node.id, over: null })
                  },
                  active: sameGroupDrag,
                  marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
                  hover: (half: 'before' | 'after') => {
                  /* v8 ignore next -- narrowing guard: Rows gates hover on `active`, which is false while the drag state is null. */
                    setDrag(d => (d === null ? d : { ...d, over: { id: node.id, half } }))
                  },
                  drop: (half: 'before' | 'after') => {
                  /* v8 ignore next -- narrowing guard: Rows gates drop on `active`, which is false while the drag state is null. */
                    if (drag === null) return
                    commitSessionDrag(drag, { id: node.id, half })
                  },
                  end: () => {
                    if (drag?.over !== null && drag?.over !== undefined) commitSessionDrag(drag, drag.over)
                    else setDrag(null)
                    sessionDropCommitted.current = false
                  },
                }
                return (
                  <SessionNodeItem
                    key={node.id}
                    node={node}
                    depth={depth}
                    collapsed={collapsedFor(group.key).has(node.id)}
                    onToggleCollapse={node.children !== undefined && node.children.length > 0
                      ? (id) => toggleCollapsedSession(group.key, id)
                      : undefined}
                    isCurrent={isCurrent}
                    isCurrentCollapsedAncestor={isCurrentCollapsedAncestor}
                    path={path}
                    siblings={siblings}
                    onJumpSibling={jumpSibling}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(node.id)}
                    onToggleSelect={onToggleSelect}
                    currentId={current}
                    now={now}
                    onOpen={open}
                    onRename={onSessionRename}
                    onFork={forkSession}
                    onArchive={onSessionArchive}
                    onReveal={node.id === revealSessionId && group.key === revealGroup
                      ? () => { onSessionRevealed(node.id) }
                      : undefined}
                    drag={dragProps}
                    t={t}
                  />
                )
              })}
              {treeRowCount > COLLAPSED_SESSION_LIMIT && (
                <button
                  type="button"
                  className={css.sessionOverflowButton}
                  aria-expanded={expandedSessionGroups.includes(group.key)}
                  onClick={() => { setExpandedSessionGroups(keys => toggled(keys, group.key)) }}
                >
                  {expandedSessionGroups.includes(group.key)
                    ? t('sessions.collapse')
                    : t('sessions.expand', { n: treeRowCount - COLLAPSED_SESSION_LIMIT })}
                </button>
              )}
            </div>
          )
        })}
      </div>
      <span className={css.fade} />
    </div>
  )
}
/** The flat "In one list" body: every session is one draggable top-level row. */
function FlatList({
  useSessions, useSessionPendingInteraction, open, forkSession, onSessionRename, onSessionArchive,
  archivedSessionIds,
  orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder,
  revealSessionId, onSessionRevealed, selectionMode, selectedIds, onToggleSelect, t,
}: Pick<
  SessionTreeProps,
  | 'useSessions'
  | 'useSessionPendingInteraction'
  | 'open'
  | 'forkSession'
  | 'onSessionRename'
  | 'onSessionArchive'
  | 'archivedSessionIds'
  | 'orderBy'
  | 'sessionOrderByAccount'
  | 'sessionUpdatedAtByAccount'
  | 'syncSessionOrderAccount'
  | 'setSessionOrder'
  | 'revealSessionId'
  | 'onSessionRevealed'
  | 'selectionMode'
  | 'selectedIds'
  | 'onToggleSelect'
  | 't'
>) {
  const list = useSessions(s => s)
  const pendingInteractions = useSessionPendingInteraction(s => s)
  const baseRows = useMemo(
    () => deriveFlat(list, archivedSessionIds, pendingInteractions),
    [list, archivedSessionIds, pendingInteractions],
  )
  const sessionIds = useMemo(() => baseRows.map(row => row.id), [baseRows])
  const previousOrderBy = useRef(orderBy)
  useEffect(() => {
    if (list.phase !== 'ready') return
    const previousOrder = sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]
    const previousUpdatedAt = sessionUpdatedAtByAccount[FLAT_SESSION_ORDER_KEY] ?? {}
    const switchedToUpdated = previousOrderBy.current !== 'updated' && orderBy === 'updated'
    previousOrderBy.current = orderBy
    const next = nextSessionOrderAccount({
      sessionIds,
      previousOrder,
      previousUpdatedAt,
      list,
      orderBy,
      sortByRecency: orderBy === 'updated' && (previousOrder === undefined || switchedToUpdated),
    })
    if (next.changed) {
      syncSessionOrderAccount(FLAT_SESSION_ORDER_KEY, next.order.map(id => id as string), next.updatedAt)
    }
  }, [list, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, sessionIds, syncSessionOrderAccount])
  const rows = useMemo(() => {
    const byId = new Map(baseRows.map(row => [row.id, row]))
    return reconciledSessionOrder(sessionIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY])
      .flatMap((id) => {
        const row = byId.get(id)
        return row === undefined ? [] : [row]
      })
  }, [baseRows, sessionOrderByAccount, sessionIds])
  const [drag, setDrag] = useState<DragState | null>(null)
  const dropCommitted = useRef(false)
  useNativeDragAcceptance(drag !== null)
  const commitDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
    if (dropCommitted.current) return
    dropCommitted.current = true
    setDrag(null)
    const targetIndex = rows.findIndex(row => row.id === over.id)
    if (targetIndex === -1) return
    const anchor = over.half === 'before' ? over.id : rows[targetIndex + 1]?.id
    if (anchor === activeDrag.sessionId) return
    const sourceIndex = rows.findIndex(row => row.id === activeDrag.sessionId)
    const anchorIndex = anchor === undefined ? rows.length : rows.findIndex(row => row.id === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    const nextOrder = rows.map(row => row.id).filter(id => id !== activeDrag.sessionId)
    const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
    nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
    setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder.map(id => id as string))
  }
  const now = Date.now()
  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={clsx(css.list, css.flatList)} role="tree" aria-label={t('section.sessions')}>
        {rows.length === 0 && (
          <div className={css.empty}>{t('empty.none')}</div>
        )}
        {rows.map((node) => {
          const active = drag !== null
          return (
            <SessionNodeItem
              key={node.id}
              node={node}
              currentId={list.current}
              now={now}
              onOpen={open}
              onRename={onSessionRename}
              onFork={forkSession}
              onArchive={onSessionArchive}
              onReveal={node.id === revealSessionId
                ? () => { onSessionRevealed(node.id) }
                : undefined}
              selectionMode={selectionMode}
              selected={selectedIds.has(node.id)}
              onToggleSelect={onToggleSelect}
              flat
              drag={{
                start: () => {
                  dropCommitted.current = false
                  setDrag({ accountKey: FLAT_SESSION_ORDER_KEY, sessionId: node.id, over: null })
                },
                active,
                marker: active && drag.over?.id === node.id ? drag.over.half : null,
                hover: (half) => {
                  setDrag(current => current === null ? current : { ...current, over: { id: node.id, half } })
                },
                drop: (half) => {
                  if (drag !== null) commitDrag(drag, { id: node.id, half })
                },
                end: () => {
                  if (drag?.over !== null && drag?.over !== undefined) commitDrag(drag, drag.over)
                  else setDrag(null)
                  dropCommitted.current = false
                },
              }}
              t={t}
            />
          )
        })}
      </div>
      <span className={css.fade} />
    </div>
  )
}

interface RemoteSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly SessionSearchResultItem[]
  hasMore: boolean
}

/** Flat search body: local metadata matches plus the current Host result page. */
function SearchResults({
  useSessions,
  useSessionPendingInteraction,
  open,
  workspaces,
  archivedSessionIds,
  query,
  remote,
  resultLimit,
  t,
}: Pick<SessionTreeProps, 'useSessions' | 'useSessionPendingInteraction' | 'open' | 't'> & {
  workspaces: readonly WorkspaceView[]
  archivedSessionIds: readonly SessionNode['id'][]
  query: string
  remote: RemoteSearchState
  resultLimit: number
}) {
  const list = useSessions(s => s)
  const pendingInteractions = useSessionPendingInteraction(s => s)
  const currentRemote = remote.query === query
    ? remote
    : { query, status: 'loading' as const, items: [], hasMore: false }
  const results = useMemo(
    () => deriveSearchResults(
      list,
      workspaces,
      query,
      archivedSessionIds,
      pendingInteractions,
      currentRemote,
      resultLimit,
    ),
    [list, workspaces, query, archivedSessionIds, pendingInteractions, currentRemote, resultLimit],
  )
  const pending = currentRemote.status === 'loading'
  const failed = currentRemote.status === 'error'

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={css.list}>
        <div className={css.searchTree} role="tree" aria-label={t('search.results.aria')}>
          {results.items.map(result => (
            <SearchResultItem
              key={result.id}
              result={result}
              currentId={list.current}
              onOpen={open}
              t={t}
            />
          ))}
        </div>
        {pending && (
          <div className={css.searchStatus} role="status">{t('search.pending')}</div>
        )}
        {failed && (
          <div className={css.searchWarning} role="status">
            {t('search.unavailable')}
          </div>
        )}
        {!pending && results.items.length === 0 && (
          <div className={css.empty}>{t('search.noMatches')}</div>
        )}
        {results.hasMore && (
          <div className={css.searchStatus}>
            {t('search.hasMore', { n: resultLimit })}
          </div>
        )}
      </div>
      <span className={css.fade} />
    </div>
  )
}

/**
 * Render the browsing region.
 * @param props - composed slot props (shell owner share + store + injected actions).
 * @returns the region element tree.
 */
export function WorkspaceBrowser({
  wide,
  expandSidebar,
  useSessions,
  useSessionPendingInteraction,
  useWorkspaces,
  useStore,
  actions,
  startSession,
  open,
  renameSession,
  forkSession,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  archiveSession,
  insertSessionBefore,
  createWorkspace,
  searchSessions,
  searchResultLimit,
  useDirectoryFlow,
  useHostInfo,
  renderSlot,
  t,
}: WorkspaceBrowserProps) {
  const home = useHostInfo(info => info.home)
  const workspaces = useWorkspaces(state => state.items)
  const workspacePhase = useWorkspaces(state => state.phase)
  const workspaceStreamState = useWorkspaces(state => state.state)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  // Live occupancy of this surface's directory-flow hole (the same source the
  // flow reads): a composition without a picking affordance can add nothing.
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
  const groupBy = useStore(s => s.groupBy)
  const orderBy = useStore(s => s.orderBy)
  const groupExpansion = useStore(s => s.groupExpansion)
  const sessionOrderByAccount = useStore(s => s.sessionOrderByAccount)
  const sessionUpdatedAtByAccount = useStore(s => s.sessionUpdatedAtByAccount)
  const collapsedBranchesByAccount = useStore(s => s.collapsedBranchesByAccount) ?? {}
  const list = useSessions(s => s)
  const currentBlankSessionId = useSessions((state) => {
    const current = state.current
    return current !== undefined && state.byId[current]?.blank === true ? current : undefined
  })
  const currentBlankAccount = currentBlankSessionId === undefined
    || workspacePhase !== 'ready'
    ? undefined
    : owningGroupKey(workspaces, currentBlankSessionId)
  const promotedBlank = useRef<{ sessionId: SessionId; accountKey: string } | undefined>(undefined)
  useEffect(() => {
    if (currentBlankSessionId === undefined || currentBlankAccount === undefined) {
      promotedBlank.current = undefined
      return
    }
    const promoted = promotedBlank.current
    if (promoted !== undefined && promoted.sessionId === currentBlankSessionId
      && promoted.accountKey === currentBlankAccount) return
    promotedBlank.current = { sessionId: currentBlankSessionId, accountKey: currentBlankAccount }
    for (const accountKey of new Set([currentBlankAccount, FLAT_SESSION_ORDER_KEY])) {
      const previous = sessionOrderByAccount[accountKey] ?? []
      actions.setSessionOrder(accountKey, [
        currentBlankSessionId,
        ...previous.filter(id => id !== currentBlankSessionId),
      ])
    }
  }, [actions.setSessionOrder, currentBlankAccount, currentBlankSessionId, sessionOrderByAccount])
  useEffect(() => {
    if (workspacePhase !== 'ready') return
    actions.retainAccountKeys([
      UNGROUPED_KEY,
      FLAT_SESSION_ORDER_KEY,
      ...workspaces.map(workspace => workspace.workspaceId as string),
    ])
  }, [actions.retainAccountKeys, workspacePhase, workspaces])
  // Branch-collapse state + batch selection (feature surface owned here).
  const [globalBranchToggle, setGlobalBranchToggle] = useState<{ version: number; collapsed: boolean }>({ version: 0, collapsed: false })
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<SessionNode['id']>>(new Set())
  const allWorkspaceKeys = useMemo(
    () => [UNGROUPED_KEY, ...workspaces.map(workspace => workspace.workspaceId as string)],
    [workspaces],
  )
  const allGroupsExpanded = allWorkspaceKeys.length > 0 && allWorkspaceKeys.every(key => groupExpansion[key] === true)
  const branchIdsByAccount = useMemo(() => {
    const map = new Map<string, string[]>()
    const accounted = new Set<SessionId>()
    for (const workspace of workspaces) {
      const sessions = workspace.sessionIds
        .map(id => list.byId[id])
        .filter((session): session is NonNullable<typeof session> => session !== undefined && !session.blank)
      for (const id of workspace.sessionIds) accounted.add(id)
      map.set(workspace.workspaceId as string, collectBranchIds(sessions))
    }
    const ungroupedSessions = list.ids
      .filter(id => list.byId[id] !== undefined && !accounted.has(id))
      .map(id => list.byId[id])
      .filter((session): session is NonNullable<typeof session> => session !== undefined && !session.blank)
    map.set(UNGROUPED_KEY, collectBranchIds(ungroupedSessions))
    return map
  }, [list, workspaces])
  const storeAllBranchesCollapsed = allWorkspaceKeys.length > 0 && allWorkspaceKeys.every(key => {
    const ids = branchIdsByAccount.get(key) || []
    if (ids.length === 0) return true
    const collapsed = new Set(collapsedBranchesByAccount[key] || [])
    return ids.every(id => collapsed.has(id))
  })
  const allBranchesCollapsed = globalBranchToggle.version > 0 ? globalBranchToggle.collapsed : storeAllBranchesCollapsed
  const toggleSelect = (id: SessionNode['id']): void => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const clearSelection = (): void => {
    setSelectedIds(new Set())
    setSelectionMode(false)
  }
  const archiveSelected = (): void => {
    for (const id of selectedIds) {
      archiveSession(id).catch((reason: unknown) => {
        console.warn('session archive rejected:', reason)
      })
    }
    clearSelection()
  }
  // The query outlives the tree and the input (both wide-only) so collapsing
  // does not silently drop an in-progress filter.
  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [revealSessionId, setRevealSessionId] = useState<SessionId | undefined>(undefined)
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  const [remoteSearch, setRemoteSearch] = useState<RemoteSearchState>({
    query: '',
    status: 'idle',
    items: [],
    hasMore: false,
  })
  const searchRoot = useRef<HTMLDivElement | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  // Section-header ＋ opens the picker menu (same popover in wide and rail
  // states; the menu anchors on this button).
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const wsPlusRef = useRef<HTMLButtonElement>(null)
  const composingRef = useRef(false)

  const openSearchResult = (sessionId: SessionId): void => {
    setRevealSessionId(sessionId)
    setQuery('')
    setSearchExpanded(false)
    open(sessionId)
  }
  const acknowledgeSessionReveal = (sessionId: SessionId): void => {
    setRevealSessionId(current => current === sessionId ? undefined : current)
  }
  useEffect(() => {
    if (normalizedQuery !== '') setRevealSessionId(undefined)
  }, [normalizedQuery])

  // Rail search = expand + land in the search box: the flag arms before the
  // expand request; once the shell flips wide the input mounts and takes focus.
  const [searchOnExpand, setSearchOnExpand] = useState(false)
  useEffect(() => {
    if (wide && searchOnExpand) {
      const timer = window.setTimeout(() => {
        searchInput.current?.focus({ preventScroll: true })
        setSearchOnExpand(false)
      }, EXPAND_SLIDE_MS)
      return () => { window.clearTimeout(timer) }
    }
  }, [wide, searchOnExpand])

  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    searchInput.current?.focus({ preventScroll: true })
  }, [wide, searchExpanded, searchOnExpand])

  // Outside-click dismissal stays off while the rail gesture is in flight
  // (searchOnExpand): the rail click flips the shell wide and mounts this
  // listener during its own dispatch, then keeps bubbling to document with
  // the now-unmounted rail button as its target — outside searchRoot, so the
  // listener would dismiss the search that click just opened.
  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return
      searchInput.current?.blur()
      if (normalizedQuery !== '') return
      setSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick) }
  }, [normalizedQuery, wide, searchExpanded, searchOnExpand])

  useEffect(() => {
    if (normalizedQuery === '') {
      setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    const controller = new AbortController()
    setRemoteSearch({
      query: normalizedQuery,
      status: 'loading',
      items: [],
      hasMore: false,
    })
    const timer = window.setTimeout(() => {
      searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'ready',
          items: result.items,
          hasMore: result.hasMore,
        })
      }).catch(() => {
        if (controller.signal.aborted) return
        setRemoteSearch({
          query: normalizedQuery,
          status: 'error',
          items: [],
          hasMore: false,
        })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, searchSessions])

  // Rename dialog (browser-owned so it outlives row unmounts during collapse).
  const [renameTarget, setRenameTarget] = useState<{ workspaceId: WorkspaceId; currentTitle: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameTrimmed = renameDraft.trim()
  const renameDuplicate = renameTarget !== null && renameTrimmed !== '' && renameTrimmed !== renameTarget.currentTitle
    && workspaces.some(w => w.title === renameTrimmed)
  const renameBlocked = renaming || renameTrimmed === ''
    || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate
  const closeRename = () => {
    if (renaming) return
    setRenameTarget(null)
    setRenameError(null)
  }
  const confirmRename = () => {
    if (renameBlocked) return
    setRenaming(true)
    setRenameError(null)
    renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
      setRenaming(false)
      setRenameTarget(null)
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Session rename dialog (same browser-owned pattern as workspace rename;
  // sessions have no client-side name-conflict rule — the host normalizes).
  // Unlike workspace rename, an unchanged title is NOT blocked: confirming
  // the current automatic title is the gesture that pins it.
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{ sessionId: SessionNode['id']; currentTitle: string } | null>(null)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenaming, setSessionRenaming] = useState(false)
  const [sessionRenameError, setSessionRenameError] = useState<string | null>(null)
  const sessionRenameTrimmed = sessionRenameDraft.trim()
  const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === '' || sessionRenameTarget === null
  const closeSessionRename = () => {
    if (sessionRenaming) return
    setSessionRenameTarget(null)
    setSessionRenameError(null)
  }
  const confirmSessionRename = () => {
    if (sessionRenameBlocked) return
    setSessionRenaming(true)
    setSessionRenameError(null)
    renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
      setSessionRenaming(false)
      setSessionRenameTarget(null)
    }).catch((reason: unknown) => {
      setSessionRenaming(false)
      setSessionRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const onSessionRename = (sessionId: SessionNode['id'], currentTitle: string) => {
    setSessionRenameTarget({ sessionId, currentTitle })
    setSessionRenameDraft(currentTitle)
    setSessionRenameError(null)
  }

  // Archive is dialog-free: not destructive (the log and the accounting slot
  // remain), so the menu action commits directly; the row disappears when the
  // archive-set echo lands. Failures are non-fatal console diagnostics, the
  // same posture as reorder rejections.
  const onSessionArchive = (sessionId: SessionNode['id']) => {
    archiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session archive rejected:', reason)
    })
  }

  // Delete dialog is separate from the row so a successful removal can
  // unmount that row without tearing down the in-flight confirmation state.
  const [deleteTarget, setDeleteTarget] = useState<{ workspaceId: WorkspaceId; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteCommittedId, setDeleteCommittedId] = useState<WorkspaceId | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  useEffect(() => {
    if (deleteCommittedId === null
      || workspaces.some(workspace => workspace.workspaceId === deleteCommittedId)) return
    setDeleting(false)
    setDeleteCommittedId(null)
    setDeleteTarget(null)
  }, [deleteCommittedId, workspaces])
  const closeDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }
  const confirmDelete = () => {
    /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
    if (deleting || deleteTarget === null) return
    setDeleting(true)
    setDeleteCommittedId(null)
    setDeleteError(null)
    deleteWorkspace(deleteTarget.workspaceId).then(() => {
      // Keep the confirmation pending until this component has rendered the
      // committed list projection without the deleted id. Closing earlier
      // exposes one stale React frame to the next Create Workspace gesture.
      setDeleteCommittedId(deleteTarget.workspaceId)
    }).catch((reason: unknown) => {
      setDeleting(false)
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <div className={clsx(css.root, !wide && css.rail)}>
      <div className={css.sectionHeader}>
        {wide && (
          <span className={clsx(css.sectionLabel, css.wide, searchExpanded && css.sectionLabelHidden)}>
            {groupBy === 'flat' ? t('section.sessions') : t('section.workspaces')}
          </span>
        )}
        {wide && (
          <div className={clsx(css.searchSlot, searchExpanded && css.searchSlotExpanded)}>
            <div
              ref={searchRoot}
              className={clsx(css.search, searchExpanded && css.searchExpanded)}
              onClick={() => {
                setWsPickerOpen(false)
                setSearchExpanded(true)
                searchInput.current?.focus()
              }}
            >
              <Tooltip label={t('search')} side="bottom" delayMs={500} disabled={searchExpanded}>
                <button
                  type="button"
                  className={css.searchButton}
                  aria-label={t('search.sessions.aria')}
                  aria-expanded={searchExpanded}
                  onClick={() => {
                    setWsPickerOpen(false)
                    setSearchExpanded(true)
                  }}
                >
                  <IconSearchOutline16 size={searchExpanded ? 11 : 14} />
                </button>
              </Tooltip>
              <input
                ref={searchInput}
                className={css.searchInput}
                type="text"
                placeholder={t('search.placeholder')}
                maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
                value={query}
                tabIndex={searchExpanded ? 0 : -1}
                onChange={(e) => { setQuery(sanitizeSearchQuery(e.target.value)) }}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  setQuery('')
                  setSearchExpanded(false)
                }}
              />
              {searchExpanded && (
                <button
                  type="button"
                  className={css.clearButton}
                  aria-label={t('search.clear')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setQuery('')
                    setSearchExpanded(false)
                  }}
                >
                  <IconCloseFill14 />
                </button>
              )}
            </div>
          </div>
        )}
        <div className={clsx(css.headerActions, wide && searchExpanded && css.headerActionsHidden)}>
          {wide && selectionMode ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: 'none' }}>
              <span style={{
                fontSize: 12,
                color: 'var(--dsw-alias-label-secondary)',
                whiteSpace: 'nowrap',
              }}>
                {selectedIds.size} {uiLabel('个已选', 'selected')}
              </span>
              <Button variant="outline" disabled={selectedIds.size === 0} onClick={archiveSelected}>
                {uiLabel('批量归档', 'Archive selected')}
              </Button>
              <Button variant="outline" onClick={clearSelection}>
                {t('cancel')}
              </Button>
            </div>
          ) : (
            <>
              {wide && (
                <MoreMenu
                  onBatchSelect={() => { setSelectionMode(true) }}
                  groupBy={groupBy}
                  allGroupsExpanded={allGroupsExpanded}
                  onToggleAllGroups={() => {
                    const next = !allGroupsExpanded
                    for (const key of allWorkspaceKeys) actions.setGroupExpanded(key, next)
                  }}
                  allBranchesCollapsed={allBranchesCollapsed}
                  onToggleAllBranches={() => {
                    const next = !allBranchesCollapsed
                    setGlobalBranchToggle(v => ({ version: v.version + 1, collapsed: next }))
                    if (typeof actions.setAllBranchesCollapsed === 'function') {
                      for (const key of allWorkspaceKeys) {
                        actions.setAllBranchesCollapsed(key, branchIdsByAccount.get(key) || [], next)
                      }
                    }
                  }}
                />
              )}
              {wide && (
                <ViewOptionsMenu
                  groupBy={groupBy}
                  orderBy={orderBy}
                  onGroupPick={(mode) => { actions.setGroupBy(mode) }}
                  onOrderPick={(mode) => { actions.setOrderBy(mode) }}
                  t={t}
                />
              )}
            </>
          )}
          {/* Adding is the button's one action, so a composition with no
              picking affordance has nothing to offer here: the region hides the
              button rather than leaving a dead one in the header. */}
          {directoryFlowAvailable && (
            <Tooltip label={t('workspace.add')} side="bottom" delayMs={500}>
              <button
                ref={wsPlusRef}
                type="button"
                className={css.iconButton}
                aria-label={t('workspace.add')}
                onClick={() => {
                  setWsPickerOpen(v => !v)
                }}
              >
                <IconProjectAddOutline16 size={wide ? 16 : 18} />
              </button>
            </Tooltip>
          )}
        </div>
        {/* Add flow + its error dialog (same package — direct composition). */}
        <WorkspacePickFlow
          t={t}
          open={wsPickerOpen}
          anchorRef={wsPlusRef}
          useWorkspaces={useWorkspaces}
          createWorkspace={createWorkspace}
          useDirectoryFlow={useDirectoryFlow}
          renderDirectoryFlow={owner => renderSlot('sidebar.workspaces.directoryFlow', owner)}
          addOnly
          side="right"
          onPick={(workspaceId) => {
            setWsPickerOpen(false)
            startSession(workspaceId)
          }}
          onClose={() => { setWsPickerOpen(false) }}
        />
      </div>

      {/* The collapsed rail keeps search as its own 36px control. */}
      {!wide && <div className={css.search}>
        <Tooltip label={t('search')}>
          <button
            type="button"
            className={css.searchButton}
            aria-label={t('search.sessions.aria')}
            onClick={() => {
              setSearchExpanded(true)
              setSearchOnExpand(true)
              expandSidebar()
            }}
          >
            <IconSearchOutline16 size={18} />
          </button>
        </Tooltip>
      </div>}

      {/* Always-mounted seat keeps the region's flex slot while the list
          itself is wide-only. */}
      <div className={css.listArea}>
        {wide && (normalizedQuery !== ''
          ? (
            <SearchResults
              useSessions={useSessions}
              useSessionPendingInteraction={useSessionPendingInteraction}
              open={openSearchResult}
              workspaces={workspaces}
              archivedSessionIds={archivedSessionIds}
              query={normalizedQuery}
              remote={remoteSearch}
              resultLimit={searchResultLimit}
              t={t}
            />
          )
          : groupBy === 'flat'
            ? (
              <FlatList
                useSessions={useSessions} useSessionPendingInteraction={useSessionPendingInteraction}
                open={open} forkSession={forkSession}
                onSessionRename={onSessionRename} onSessionArchive={onSessionArchive}
                archivedSessionIds={archivedSessionIds}
                orderBy={orderBy}
                sessionOrderByAccount={sessionOrderByAccount}
                sessionUpdatedAtByAccount={sessionUpdatedAtByAccount}
                syncSessionOrderAccount={actions.syncSessionOrderAccount}
                setSessionOrder={actions.setSessionOrder}
                revealSessionId={revealSessionId}
                onSessionRevealed={acknowledgeSessionReveal}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                t={t}
              />
            )
            : (
              <SessionTree
                useSessions={useSessions}
                useSessionPendingInteraction={useSessionPendingInteraction}
                onSessionRename={onSessionRename}
                onSessionArchive={onSessionArchive}
                forkSession={forkSession}
                workspaces={workspaces}
                workspaceReady={workspacePhase === 'ready' && workspaceStreamState !== 'loading'}
                groupExpansion={groupExpansion}
                setGroupExpanded={actions.setGroupExpanded}
                sessionOrderByAccount={sessionOrderByAccount}
                sessionUpdatedAtByAccount={sessionUpdatedAtByAccount}
                syncSessionOrderAccount={actions.syncSessionOrderAccount}
                setSessionOrder={actions.setSessionOrder}
                archivedSessionIds={archivedSessionIds}
                startSession={startSession}
                open={open}
                insertWorkspaceBefore={insertWorkspaceBefore}
                insertSessionBefore={insertSessionBefore}
                orderBy={orderBy}
                revealSessionId={revealSessionId}
                onSessionRevealed={acknowledgeSessionReveal}
                collapsedBranchesByAccount={collapsedBranchesByAccount}
                setBranchCollapsed={actions.setBranchCollapsed}
                setAllBranchesCollapsed={actions.setAllBranchesCollapsed}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                home={home}
                t={t}
                onRenameRequest={(workspaceId, currentTitle) => {
                  setRenameTarget({ workspaceId, currentTitle })
                  setRenameDraft(currentTitle)
                  setRenameError(null)
                }}
                onDeleteRequest={(workspaceId, title) => {
                  setDeleteTarget({ workspaceId, title })
                  setDeleteError(null)
                }}
              />
            ))}
      </div>

      <Modal
        open={renameTarget !== null}
        onClose={closeRename}
        closeLabel={t('close')}
        title={t('rename.workspace.title')}
        footer={(
          <>
            <Button variant="outline" disabled={renaming} onClick={closeRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={renameDraft}
          aria-label={t('field.workspaceName')}
          autoFocus
          disabled={renaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setRenameDraft(e.target.value); setRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmRename()
            }
          }}
        />
        {renameDuplicate && (
          <div className={css.renameError} role="alert">{t('conflict.named', { name: renameTrimmed })}</div>
        )}
        {renameError !== null && <div className={css.renameError} role="alert">{renameError}</div>}
      </Modal>

      <Modal
        open={sessionRenameTarget !== null}
        onClose={closeSessionRename}
        closeLabel={t('close')}
        title={t('rename.session.title')}
        footer={(
          <>
            <Button variant="outline" disabled={sessionRenaming} onClick={closeSessionRename}>{t('cancel')}</Button>
            <Button variant="primary" disabled={sessionRenameBlocked} onClick={confirmSessionRename}>{t('rename')}</Button>
          </>
        )}
      >
        <input
          className={css.renameInput}
          value={sessionRenameDraft}
          aria-label={t('field.sessionName')}
          autoFocus
          disabled={sessionRenaming}
          onFocus={(e) => { e.target.select() }}
          onChange={(e) => { setSessionRenameDraft(e.target.value); setSessionRenameError(null) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current) {
              e.preventDefault()
              confirmSessionRename()
            }
          }}
        />
        {sessionRenameError !== null && <div className={css.renameError} role="alert">{sessionRenameError}</div>}
      </Modal>
      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        closeLabel={t('close')}
        title={t('delete.workspace')}
        {...deleteTarget === null
          ? {}
          : { description: t('delete.desc', { name: deleteTarget.title }) }}
        footer={(
          <>
            <Button variant="outline" disabled={deleting} onClick={closeDelete}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={css.deleteAction}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {t('delete.workspace')}
            </Button>
          </>
        )}
      >
        {deleting && <div className={css.deleteStatus} role="status">{t('delete.pending')}</div>}
        {deleteError !== null && <div className={css.renameError} role="alert">{deleteError}</div>}
      </Modal>
    </div>
  )
}
