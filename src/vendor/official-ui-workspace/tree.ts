/**
 * Derives the workspace browser tree from caller-projected Workspace and
 * Session order. Unassigned Sessions trail under Ungrouped; only the selected
 * blank Session remains visible.
 */
import {
  type SessionListState,
  type SessionSearchResultItem,
  type SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'

/** Group key for Sessions outside every Workspace. */
export const UNGROUPED_KEY = ''

/**
 * Resolve the Workspace browser group that owns one Session.
 * @param workspaces - authoritative Workspace membership.
 * @param sessionId - Session whose browser group is required.
 * @returns owning Workspace id, or {@link UNGROUPED_KEY} when no Workspace accounts for it.
 */
export function owningGroupKey(
  workspaces: readonly WorkspaceView[],
  sessionId: SessionId,
): string {
  return (workspaces.find((workspace) => workspace.sessionIds.includes(sessionId))
    ?.workspaceId as string | undefined) ?? UNGROUPED_KEY
}

/** Pending interaction kinds with dedicated Workspace-row presentation. */
export type SessionPendingInteractionStatus = 'approval' | 'plan-review' | 'question'
export type SessionStatuses = any

/** One top-level session row in a group or the flat list. */
export interface SessionNode {
  id: SessionId
  /** Stored display title; the renderer substitutes the localized New Session label for blank rows. */
  title: string
  /** The provisional blank session (renderer shows the localized New Session title). */
  blank: boolean
  /** A Session-scoped UI consumer is awaiting this user. */
  pendingInteraction?: SessionPendingInteractionStatus
  running: boolean
  /** Running direct children in the loaded subagent catalog. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  /** The current list projection contains at least one active Schedule record. */
  hasActiveSchedule: boolean
  /** In the registry-global pin set: leads its section, reorderable only among pinned rows. */
  pinned: boolean
  /** In the registry-global archive set: shown grayed in place and not openable. */
  archived: boolean
  updatedAt: number
  /** Fork-tree parent (absent for top-level rows). */
  parentId?: SessionId
  /** Fork-tree children; empty for leaf rows (derived by the renderer). */
  children?: SessionNode[]
  /** Parent session is not part of this group (rendered as a root). */
  orphan?: boolean
  /** Fork-tree cycle detected (rendered as a root). */
  cycle?: boolean
}

/** Session order selected by the Workspace browser. */
export type SessionOrderBy = 'manual' | 'updated'

/** One workspace group section: header row facts + visible top-level session rows. */
export interface GroupNode {
  /** Group key: the workspace id or {@link UNGROUPED_KEY}. */
  key: string
  /** Backing Workspace id; absent only for the ungrouped bucket. */
  workspaceId: WorkspaceId | undefined
  cwd: string | undefined
  /** Workspace creation time (epoch ms); absent only for the ungrouped bucket. */
  createdAt: number | undefined
  label: string
  /** Total visible sessions in the group. */
  sessionCount: number
  expanded: boolean
  /** The group contains the selected session (active folder tint; supplied here so the renderer never scans). */
  containsCurrent: boolean
  /** Visible session rows (empty while the group is folded). */
  sessions: readonly SessionNode[]
}

/** One flat search row combining list metadata with an optional content match. */
export interface SearchResultNode {
  id: SessionId
  title: string
  workspace: string
  /** A Session-scoped UI consumer is awaiting this user. */
  pendingInteraction?: SessionPendingInteractionStatus
  running: boolean
  /** Running direct children in the loaded subagent catalog. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  /** The current list projection contains at least one active Schedule record. */
  hasActiveSchedule: boolean
  /** In the registry-global archive set: shown grayed and not openable. */
  archived: boolean
  snippet?: string
}

/** Bounded merged search projection plus the refine-query hint bit. */
export interface SearchResultSet {
  items: readonly SearchResultNode[]
  hasMore: boolean
}

/** Viewing state consumed by the derivation. */
export interface TreeView {
  expandedGroups: readonly string[]
  /** Browser-local order for Sessions without a backing Workspace account. */
  ungroupedOrder?: readonly string[]
}

/**
 * Directory display label: basename of the path (both separators accepted).
 * Ungrouped-bucket fallback for surfaces without a workspace title.
 */
export function workspaceLabel(cwd: string | undefined): string {
  return cwd === undefined ? '' : workspaceTitleOf(cwd)
}

/**
 * Project known account members by current Session recency.
 */
export function orderByRecency(
  sessionIds: readonly SessionId[],
  summaries: SessionListState['byId'],
): SessionId[] {
  return [...sessionIds]
    .filter((id) => summaries[id] !== undefined)
    .sort(
      (a, b) =>
        (summaries[b]?.updatedAt ?? 0) - (summaries[a]?.updatedAt ?? 0) ||
        String(b).localeCompare(String(a)),
    )
}

/**
 * Reconcile a browser-local manual order with current account membership.
 */
export function reconcileManualOrder(
  memberIds: readonly SessionId[],
  savedOrder: readonly string[] | undefined,
  summaries: SessionListState['byId'],
  rowState?: Pick<SessionRowState, 'pinnedSessionIds' | 'archivedSessionIds'>,
): SessionId[] {
  const members = new Map(memberIds.map((id) => [id, id]))
  const included = new Set<string>()
  const ordered: SessionId[] = []
  for (const key of savedOrder ?? []) {
    const id = members.get(key as SessionId)
    if (id === undefined || included.has(key)) continue
    ordered.push(id)
    included.add(key)
  }
  const archived = new Set(rowState?.archivedSessionIds)
  const pins: SessionId[] = []
  for (const sessionId of rowState?.pinnedSessionIds ?? []) {
    const id = members.get(sessionId)
    if (id === undefined || included.has(id) || archived.has(id) || summaries[id] === undefined) continue
    pins.push(id)
    included.add(id)
  }
  const ordinary: SessionId[] = []
  const archives: SessionId[] = []
  for (const id of orderByRecency([...members.values()].filter((id) => !included.has(id)), summaries)) {
    if (archived.has(id)) archives.push(id)
    else ordinary.push(id)
  }
  const result: SessionId[] = [
    ...pins,
    ...ordered,
    ...ordinary,
    ...archives,
  ]
  const pending = new Set(ordinary)
  for (const id of [...ordinary].reverse()) {
    if (!pending.has(id)) continue
    const chain: SessionId[] = []
    let curr: SessionId | undefined = id
    const seen = new Set<SessionId>()
    while (curr !== undefined && pending.has(curr) && !seen.has(curr)) {
      seen.add(curr)
      chain.push(curr)
      const parentId = summaries[curr]?.parentId as SessionId | undefined
      if (parentId === undefined || parentId === curr || !result.includes(parentId)) {
        break
      }
      curr = parentId
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const nodeId = chain[i]
      if (!pending.delete(nodeId)) continue
      const parentId = summaries[nodeId]?.parentId as SessionId | undefined
      if (parentId === undefined || parentId === nodeId) continue
      const pIdx = result.indexOf(parentId)
      if (pIdx === -1) continue
      const curIdx = result.indexOf(nodeId)
      if (curIdx === -1) continue
      result.splice(curIdx, 1)
      const targetIdx = result.indexOf(parentId)
      result.splice(targetIdx, 0, nodeId)
    }
  }
  return result
}

/**
 * Keep the selected provisional New Session ahead of either base order.
 */
export function pinCurrentBlank(
  order: readonly SessionId[],
  currentBlank: SessionId | undefined,
): SessionId[] {
  if (currentBlank === undefined) return [...order]
  return [currentBlank, ...order.filter((id) => id !== currentBlank)]
}

/**
 * Archived-row visibility choice: the default hides archived rows, `show`
 * mixes them into their kept slots, and `only` restricts the view (and
 * search) to archived rows.
 */
export type ArchivedFilter = 'default' | 'show' | 'only'

/** Registry-global row state consumed by every tree derivation. */
export interface SessionRowState {
  /** Registry-global pin ids; pinned rows lead their section in the local order. */
  pinnedSessionIds: readonly SessionId[]
  /** Archive set; members keep their slots and show grayed while visible. */
  archivedSessionIds: readonly SessionId[]
  /** Archived-row visibility choice applied to lists and search alike. */
  archivedFilter: ArchivedFilter
}

function sessionVisible(
  session: SessionSummary,
  current: SessionId | undefined,
  archived: ReadonlySet<string>,
  archivedFilter: ArchivedFilter,
): boolean {
  if (session.origin === 'subagent') return false
  if (session.blank && session.id !== current) return false
  switch (archivedFilter) {
    case 'default':
      return !archived.has(session.id)
    case 'show':
      return true
    case 'only':
      return archived.has(session.id)
    default:
      return !archived.has(session.id)
  }
}

function sectionMembers(
  members: readonly SessionSummary[],
  pinned: ReadonlySet<string>,
  archived: ReadonlySet<string>,
): SessionSummary[] {
  const placeholders: SessionSummary[] = []
  const leading: SessionSummary[] = []
  const rest: SessionSummary[] = []
  for (const member of members) {
    if (member.blank) placeholders.push(member)
    else if (!archived.has(member.id) && pinned.has(member.id)) leading.push(member)
    else rest.push(member)
  }
  return [...placeholders, ...leading, ...rest]
}

function sessionTitle(session: SessionSummary): string {
  return session.blank ? '' : session.displayTitle
}

function hasActiveSchedule(session: SessionSummary): boolean {
  return ((session as any).projectionValues?.schedule?.length ?? 0) > 0
}

function visiblePendingKind(kind: string | undefined): SessionPendingInteractionStatus | undefined {
  switch (kind) {
    case 'approval':
    case 'plan-review':
    case 'question':
      return kind
    default:
      return undefined
  }
}

function runningChildCount(
  list: SessionListState,
  parentId: string,
  statuses: SessionStatuses,
): number {
  return (
    (list as any).projectionsBySession?.[parentId]?.values?.subagentCatalog?.reduce(
      (count: number, child: any) =>
        count +
        (((statuses as any)?.get?.(child.id)?.running ??
          list.byId[child.id]?.running) === true
          ? 1
          : 0),
      0,
    ) ?? 0
  )
}

function resolveParentSessionId(s: any): SessionId | undefined {
  const pid = s?.parentSessionId ?? s?.parentId ?? s?.parentSession
  return pid ? (String(pid) as SessionId) : undefined
}

function sessionNode(
  s: SessionSummary,
  list: SessionListState,
  statuses: SessionStatuses,
  pinned: ReadonlySet<string>,
  archived: ReadonlySet<string>,
): SessionNode {
  const status = (statuses as any)?.get?.(s.id)
  const pendingInteraction = visiblePendingKind(status?.pendingInteraction?.kind)
  return {
    id: s.id,
    title: sessionTitle(s),
    blank: s.blank,
    running: status?.running ?? s.running,
    runningSubagentCount: runningChildCount(list, String(s.id), statuses),
    completed: status?.completionUnread === true,
    hasActiveSchedule: hasActiveSchedule(s),
    pinned: !archived.has(s.id) && pinned.has(s.id),
    archived: archived.has(s.id),
    updatedAt: s.updatedAt,
    parentId: resolveParentSessionId(s),
    ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
  }
}

function buildGroup(
  key: string,
  workspaceId: WorkspaceId | undefined,
  cwd: string | undefined,
  createdAt: number | undefined,
  label: string,
  members: SessionSummary[],
): {
  key: string
  workspaceId: WorkspaceId | undefined
  cwd: string | undefined
  createdAt: number | undefined
  label: string
  sessions: SessionSummary[]
} {
  return {
    key,
    workspaceId,
    cwd,
    createdAt,
    label,
    sessions: [...members],
  }
}

function orderedUngrouped(
  members: SessionSummary[],
  stored: readonly string[] | undefined,
  summaries: SessionListState['byId'],
): SessionSummary[] {
  const byId = new Map(members.map((session) => [session.id, session]))
  return (
    stored === undefined
      ? orderByRecency(
          members.map((s) => s.id),
          summaries,
        )
      : reconcileManualOrder(
          members.map((s) => s.id),
          stored,
          summaries,
        )
  ).flatMap((id) => {
    const session = byId.get(id)
    return session === undefined ? [] : [session]
  })
}

function mainSessionId(list: SessionListState): SessionId | undefined {
  return Object.values(list.byId).find(
    (session: any) => (session.retainedBy?.mainView ?? 0) > 0,
  )?.id
}

function groupByWorkspace(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archived: ReadonlySet<string>,
  archivedFilter: ArchivedFilter,
  ungroupedOrder?: readonly string[],
) {
  const current = mainSessionId(list)
  const groups: ReturnType<typeof buildGroup>[] = []
  const accounted = new Set<string>()
  for (const workspace of workspaces) {
    const members: SessionSummary[] = []
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined) continue
      accounted.add(String(id))
      if (!sessionVisible(summary, current, archived, archivedFilter)) continue
      members.push(summary)
    }
    groups.push(
      buildGroup(
        workspace.workspaceId,
        workspace.workspaceId,
        workspace.path,
        Date.parse(workspace.createdAt),
        workspace.title,
        members,
      ),
    )
  }
  const stray = list.ids
    .map((id) => list.byId[id])
    .filter(
      (s): s is SessionSummary =>
        s !== undefined &&
        !accounted.has(String(s.id)) &&
        sessionVisible(s, current, archived, archivedFilter),
    )
  if (stray.length > 0) {
    groups.push(
      buildGroup(
        '',
        undefined,
        undefined,
        undefined,
        '',
        orderedUngrouped(stray, ungroupedOrder, list.byId),
      ),
    )
  }
  return groups
}

/**
 * Derive the workspace browser groups with every session as a top-level row.
 */
export function deriveGroups(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  rowState: SessionRowState,
  statuses: SessionStatuses,
  view: TreeView,
): GroupNode[] {
  const archived = new Set(rowState.archivedSessionIds.map(String))
  const pinned = new Set(rowState.pinnedSessionIds.map(String))
  const expandedGroups = new Set(view.expandedGroups)
  const current = mainSessionId(list)
  const currentGroup = current === undefined ? undefined : owningGroupKey(workspaces, current)
  const groups: GroupNode[] = []
  for (const g of groupByWorkspace(
    list,
    workspaces,
    archived,
    rowState.archivedFilter,
    view.ungroupedOrder,
  )) {
    const expanded = expandedGroups.has(g.key)
    groups.push({
      key: g.key,
      workspaceId: g.workspaceId,
      cwd: g.cwd,
      createdAt: g.createdAt,
      label: g.label,
      sessionCount: g.sessions.length,
      expanded,
      containsCurrent: g.key === currentGroup,
      sessions: expanded
        ? sectionMembers(g.sessions, pinned, archived).map((session) =>
            sessionNode(session, list, statuses, pinned, archived),
          )
        : [],
    })
  }
  return groups
}

/**
 * Select complete flat-list membership, independently of archive visibility.
 */
export function sessionMemberIds(list: SessionListState): SessionId[] {
  return visibleSessionIds(list, [], 'show')
}

/**
 * Select visible flat-list members without deriving row presentation or ordering.
 */
export function visibleSessionIds(
  list: SessionListState,
  archivedSessionIds: readonly SessionId[],
  archivedFilter: ArchivedFilter,
): SessionId[] {
  const archived = new Set(archivedSessionIds.map(String))
  const current = mainSessionId(list)
  return list.ids.filter((id) => {
    const s = list.byId[id]
    return s !== undefined && sessionVisible(s, current, archived, archivedFilter)
  })
}

/**
 * Derive flat rows from the browser's complete ordered Session ids.
 */
export function deriveFlat(
  list: SessionListState,
  sessionIds: readonly SessionId[],
  rowState: SessionRowState,
  statuses: SessionStatuses,
): SessionNode[] {
  const byId = list.byId
  const archived = new Set(rowState.archivedSessionIds.map(String))
  const pinned = new Set(rowState.pinnedSessionIds.map(String))
  const current = mainSessionId(list)
  const members = sessionIds.flatMap((id) => {
    const session = byId[id]
    return session !== undefined &&
      sessionVisible(session, current, archived, rowState.archivedFilter)
      ? [session]
      : []
  })
  return sectionMembers(members, pinned, archived).map((session) =>
    sessionNode(session, list, statuses, pinned, archived),
  )
}

/**
 * Merge immediate title/Workspace substring matches with ranked Host content matches.
 */
export function deriveSearchResults(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  query: string,
  archivedSessionIds: readonly SessionId[],
  archivedFilter: ArchivedFilter,
  statuses: SessionStatuses,
  content: {
    items: readonly SessionSearchResultItem[]
    hasMore: boolean
  },
  limit: number,
): SearchResultSet {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return { items: [], hasMore: false }
  const archived = new Set(archivedSessionIds.map(String))
  const current = mainSessionId(list)
  const results: SearchResultNode[] = []
  const seen = new Set<string>()

  const include = (
    summary: SessionSummary,
    snippet?: string,
  ): boolean => {
    if (seen.has(String(summary.id))) return false
    seen.add(String(summary.id))
    const status = (statuses as any)?.get?.(summary.id)
    const ws = workspaces.find((w) => w.sessionIds.includes(summary.id))
    results.push({
      id: summary.id,
      title: summary.displayTitle || String(summary.id),
      workspace: ws?.title || '',
      running: status?.running ?? summary.running,
      runningSubagentCount: runningChildCount(list, String(summary.id), statuses),
      completed: status?.completionUnread === true,
      hasActiveSchedule: hasActiveSchedule(summary),
      archived: archived.has(String(summary.id)),
      pendingInteraction: visiblePendingKind(status?.pendingInteraction?.kind),
      snippet,
    })
    return results.length >= limit
  }

  // 1. Content search matches
  for (const item of content.items) {
    const summary = list.byId[item.sessionId as SessionId]
    if (
      summary === undefined ||
      summary.blank ||
      !sessionVisible(summary, current, archived, archivedFilter)
    ) {
      continue
    }
    if (include(summary, item.snippet)) {
      return { items: results, hasMore: true }
    }
  }

  // 2. Metadata matches
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (
      summary !== undefined &&
      !summary.blank &&
      sessionVisible(summary, current, archived, archivedFilter)
    ) {
      const titleMatch = summary.displayTitle.toLowerCase().includes(normalized)
      const ws = workspaces.find((w) => w.sessionIds.includes(summary.id))
      const wsMatch = ws?.title?.toLowerCase().includes(normalized)
      if (titleMatch || wsMatch) {
        if (include(summary)) {
          return { items: results, hasMore: content.hasMore }
        }
      }
    }
  }

  return { items: results, hasMore: content.hasMore }
}

/**
 * Find the nearest registered ancestor, excluding the Workspace directory itself.
 */
export function owningParentFolder(path: string, parents: readonly string[]): string | undefined {
  let best: string | undefined
  const norm = (p: string) => (p.endsWith('/') ? p.slice(0, -1) : p)
  const target = norm(path)
  for (const p of parents) {
    const parentNorm = norm(p)
    if (target !== parentNorm && target.startsWith(parentNorm + '/')) {
      if (best === undefined || parentNorm.length > best.length) {
        best = parentNorm
      }
    }
  }
  return best
}
