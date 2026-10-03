/**
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + view options + add
 * workspace), search, the grouped tree or flat list, and the workspace
 * dialogs. Fully upgraded to DSH 0.1.7-rc.1 baseline and enriched with
 * universal fork-tree capabilities across all grouping modes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button,
  IconArchiveCheckOutlineRegular,
  IconArchiveOutlineRegular,
  IconBranchOutlineRegular,
  IconChevronsUpDownOutlineRegular,
  IconClockOutlineRegular,
  IconCloseFillRegular,
  IconFlatListOutlineRegular,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
  IconPersonalizationOutlineRegular,
  IconProjectAddOutlineRegular,
  IconSearchOutlineRegular,
  IconWorkspaceTreeOutlineRegular,
  Menu,
  Modal,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { GroupNode, SearchResultNode, SessionNode, SessionOrderBy, SessionRowState } from '../tree.ts'
import {
  deriveFlat,
  deriveGroups,
  deriveSearchResults,
  owningGroupKey,
  owningParentFolder,
  pinCurrentBlank,
  reconcileManualOrder,
  orderByRecency,
  sessionMemberIds,
  UNGROUPED_KEY,
  type ArchivedFilter,
} from '../tree.ts'
import {
  ProjectRowItem,
  SearchResultItem,
  SessionNodeItem,
  rowHalf,
} from './Rows.tsx'
import {
  buildPathMap,
  buildSessionTree,
  collectBranchIds,
  findSessionAncestors,
  flattenSessionTree,
} from '../branch.ts'
import { uiLabel } from '../ui-label.ts'
import { FLAT_SESSION_ORDER_KEY, type SessionGroupBy } from '../stores.ts'
import { WorkspacePickFlow } from '../WorkspacePicker.tsx'
import css from './WorkspaceBrowser.module.css'

const EXPAND_SLIDE_MS = 300
const SEARCH_DEBOUNCE_MS = 250
const SEARCH_QUERY_MAX_CODE_UNITS = 500
const COLLAPSED_SESSION_LIMIT = 5

function collapsedSessionRows(
  sessions: readonly SessionNode[],
  limit = COLLAPSED_SESSION_LIMIT,
): {
  rows: readonly SessionNode[]
  hiddenCount: number
} {
  let idleCount = 0
  const rows = sessions.filter((session) => {
    if (session.blank || session.running || session.runningSubagentCount > 0) return true
    if (idleCount >= limit) return false
    idleCount += 1
    return true
  })
  return { rows, hiddenCount: Math.max(0, sessions.length - rows.length) }
}

function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--
  return withoutNul.slice(0, end)
}

function useNativeDragAcceptance(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const acceptDrag = (event: DragEvent): void => {
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    }
    const acceptDrop = (event: DragEvent): void => {
      event.preventDefault()
    }
    document.addEventListener('dragover', acceptDrag)
    document.addEventListener('drop', acceptDrop)
    return () => {
      document.removeEventListener('dragover', acceptDrag)
      document.removeEventListener('drop', acceptDrop)
    }
  }, [active])
}

function workspaceGroupHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function sessionDragOrder(
  accountSessionIds: readonly string[],
  renderedSessions: readonly SessionNode[],
  activeDrag: { sessionId: string; pinned: boolean },
  over: { id: string; half: 'before' | 'after' },
): string[] | undefined {
  const targetIndex = renderedSessions.findIndex((s) => s.id === over.id)
  if (targetIndex === -1) return undefined
  const anchor = over.half === 'before' ? over.id : renderedSessions[targetIndex + 1]?.id
  if (anchor === activeDrag.sessionId) return undefined
  const sourceIndex = accountSessionIds.indexOf(activeDrag.sessionId)
  const anchorIndex = anchor === undefined ? accountSessionIds.length : accountSessionIds.indexOf(anchor)
  if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return undefined
  const next = accountSessionIds.filter((id) => id !== activeDrag.sessionId)
  const insertAt = anchor === undefined ? next.length : next.indexOf(anchor)
  next.splice(insertAt === -1 ? next.length : insertAt, 0, activeDrag.sessionId)
  return next
}

/**
 * ViewOptionsMenu: clean native options menu with branch expand/collapse additions.
 */
function ViewOptionsMenu({
  groupBy,
  orderBy,
  archivedFilter,
  onGroupPick,
  onOrderPick,
  onArchivedFilterPick,
  onExpandAllBranches,
  onCollapseAllBranches,
  t,
}: {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  archivedFilter: ArchivedFilter
  onGroupPick: (mode: SessionGroupBy) => void
  onOrderPick: (mode: SessionOrderBy) => void
  onArchivedFilterPick: (filter: ArchivedFilter) => void
  onExpandAllBranches: () => void
  onCollapseAllBranches: () => void
  t: WorkspaceBrowserProps['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => {
        setOpen(false)
      }}
      items={[
        { type: 'label', id: 'group-by', text: t('groupBy.label') },
        {
          id: 'workspace',
          label: t('groupBy.workspace'),
          icon: <IconFolderCloseRegular />,
        },
        {
          id: 'workspace-tree',
          label: uiLabel('工作区目录树', 'Workspace Tree'),
          icon: <IconWorkspaceTreeOutlineRegular />,
        },
        {
          id: 'flat',
          label: t('groupBy.flat'),
          icon: <IconFlatListOutlineRegular />,
        },
        { type: 'separator', id: 'order-by-separator' },
        { type: 'label', id: 'order-by', text: t('orderBy.label') },
        {
          id: 'manual',
          label: t('orderBy.manual'),
          icon: <IconChevronsUpDownOutlineRegular />,
        },
        {
          id: 'updated',
          label: t('orderBy.updated'),
          icon: <IconClockOutlineRegular />,
        },
        { type: 'separator', id: 'archived-filter-separator' },
        { type: 'label', id: 'filter-by', text: uiLabel('筛选会话', 'Filter') },
        {
          id: 'show-archived',
          label: uiLabel('显示已归档会话', 'Show archived sessions'),
          icon: <IconArchiveOutlineRegular />,
        },
        {
          id: 'only-archived',
          label: uiLabel('仅显示已归档会话', 'Only archived sessions'),
          icon: <IconArchiveCheckOutlineRegular />,
        },
        { type: 'separator', id: 'branch-control-separator' },
        { type: 'label', id: 'branch-control', text: uiLabel('分支树控制', 'Branch Controls') },
        {
          id: 'expand-all-branches',
          label: uiLabel('全部展开分支', 'Expand all branches'),
          icon: <IconBranchOutlineRegular size={13} />,
        },
        {
          id: 'collapse-all-branches',
          label: uiLabel('全部折叠分支', 'Collapse all branches'),
          icon: <IconBranchOutlineRegular size={13} />,
        },
      ]}
      selectedIds={[
        groupBy,
        orderBy,
        ...(archivedFilter === 'show' ? ['show-archived'] : []),
        ...(archivedFilter === 'only' ? ['only-archived'] : []),
      ]}
      onSelect={(id) => {
        if (id === 'workspace' || id === 'workspace-tree' || id === 'flat') onGroupPick(id)
        else if (id === 'manual' || id === 'updated') onOrderPick(id)
        else if (id === 'show-archived') onArchivedFilterPick(archivedFilter === 'show' ? 'default' : 'show')
        else if (id === 'only-archived') onArchivedFilterPick(archivedFilter === 'only' ? 'default' : 'only')
        else if (id === 'expand-all-branches') onExpandAllBranches()
        else if (id === 'collapse-all-branches') onCollapseAllBranches()
        setOpen(false)
      }}
      align="end"
      dense
      className={css.viewOptionsMenu}
      portal
      anchor={
        <Tooltip label={t('viewOptions.label')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('viewOptions.label')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => {
              setOpen((v) => !v)
            }}
          >
            <IconPersonalizationOutlineRegular />
          </button>
        </Tooltip>
      }
    />
  )
}

/**
 * FlatList with full fork-tree hierarchical projection.
 */
function FlatList({
  list,
  sessionIds,
  rowState,
  useSessionStatus,
  open,
  onSessionRenameRequest,
  renderSlot,
  usePanelInfo,
  setSessionOrder,
  workspaceReady,
  revealSessionId,
  onSessionRevealed,
  collapsedBranches,
  onToggleBranchCollapse,
  t,
}: {
  list: SessionListState
  sessionIds: readonly SessionId[]
  rowState: SessionRowState
  useSessionStatus?: any
  open: (sessionId: SessionId) => void
  onSessionRenameRequest: (id: SessionId, currentTitle: string) => void
  renderSlot?: any
  usePanelInfo?: any
  setSessionOrder: (accountKey: string, order: readonly string[]) => void
  workspaceReady: boolean
  revealSessionId?: string | undefined
  onSessionRevealed: (id: string) => void
  collapsedBranches: ReadonlySet<string>
  onToggleBranchCollapse: (sessionId: SessionId) => void
  t: WorkspaceBrowserProps['t']
}) {
  const panelActive = typeof usePanelInfo === 'function' ? usePanelInfo((info: any) => info.activePanelId !== null) : false
  const statuses = typeof useSessionStatus === 'function' ? useSessionStatus((s: any) => s) : new Map()
  const currentId = panelActive
    ? undefined
    : (Object.values(list.byId).find((session: any) => (session.retainedBy?.mainView ?? 0) > 0)?.id as SessionId | undefined)

  const rawRows = useMemo(
    () => deriveFlat(list, sessionIds, rowState, statuses),
    [list, sessionIds, rowState, statuses],
  )

  const lookupParent = useCallback((id: string) => (list.byId as any)[id]?.parentId, [list.byId])
  const sessionTree = useMemo(
    () => buildSessionTree(rawRows, { lookupParent }),
    [rawRows, lookupParent],
  )
  const flatRows = useMemo(
    () => flattenSessionTree(sessionTree, 0, [], new Set(), collapsedBranches),
    [sessionTree, collapsedBranches],
  )
  const pathByNode = useMemo(() => buildPathMap(sessionTree), [sessionTree])

  const [drag, setDrag] = useState<{
    accountKey: string
    sessionId: string
    pinned: boolean
    over: { id: string; half: 'before' | 'after' } | null
  } | null>(null)
  const dropCommitted = useRef(false)
  useNativeDragAcceptance(drag !== null)

  const commitDrag = (
    activeDrag: NonNullable<typeof drag>,
    over: { id: string; half: 'before' | 'after' },
  ) => {
    if (dropCommitted.current) return
    dropCommitted.current = true
    setDrag(null)
    const nextOrder = sessionDragOrder(
      sessionIds.map(String),
      flatRows.map((r) => r.node),
      activeDrag,
      over,
    )
    if (nextOrder !== undefined) setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder)
  }

  const now = Date.now()
  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={clsx(css.list, css.flatList)} role="tree" aria-label={t('section.sessions')}>
        {flatRows.length === 0 && <div className={css.empty}>{t('empty.none')}</div>}
        {flatRows.map(({ node, depth }) => {
          const active = drag !== null && drag.pinned === node.pinned
          const normalizeHalf = (half: 'before' | 'after') => (node.blank ? 'after' : half)
          const isCollapsed = collapsedBranches.has(String(node.id))
          const ancestors = currentId ? findSessionAncestors(sessionTree, currentId) : null
          const isCurrentCollapsedAncestor = isCollapsed && ancestors !== null && ancestors.includes(node.id)

          return (
            <SessionNodeItem
              key={node.id}
              node={node}
              depth={depth}
              collapsed={isCollapsed}
              onToggleCollapse={(id) => onToggleBranchCollapse(id as SessionId)}
              path={pathByNode.get(node.id) || []}
              currentId={currentId}
              isCurrentCollapsedAncestor={isCurrentCollapsedAncestor}
              now={now}
              onOpen={(id) => open(id as SessionId)}
              onRenameRequest={(id, title) => onSessionRenameRequest(id as SessionId, title)}
              renderSlot={renderSlot}
              onReveal={
                node.id === revealSessionId
                  ? () => {
                      onSessionRevealed(node.id)
                    }
                  : undefined
              }
              flat
              drag={{
                start: () => {
                  dropCommitted.current = false
                  setDrag({
                    accountKey: FLAT_SESSION_ORDER_KEY,
                    sessionId: node.id,
                    pinned: node.pinned,
                    over: null,
                  })
                },
                active,
                marker: active && drag.over?.id === node.id ? drag.over.half : null,
                hover: (half) => {
                  setDrag((curr) =>
                    curr === null
                      ? curr
                      : { ...curr, over: { id: node.id, half: normalizeHalf(half) } },
                  )
                },
                drop: (half) => {
                  if (drag !== null) commitDrag(drag, { id: node.id, half: normalizeHalf(half) })
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
    </div>
  )
}

/**
 * SessionTree: renders hierarchical workspaces and nested fork-trees within each workspace.
 */
function SessionTree({
  list,
  useSessionStatus,
  startSession,
  open,
  workspaces,
  ungroupedSessionIds,
  rowState,
  workspaceReady,
  usePanelInfo,
  onRenameRequest,
  onDeleteRequest,
  onSessionRenameRequest,
  renderSlot,
  insertWorkspaceBefore,
  nestWorkspaces,
  groupExpansion,
  setGroupExpanded,
  setSessionOrder,
  collapsedBranchesByAccount,
  onToggleBranchCollapse,
  home,
  newShortcut,
  t,
  revealSessionId,
  onSessionRevealed,
}: {
  list: SessionListState
  useSessionStatus?: any
  startSession: (workspaceId?: WorkspaceId) => void
  open: (sessionId: SessionId) => void
  workspaces: readonly WorkspaceView[]
  ungroupedSessionIds: readonly SessionId[]
  rowState: SessionRowState
  workspaceReady: boolean
  usePanelInfo?: any
  onRenameRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  onDeleteRequest: (workspaceId: WorkspaceId, title: string) => void
  onSessionRenameRequest: (id: SessionId, currentTitle: string) => void
  renderSlot?: any
  insertWorkspaceBefore: (workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId) => Promise<void>
  nestWorkspaces: boolean
  groupExpansion: Record<string, boolean>
  setGroupExpanded: (key: string, expanded: boolean) => void
  setSessionOrder: (accountKey: string, order: readonly string[]) => void
  collapsedBranchesByAccount: Record<string, string[]>
  onToggleBranchCollapse: (accountKey: string, sessionId: SessionId) => void
  home: string | undefined
  newShortcut?: any
  t: WorkspaceBrowserProps['t']
  revealSessionId?: string | undefined
  onSessionRevealed: (id: string) => void
}) {
  const panelActive = typeof usePanelInfo === 'function' ? usePanelInfo((info: any) => info.activePanelId !== null) : false
  const statuses = typeof useSessionStatus === 'function' ? useSessionStatus((s: any) => s) : new Map()
  const current = panelActive
    ? undefined
    : (Object.values(list.byId).find((session: any) => (session.retainedBy?.mainView ?? 0) > 0)?.id as SessionId | undefined)
  const revealGroup =
    revealSessionId === undefined || !workspaceReady ? undefined : owningGroupKey(workspaces, revealSessionId as SessionId)
  const [sessionLimits, setSessionLimits] = useState<Record<string, number>>({})
  const [drag, setDrag] = useState<{
    accountKey: string
    sessionId: string
    pinned: boolean
    over: { id: string; half: 'before' | 'after' } | null
  } | null>(null)
  const sessionDropCommitted = useRef(false)
  const [workspaceDrag, setWorkspaceDrag] = useState<{
    workspaceId: WorkspaceId
    over: { id: WorkspaceId; half: 'before' | 'after' } | null
  } | null>(null)
  const workspaceDropCommitted = useRef(false)
  const nativeDragActive = drag !== null || workspaceDrag !== null
  useNativeDragAcceptance(nativeDragActive)

  const currentGroup = current === undefined || !workspaceReady ? undefined : owningGroupKey(workspaces, current)

  useEffect(() => {
    if (current === undefined || currentGroup === undefined || Object.hasOwn(groupExpansion, currentGroup)) return
    setGroupExpanded(currentGroup, true)
  }, [current, currentGroup, setGroupExpanded, groupExpansion])

  const parents = useMemo(() => {
    if (!nestWorkspaces) return new Map<string, string | undefined>()
    const keysByPath = new Map(workspaces.map((workspace) => [workspace.path, workspace.workspaceId]))
    const paths = [...keysByPath.keys()]
    return new Map(
      workspaces.map((workspace) => {
        const path = owningParentFolder(workspace.path, paths)
        return [workspace.workspaceId, path === undefined ? undefined : keysByPath.get(path)]
      }),
    )
  }, [nestWorkspaces, workspaces])

  const currentAncestors = useMemo(() => {
    const keys = new Set<string>()
    for (let key = currentGroup === undefined ? undefined : parents.get(currentGroup); key !== undefined; key = parents.get(key)) {
      keys.add(key)
    }
    return keys
  }, [currentGroup, parents])

  const expandedGroups = useMemo(() => {
    const ancestorKeys = new Set(parents.values())
    return [...workspaces.map((w) => w.workspaceId), ''].filter(
      (key) => groupExpansion[key] ?? ancestorKeys.has(key),
    )
  }, [groupExpansion, parents, workspaces])

  const groups = useMemo(
    () =>
      deriveGroups(list, workspaces, rowState, statuses, {
        expandedGroups,
        ungroupedOrder: ungroupedSessionIds,
      }),
    [list, workspaces, rowState, statuses, expandedGroups, ungroupedSessionIds],
  )

  useEffect(() => {
    for (let key = revealGroup; key !== undefined; key = parents.get(key)) {
      if (groupExpansion[key] === false || (key === revealGroup && groupExpansion[key] !== true)) {
        setGroupExpanded(key, true)
      }
    }
  }, [groupExpansion, parents, revealGroup, setGroupExpanded])

  useEffect(() => {
    if (revealSessionId === undefined || revealGroup === undefined) return
    const group = groups.find((candidate) => candidate.key === revealGroup)
    if (group === undefined || !group.expanded || !group.sessions.some((row) => row.id === revealSessionId)) return
    setSessionLimits((limits) =>
      limits[revealGroup] === Infinity ? limits : { ...limits, [revealGroup]: Infinity },
    )
  }, [groups, revealGroup, revealSessionId])

  const now = Date.now()

  const commitSessionDrag = (
    activeDrag: NonNullable<typeof drag>,
    over: { id: string; half: 'before' | 'after' },
  ) => {
    if (sessionDropCommitted.current) return
    sessionDropCommitted.current = true
    setDrag(null)
    const group = groups.find((candidate) => candidate.key === activeDrag.accountKey)
    if (group === undefined || over.id === activeDrag.sessionId) return
    const accountSessionIds =
      activeDrag.accountKey === ''
        ? ungroupedSessionIds.map(String)
        : workspaces.find((w) => w.workspaceId === activeDrag.accountKey)?.sessionIds.map(String)
    if (accountSessionIds === undefined) return
    const renderedSessions = collapsedSessionRows(group.sessions, sessionLimits[group.key]).rows
    const nextOrder = sessionDragOrder(accountSessionIds, renderedSessions, activeDrag, over)
    if (nextOrder !== undefined) setSessionOrder(activeDrag.accountKey, nextOrder)
  }

  const commitWorkspaceDrag = (
    activeDrag: NonNullable<typeof workspaceDrag>,
    over: { id: WorkspaceId; half: 'before' | 'after' },
  ) => {
    if (workspaceDropCommitted.current) return
    workspaceDropCommitted.current = true
    setWorkspaceDrag(null)
    const owner = parents.get(activeDrag.workspaceId)
    const siblings = workspaces.filter((w) => parents.get(w.workspaceId) === owner)
    const rowIndex = siblings.findIndex((w) => w.workspaceId === over.id)
    if (rowIndex === -1) return
    const anchor = over.half === 'before' ? over.id : siblings[rowIndex + 1]?.workspaceId
    if (anchor === activeDrag.workspaceId) return
    const sourceIndex = siblings.findIndex((w) => w.workspaceId === activeDrag.workspaceId)
    const anchorIndex = anchor === undefined ? siblings.length : siblings.findIndex((w) => w.workspaceId === anchor)
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return
    insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason) => {
      console.warn('workspace reorder rejected:', reason)
    })
  }

  const childrenByParent = useMemo(() => {
    const children = new Map<string | undefined, GroupNode[]>()
    for (const group of groups) {
      const parent = parents.get(group.key)
      const siblings = children.get(parent)
      if (siblings === undefined) children.set(parent, [group])
      else siblings.push(group)
    }
    return children
  }, [groups, parents])

  const rootGroups = childrenByParent.get(undefined) ?? []

  const renderGroup = (group: GroupNode, depth: number) => {
    const workspaceId = group.workspaceId
    const children = childrenByParent.get(group.key) ?? []
    const compatibleDrag =
      workspaceDrag !== null && parents.get(workspaceDrag.workspaceId) === parents.get(group.key)

    const sessionTree = buildSessionTree(group.sessions, {
      lookupParent: (id: string) => (list.byId as any)[id]?.parentId,
    })
    const collapsedBranchSet = new Set(collapsedBranchesByAccount[group.key] || [])
    const flattenedRows = flattenSessionTree(sessionTree, 0, [], new Set(), collapsedBranchSet)
    const pathByNode = buildPathMap(sessionTree)

    const limit = sessionLimits[group.key] ?? COLLAPSED_SESSION_LIMIT
    const visibleFlattened = flattenedRows.slice(0, limit)
    const sessionsExpanded = visibleFlattened.length >= flattenedRows.length

    const childRows = group.expanded ? children.map((child) => renderGroup(child, depth + 1)) : []

    const workspaceMarker =
      workspaceId !== undefined && workspaceDrag?.over?.id === workspaceId ? workspaceDrag.over.half : null
    const workspaceDragProps =
      workspaceId === undefined
        ? undefined
        : {
            start: () => {
              workspaceDropCommitted.current = false
              setWorkspaceDrag({ workspaceId, over: null })
            },
            end: () => {
              if (workspaceDrag?.over !== null && workspaceDrag?.over !== undefined) {
                commitWorkspaceDrag(workspaceDrag, workspaceDrag.over)
              } else setWorkspaceDrag(null)
              workspaceDropCommitted.current = false
            },
          }

    const hoverWorkspace =
      workspaceId === undefined || !compatibleDrag
        ? undefined
        : (half: 'before' | 'after') => {
            setWorkspaceDrag((active) =>
              active === null ? active : { ...active, over: { id: workspaceId, half } },
            )
          }

    const dropWorkspace =
      workspaceId === undefined || !compatibleDrag
        ? undefined
        : (half: 'before' | 'after') => {
            commitWorkspaceDrag(workspaceDrag!, { id: workspaceId, half })
          }

    return (
      <div
        key={group.key}
        style={{ '--dsh-workspace-indent': `${depth * 12}px` } as any}
        className={clsx(
          css.groupSection,
          workspaceMarker === 'before' && css.workspaceDropBefore,
          workspaceMarker === 'after' && css.workspaceDropAfter,
        )}
        onDragOver={
          workspaceDrag === null
            ? undefined
            : (e) => {
                e.preventDefault()
                if (hoverWorkspace === undefined && parents.get(group.key) !== undefined) return
                e.stopPropagation()
                if (hoverWorkspace === undefined) {
                  e.dataTransfer.dropEffect = 'none'
                  if (workspaceDrag.over !== null) setWorkspaceDrag({ ...workspaceDrag, over: null })
                } else {
                  e.dataTransfer.dropEffect = 'move'
                  hoverWorkspace(workspaceGroupHalf(e))
                }
              }
        }
        onDrop={
          workspaceDrag === null
            ? undefined
            : (e) => {
                e.preventDefault()
                if (dropWorkspace === undefined && parents.get(group.key) !== undefined) return
                e.stopPropagation()
                if (dropWorkspace === undefined) {
                  workspaceDropCommitted.current = true
                  setWorkspaceDrag(null)
                } else dropWorkspace(workspaceGroupHalf(e))
              }
        }
      >
        <ProjectRowItem
          group={group}
          containsCurrentDescendant={currentAncestors.has(group.key)}
          currentCollapsed={!group.expanded && group.containsCurrent}
          home={home}
          newShortcut={newShortcut}
          t={t}
          onToggle={() => {
            if (group.expanded) {
              setSessionLimits((limits) => ({ ...limits, [group.key]: COLLAPSED_SESSION_LIMIT }))
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
          actions={
            group.workspaceId === undefined
              ? undefined
              : {
                  rename: () => {
                    if (group.workspaceId !== undefined) onRenameRequest(group.workspaceId, group.label)
                  },
                  delete: () => {
                    if (group.workspaceId !== undefined) onDeleteRequest(group.workspaceId, group.label)
                  },
                }
          }
        />
        {childRows.length > 0 && <div role="group">{childRows}</div>}
        {group.expanded &&
          visibleFlattened.map(({ node, depth: nodeDepth }) => {
            const sameGroupDrag = drag !== null && drag.accountKey === group.key
            const compatibleTarget = sameGroupDrag && drag.pinned === node.pinned
            const normalizeHalf = (half: 'before' | 'after') => (node.blank ? 'after' : half)
            const isBranchCollapsed = collapsedBranchSet.has(String(node.id))
            const ancestors = current ? findSessionAncestors(sessionTree, current) : null
            const isCurrentCollapsedAncestor =
              isBranchCollapsed && ancestors !== null && ancestors.includes(node.id)

            const dragProps = {
              start: () => {
                sessionDropCommitted.current = false
                setDrag({
                  accountKey: group.key,
                  sessionId: node.id,
                  pinned: node.pinned,
                  over: null,
                })
              },
              active: compatibleTarget,
              marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
              hover: (half: 'before' | 'after') => {
                setDrag((d) =>
                  d === null ? d : { ...d, over: { id: node.id, half: normalizeHalf(half) } },
                )
              },
              drop: (half: 'before' | 'after') => {
                if (drag === null) return
                commitSessionDrag(drag, { id: node.id, half: normalizeHalf(half) })
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
                depth={nodeDepth}
                collapsed={isBranchCollapsed}
                onToggleCollapse={(id) => onToggleBranchCollapse(group.key, id as SessionId)}
                path={pathByNode.get(node.id) || []}
                currentId={current}
                isCurrentCollapsedAncestor={isCurrentCollapsedAncestor}
                now={now}
                onOpen={(id) => open(id as SessionId)}
                onRenameRequest={(id, title) => onSessionRenameRequest(id as SessionId, title)}
                renderSlot={renderSlot}
                onReveal={
                  node.id === revealSessionId && group.key === revealGroup
                    ? () => {
                        onSessionRevealed(node.id)
                      }
                    : undefined
                }
                drag={dragProps}
                t={t}
              />
            )
          })}
        {group.expanded && flattenedRows.length > COLLAPSED_SESSION_LIMIT && (
          <button
            type="button"
            className={css.sessionOverflowButton}
            aria-expanded={sessionsExpanded}
            onClick={() => {
              setSessionLimits((limits) => ({
                ...limits,
                [group.key]: sessionsExpanded ? COLLAPSED_SESSION_LIMIT : Infinity,
              }))
            }}
          >
            {sessionsExpanded
              ? t('sessions.collapse')
              : t('sessions.expand', { n: Math.max(0, flattenedRows.length - visibleFlattened.length) })}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={css.list} role="tree" aria-label={t('section.workspaces')}>
        {groups.length === 0 && <div className={css.empty}>{t('empty.none')}</div>}
        {rootGroups.map((group) => renderGroup(group, 0))}
      </div>
    </div>
  )
}

/**
 * SearchResults wrapper passing standard actions.
 */
function SearchResults({
  useSessions,
  useSessionStatus,
  open,
  onUnarchive,
  workspaces,
  archivedSessionIds,
  archivedFilter,
  query,
  remote,
  resultLimit,
  t,
}: {
  useSessions: any
  useSessionStatus?: any
  open: (sessionId: SessionId) => void
  onUnarchive?: (sessionId: SessionId) => void
  workspaces: readonly WorkspaceView[]
  archivedSessionIds: readonly string[]
  archivedFilter: ArchivedFilter
  query: string
  remote: {
    query: string
    status: 'idle' | 'loading' | 'ready' | 'error'
    items: readonly any[]
    hasMore: boolean
  }
  resultLimit: number
  t: WorkspaceBrowserProps['t']
}) {
  const list = useSessions((s: any) => s)
  const statuses = typeof useSessionStatus === 'function' ? useSessionStatus((s: any) => s) : new Map()
  const results = useMemo(
    () =>
      deriveSearchResults(
        list,
        workspaces,
        query,
        archivedSessionIds as any,
        archivedFilter,
        statuses,
        remote,
        resultLimit,
      ),
    [list, workspaces, query, archivedSessionIds, archivedFilter, statuses, remote, resultLimit],
  )

  return (
    <div className={clsx(css.treeBody, css.wide)}>
      <div className={css.searchResults} role="tree" aria-label={uiLabel('搜索结果', 'Search Results')}>
        {results.items.length === 0 && <div className={css.empty}>{uiLabel('未找到匹配会话', 'No matching sessions')}</div>}
        {results.items.map((result) => (
          <SearchResultItem
            key={result.id}
            result={result}
            currentId={undefined}
            onOpen={(id) => open(id as SessionId)}
            onUnarchive={onUnarchive ? (id) => onUnarchive(id as SessionId) : undefined}
            t={t}
          />
        ))}
        {results.hasMore && (
          <div className={css.searchMoreHint}>{uiLabel('输入更详细的关键词以精确匹配', 'Narrow query for more matches')}</div>
        )}
      </div>
    </div>
  )
}

/**
 * Root WorkspaceBrowser component.
 */
export function WorkspaceBrowser({
  wide,
  usePanelInfo,
  expandSidebar,
  useSessions,
  useSessionStatus,
  useWorkspaces,
  useStore,
  actions,
  startSession,
  open,
  requestSessionRename,
  notifyArchivedNotOpenable,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  unarchiveSession,
  createWorkspace,
  searchSessions,
  searchResultLimit,
  useDirectoryFlow,
  useHostInfo,
  useShortcuts,
  useWorkspaceShortcuts,
  requestSearch,
  requestAddWorkspace,
  closeAddWorkspace,
  setDirectoryBusy,
  dismissForkError,
  renderSlot,
  t,
}: WorkspaceBrowserProps) {
  const shortcuts = typeof useShortcuts === 'function' ? useShortcuts((s: any) => s) : undefined
  const newShortcut = Array.isArray(shortcuts) ? shortcuts.find((s: any) => s?.id === 'session.new') : undefined
  const home = useHostInfo((info: any) => info?.home)
  const list = useSessions((state: any) => state)
  const workspaces = useWorkspaces((state: any) => state.items)
  const workspacePhase = useWorkspaces((state: any) => state.phase)
  const workspaceStreamState = useWorkspaces((state: any) => state.state)
  const archivedSessionIds = useWorkspaces((state: any) => (state.archivedSessionIds ?? []).map(String))
  const pinnedSessionIds = useWorkspaces((state: any) => (state.pinnedSessionIds ?? []).map(String))
  const directoryFlowAvailable = useDirectoryFlow((occupied: any) => !!occupied)

  const groupBy = useStore((s: any) => s.groupBy)
  const orderBy = useStore((s: any) => s.orderBy)
  const archivedFilter = useStore((s: any) => s.archivedFilter ?? 'default')
  const groupExpansion = useStore((s: any) => s.groupExpansion)
  const sessionOrderByAccount = useStore((s: any) => s.sessionOrderByAccount)

  const BRANCH_COLLAPSE_STORAGE_KEY = 'dsh.branch.collapsed.v1'
  const storeCollapsedBranches = useStore((s: any) => s.collapsedBranchesByAccount)
  const [localCollapsedBranches, setLocalCollapsedBranches] = useState<Record<string, string[]>>(() => {
    if (typeof localStorage === 'undefined') return {}
    try {
      const saved = localStorage.getItem(BRANCH_COLLAPSE_STORAGE_KEY)
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })

  // Merge store state and local state with precedence given to explicit toggles
  const collapsedBranchesByAccount = useMemo(() => {
    const merged: Record<string, string[]> = {}
    if (storeCollapsedBranches && typeof storeCollapsedBranches === 'object') {
      for (const [k, v] of Object.entries(storeCollapsedBranches)) {
        if (Array.isArray(v)) merged[k] = [...v]
      }
    }
    for (const [k, v] of Object.entries(localCollapsedBranches)) {
      if (Array.isArray(v)) merged[k] = [...v]
    }
    return merged
  }, [storeCollapsedBranches, localCollapsedBranches])

  const saveLocalBranches = (next: Record<string, string[]>) => {
    setLocalCollapsedBranches(next)
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(BRANCH_COLLAPSE_STORAGE_KEY, JSON.stringify(next))
      } catch {}
    }
  }

  const handleToggleBranchCollapse = (accountKey: string, sessionId: SessionId) => {
    const sid = String(sessionId)
    const currentList = Array.isArray(collapsedBranchesByAccount[accountKey])
      ? collapsedBranchesByAccount[accountKey]
      : []
    const isCollapsed = currentList.includes(sid)
    const nextList = isCollapsed
      ? currentList.filter((id) => id !== sid)
      : [...currentList, sid]

    if (typeof actions?.setBranchCollapsed === 'function') {
      try {
        actions.setBranchCollapsed(accountKey, sid, !isCollapsed)
      } catch (err) {
        console.warn('[branch-workspace] actions.setBranchCollapsed failed, fallback to local', err)
      }
    }
    const nextState = {
      ...collapsedBranchesByAccount,
      [accountKey]: nextList,
    }
    saveLocalBranches(nextState)
  }

  const handleExpandAllBranches = () => {
    const allKeys = ['', FLAT_SESSION_ORDER_KEY, ...workspaces.map((w: any) => w.workspaceId)]
    if (typeof actions?.setAllBranchesCollapsed === 'function') {
      try {
        for (const key of allKeys) actions.setAllBranchesCollapsed(key, [], false)
      } catch (err) {
        console.warn('[branch-workspace] actions.setAllBranchesCollapsed failed, fallback to local', err)
      }
    }
    const nextState: Record<string, string[]> = {}
    for (const key of allKeys) nextState[key] = []
    saveLocalBranches(nextState)
  }

  const handleCollapseAllBranches = () => {
    const allSessions = list.ids.map((id: any) => list.byId[id]).filter(Boolean)
    const allBranchIds = collectBranchIds(allSessions as any, {
      lookupParent: (id: string) => (list.byId as any)[id]?.parentId,
    })
    const allKeys = ['', FLAT_SESSION_ORDER_KEY, ...workspaces.map((w: any) => w.workspaceId)]
    if (typeof actions?.setAllBranchesCollapsed === 'function') {
      try {
        for (const key of allKeys) actions.setAllBranchesCollapsed(key, allBranchIds, true)
      } catch (err) {
        console.warn('[branch-workspace] actions.setAllBranchesCollapsed failed, fallback to local', err)
      }
    }
    const nextState: Record<string, string[]> = {}
    for (const key of allKeys) nextState[key] = [...allBranchIds]
    saveLocalBranches(nextState)
  }

  const guardedOpen = (sessionId: SessionId) => {
    if (archivedSessionIds.includes(String(sessionId))) {
      notifyArchivedNotOpenable()
      return
    }
    open(sessionId)
  }

  const workspaceReady = workspacePhase === 'ready' && workspaceStreamState !== 'loading'
  const mainSessionId = (Object.values(list.byId) as any[]).find(
    (session: any) => (session.retainedBy?.mainView ?? 0) > 0,
  )?.id as SessionId | undefined
  const currentBlank =
    mainSessionId !== undefined && list.byId[mainSessionId]?.blank === true ? mainSessionId : undefined

  const ungroupedMemberIds = useMemo(() => {
    const accounted = new Set(workspaces.flatMap((w: any) => w.sessionIds.map(String)))
    return list.ids.filter((id: any) => list.byId[id] !== undefined && !accounted.has(String(id))) as SessionId[]
  }, [list, workspaces])

  const orderState = useMemo(
    () => ({ pinnedSessionIds: pinnedSessionIds as any, archivedSessionIds: archivedSessionIds as any }),
    [archivedSessionIds, pinnedSessionIds],
  )
  const rowState: SessionRowState = useMemo(
    () => ({ ...orderState, archivedFilter }),
    [orderState, archivedFilter],
  )

  const flatMemberIds = useMemo(() => sessionMemberIds(list), [list])

  const orderedWorkspaces = useMemo(
    () =>
      workspaces.map((workspace: any) => {
        const memberIds = workspace.sessionIds as SessionId[]
        const baseOrder =
          orderBy === 'updated'
            ? orderByRecency(memberIds, list.byId)
            : reconcileManualOrder(
                memberIds,
                sessionOrderByAccount[workspace.workspaceId],
                list.byId,
                orderState,
              )
        return {
          ...workspace,
          sessionIds: pinCurrentBlank(
            baseOrder,
            currentBlank !== undefined && memberIds.includes(currentBlank) ? currentBlank : undefined,
          ),
        }
      }),
    [currentBlank, list.byId, orderBy, orderState, sessionOrderByAccount, workspaces],
  )

  const orderedUngroupedSessionIds = useMemo(() => {
    return pinCurrentBlank(
      orderBy === 'updated'
        ? orderByRecency(ungroupedMemberIds, list.byId)
        : reconcileManualOrder(
            ungroupedMemberIds,
            sessionOrderByAccount[''],
            list.byId,
            orderState,
          ),
      currentBlank !== undefined && ungroupedMemberIds.includes(currentBlank) ? currentBlank : undefined,
    )
  }, [currentBlank, list.byId, orderBy, orderState, sessionOrderByAccount, ungroupedMemberIds])

  const orderedFlatSessionIds = useMemo(() => {
    return pinCurrentBlank(
      orderBy === 'updated'
        ? orderByRecency(flatMemberIds, list.byId)
        : reconcileManualOrder(
            flatMemberIds,
            sessionOrderByAccount[FLAT_SESSION_ORDER_KEY],
            list.byId,
            orderState,
          ),
      currentBlank !== undefined && flatMemberIds.includes(currentBlank) ? currentBlank : undefined,
    )
  }, [currentBlank, flatMemberIds, list.byId, orderBy, orderState, sessionOrderByAccount])

  const activeSessionOrders = useMemo(
    () =>
      Object.fromEntries([
        ...orderedWorkspaces.map((workspace: any) => [workspace.workspaceId, workspace.sessionIds.map(String)]),
        ['', orderedUngroupedSessionIds.map(String)],
        [FLAT_SESSION_ORDER_KEY, orderedFlatSessionIds.map(String)],
      ]),
    [orderedFlatSessionIds, orderedUngroupedSessionIds, orderedWorkspaces],
  )

  useEffect(() => {
    if (workspacePhase !== 'ready') return
    actions.retainAccountKeys([
      '',
      FLAT_SESSION_ORDER_KEY,
      ...workspaces.map((workspace: any) => workspace.workspaceId),
    ])
  }, [actions, workspacePhase, workspaces])

  useEffect(() => {
    if (list.phase !== 'ready' || workspaceReady || orderBy !== 'manual' || currentBlank === undefined) return
    const changed: Record<string, string[]> = {}
    for (const [key, ids] of Object.entries(activeSessionOrders)) {
      if (key !== FLAT_SESSION_ORDER_KEY && workspacePhase !== 'ready') continue
      const saved = sessionOrderByAccount[key] ?? []
      if ((ids as any)[0] !== currentBlank || saved[0] === currentBlank) continue
      changed[key] = [currentBlank, ...saved.filter((id: string) => id !== currentBlank)]
    }
    if (Object.keys(changed).length > 0) actions.syncSessionOrders(changed)
  }, [
    actions.syncSessionOrders,
    activeSessionOrders,
    currentBlank,
    list.phase,
    orderBy,
    sessionOrderByAccount,
    workspacePhase,
    workspaceReady,
  ])

  useEffect(() => {
    if (list.phase !== 'ready' || !workspaceReady || orderBy !== 'manual' || currentBlank === undefined) return
    if (
      Object.entries(activeSessionOrders).some(
        ([key, ids]: [string, any]) => ids[0] === currentBlank && sessionOrderByAccount[key]?.[0] !== currentBlank,
      )
    ) {
      actions.syncSessionOrders(activeSessionOrders)
    }
  }, [
    actions.syncSessionOrders,
    activeSessionOrders,
    currentBlank,
    list.phase,
    orderBy,
    sessionOrderByAccount,
    workspaceReady,
  ])

  const saveSessionOrder = (accountKey: string, order: readonly string[]) => {
    actions.setSessionOrder(accountKey, order, activeSessionOrders)
  }

  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [revealSessionId, setRevealSessionId] = useState<string | undefined>(undefined)
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  const [remoteSearch, setRemoteSearch] = useState<{
    query: string
    status: 'idle' | 'loading' | 'ready' | 'error'
    items: readonly any[]
    hasMore: boolean
  }>({
    query: '',
    status: 'idle',
    items: [],
    hasMore: false,
  })

  const searchRoot = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const wsPlusRef = useRef<HTMLButtonElement>(null)
  const composingRef = useRef(false)

  const revealTargetSession = useCallback(
    (sessionId: string) => {
      setRevealSessionId(sessionId)
      const groupKey = owningGroupKey(workspaces, sessionId as SessionId)
      const workspaceSessionIds = new Set(workspaces.flatMap((w: any) => w.sessionIds || []))
      let groupSessions =
        groupKey === ''
          ? list.ids.map((id: any) => list.byId[id]).filter((s: any) => s && !workspaceSessionIds.has(s.id))
          : list.ids
              .map((id: any) => list.byId[id])
              .filter(
                (s: any) =>
                  s &&
                  (workspaces.find((w: any) => w.workspaceId === groupKey)?.sessionIds.includes(s.id) ||
                    groupKey === FLAT_SESSION_ORDER_KEY),
              )

      // Fallback to all sessions if the target was not found in the scoped subset (e.g. cross-account lineage)
      if (!groupSessions.some((s: any) => s?.id === sessionId)) {
        groupSessions = list.ids.map((id: any) => list.byId[id]).filter(Boolean)
      }

      const tree = buildSessionTree(groupSessions as any, {
        lookupParent: (id: string) => (list.byId as any)[id]?.parentId,
      })
      const ancestors = findSessionAncestors(tree, sessionId)
      if (ancestors && ancestors.length > 0) {
        for (const ancestorId of ancestors) {
          actions.setBranchCollapsed?.(groupKey, ancestorId, false)
          actions.setBranchCollapsed?.(FLAT_SESSION_ORDER_KEY, ancestorId, false)
        }
      }
    },
    [actions, list.byId, list.ids, workspaces],
  )

  const openSearchResult = (sessionId: SessionId) => {
    if (archivedSessionIds.includes(String(sessionId))) {
      notifyArchivedNotOpenable()
      return
    }
    revealTargetSession(String(sessionId))
    setQuery('')
    setSearchExpanded(false)
    open(sessionId)
  }

  const acknowledgeSessionReveal = (sessionId: string) => {
    setRevealSessionId((current) => (current === sessionId ? undefined : current))
  }

  useEffect(() => {
    if (normalizedQuery !== '') setRevealSessionId(undefined)
  }, [normalizedQuery])

  const [searchOnExpand, setSearchOnExpand] = useState(false)
  useEffect(() => {
    if (wide && searchOnExpand) {
      const timer = window.setTimeout(() => {
        searchInput.current?.focus({ preventScroll: true })
        setSearchOnExpand(false)
      }, EXPAND_SLIDE_MS)
      return () => {
        window.clearTimeout(timer)
      }
    }
  }, [wide, searchOnExpand])

  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    searchInput.current?.focus({ preventScroll: true })
  }, [wide, searchExpanded, searchOnExpand])

  useEffect(() => {
    if (!wide || !searchExpanded || searchOnExpand) return
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) {
        return
      }
      searchInput.current?.blur()
      if (normalizedQuery !== '') return
      setSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('click', onClick)
    }
  }, [normalizedQuery, wide, searchExpanded, searchOnExpand])

  useEffect(() => {
    if (normalizedQuery === '') {
      setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    const controller = new AbortController()
    setRemoteSearch({ query: normalizedQuery, status: 'loading', items: [], hasMore: false })
    const timer = window.setTimeout(() => {
      searchSessions(normalizedQuery, controller.signal)
        .then((result: any) => {
          if (controller.signal.aborted) return
          setRemoteSearch({
            query: normalizedQuery,
            status: 'ready',
            items: result.items,
            hasMore: result.hasMore,
          })
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setRemoteSearch({ query: normalizedQuery, status: 'error', items: [], hasMore: false })
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, searchSessions])

  const [renameTarget, setRenameTarget] = useState<{
    workspaceId: WorkspaceId
    currentTitle: string
  } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameTrimmed = renameDraft.trim()
  const renameDuplicate =
    renameTarget !== null &&
    renameTrimmed !== '' &&
    renameTrimmed !== renameTarget.currentTitle &&
    workspaces.some((w: any) => w.title === renameTrimmed)
  const renameBlocked =
    renaming ||
    renameTrimmed === '' ||
    renameTarget === null ||
    renameTrimmed === renameTarget.currentTitle ||
    renameDuplicate

  const closeRename = () => {
    if (renaming) return
    setRenameTarget(null)
    setRenameError(null)
  }

  const confirmRename = () => {
    if (renameBlocked) return
    setRenaming(true)
    setRenameError(null)
    renameWorkspace(renameTarget.workspaceId, renameTrimmed)
      .then(() => {
        setRenaming(false)
        setRenameTarget(null)
      })
      .catch((reason: any) => {
        setRenaming(false)
        setRenameError(reason instanceof Error ? reason.message : String(reason))
      })
  }

  const [deleteTarget, setDeleteTarget] = useState<{
    workspaceId: WorkspaceId
    title: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteCommittedId, setDeleteCommittedId] = useState<WorkspaceId | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (
      deleteCommittedId === null ||
      workspaces.some((workspace: any) => workspace.workspaceId === deleteCommittedId)
    ) {
      return
    }
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
    if (deleting || deleteTarget === null) return
    setDeleting(true)
    setDeleteError(null)
    deleteWorkspace(deleteTarget.workspaceId)
      .then(() => {
        setDeleteCommittedId(deleteTarget.workspaceId)
      })
      .catch((reason: any) => {
        setDeleting(false)
        setDeleteError(reason instanceof Error ? reason.message : String(reason))
      })
  }

  return (
    <div
      className={clsx(
        css.root,
        !wide && css.rail,
      )}
    >
      <div className={css.sectionHeader}>
        {wide && (
          <span
            className={clsx(
              css.sectionLabel,
              css.wide,
              searchExpanded && css.sectionLabelHidden,
            )}
          >
            {groupBy === 'flat' ? t('section.sessions') : t('section.workspaces')}
          </span>
        )}
        {wide && (
          <div
            className={clsx(
              css.searchSlot,
              searchExpanded && css.searchSlotExpanded,
            )}
          >
            <div
              ref={searchRoot}
              className={clsx(
                css.search,
                searchExpanded && css.searchExpanded,
              )}
              onClick={() => {
                setWsPickerOpen(false)
                setSearchExpanded(true)
                searchInput.current?.focus()
              }}
            >
              <Tooltip
                label={t('search')}
                side="bottom"
                delayMs={500}
                disabled={searchExpanded}
              >
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
                  <IconSearchOutlineRegular size={searchExpanded ? 11 : 14} />
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
                onChange={(e) => {
                  setQuery(sanitizeSearchQuery(e.target.value))
                }}
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
                  <IconCloseFillRegular />
                </button>
              )}
            </div>
          </div>
        )}

        <div
          className={clsx(
            css.headerActions,
            wide && searchExpanded && css.headerActionsHidden,
          )}
        >
          {wide && (
            <ViewOptionsMenu
              groupBy={groupBy}
              orderBy={orderBy}
              archivedFilter={archivedFilter}
              onGroupPick={(mode) => {
                actions.setGroupBy(mode)
              }}
              onOrderPick={(mode) => {
                actions.setOrderBy(mode, activeSessionOrders)
              }}
              onArchivedFilterPick={(filter) => {
                actions.setArchivedFilter(filter)
              }}
              onExpandAllBranches={handleExpandAllBranches}
              onCollapseAllBranches={handleCollapseAllBranches}
              t={t}
            />
          )}

          {directoryFlowAvailable && (
            <Tooltip label={t('workspace.add')} side="bottom" delayMs={500}>
              <button
                ref={wsPlusRef}
                type="button"
                className={css.iconButton}
                aria-label={t('workspace.add')}
                onClick={() => {
                  setWsPickerOpen((v) => !v)
                }}
              >
                <IconProjectAddOutlineRegular size={wide ? 16 : 18} />
              </button>
            </Tooltip>
          )}
        </div>

        <WorkspacePickFlow
          t={t}
          open={wsPickerOpen}
          anchorRef={wsPlusRef}
          useWorkspaces={useWorkspaces}
          createWorkspace={createWorkspace}
          useDirectoryFlow={useDirectoryFlow}
          renderDirectoryFlow={(owner) =>
            renderSlot?.('sidebar.workspaces.directoryFlow', owner)
          }
          addOnly={true}
          side="right"
          onPick={(workspaceId) => {
            setWsPickerOpen(false)
            startSession(workspaceId)
          }}
          onClose={() => {
            setWsPickerOpen(false)
          }}
        />
      </div>

      {!wide && (
        <div className={css.search}>
          <Tooltip label={t('search')} side="bottom" delayMs={500}>
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
              <IconSearchOutlineRegular size={18} />
            </button>
          </Tooltip>
        </div>
      )}

      <div className={css.listArea}>
        {wide &&
          (normalizedQuery !== '' ? (
            <SearchResults
              useSessions={useSessions}
              useSessionStatus={useSessionStatus}
              open={openSearchResult}
              onUnarchive={(id) => unarchiveSession(id)}
              workspaces={workspaces}
              archivedSessionIds={archivedSessionIds}
              archivedFilter={archivedFilter}
              query={normalizedQuery}
              remote={remoteSearch}
              resultLimit={searchResultLimit}
              t={t}
            />
          ) : groupBy === 'flat' ? (
            <FlatList
              list={list}
              sessionIds={orderedFlatSessionIds}
              rowState={rowState}
              useSessionStatus={useSessionStatus}
              open={guardedOpen}
              onSessionRenameRequest={(id, title) =>
                requestSessionRename(id as SessionId, title)
              }
              renderSlot={renderSlot}
              usePanelInfo={usePanelInfo}
              setSessionOrder={saveSessionOrder}
              workspaceReady={workspaceReady}
              revealSessionId={revealSessionId}
              onSessionRevealed={acknowledgeSessionReveal}
              collapsedBranches={
                new Set(collapsedBranchesByAccount[FLAT_SESSION_ORDER_KEY] || [])
              }
              onToggleBranchCollapse={(id) =>
                handleToggleBranchCollapse(FLAT_SESSION_ORDER_KEY, id)
              }
              t={t}
            />
          ) : (
            <SessionTree
              list={list}
              useSessionStatus={useSessionStatus}
              startSession={startSession}
              open={guardedOpen}
              workspaces={orderedWorkspaces}
              ungroupedSessionIds={orderedUngroupedSessionIds}
              rowState={rowState}
              workspaceReady={workspaceReady}
              usePanelInfo={usePanelInfo}
              onRenameRequest={(workspaceId, currentTitle) => {
                setRenameTarget({ workspaceId, currentTitle })
                setRenameDraft(currentTitle)
                setRenameError(null)
              }}
              onDeleteRequest={(workspaceId, title) => {
                setDeleteTarget({ workspaceId, title })
                setDeleteError(null)
              }}
              onSessionRenameRequest={(id, title) =>
                requestSessionRename(id as SessionId, title)
              }
              renderSlot={renderSlot}
              insertWorkspaceBefore={insertWorkspaceBefore}
              nestWorkspaces={groupBy === 'workspace-tree'}
              groupExpansion={groupExpansion}
              setGroupExpanded={actions.setGroupExpanded}
              setSessionOrder={saveSessionOrder}
              collapsedBranchesByAccount={collapsedBranchesByAccount}
              onToggleBranchCollapse={handleToggleBranchCollapse}
              home={home}
              newShortcut={newShortcut}
              t={t}
              revealSessionId={revealSessionId}
              onSessionRevealed={acknowledgeSessionReveal}
            />
          ))}
      </div>

      {/* Rename dialog */}
      <Modal
        open={renameTarget !== null}
        onClose={closeRename}
        closeLabel={t('close')}
        title={t('rename.workspace.title')}
        footer={
          <>
            <Button variant="outline" disabled={renaming} onClick={closeRename}>
              {t('cancel')}
            </Button>
            <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>
              {t('rename')}
            </Button>
          </>
        }
      >
        <input
          className={css.renameInput}
          value={renameDraft}
          aria-label={t('field.workspaceName')}
          autoFocus
          disabled={renaming}
          onChange={(e) => {
            setRenameDraft(e.target.value)
          }}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !composingRef.current && !renameBlocked) confirmRename()
            else if (e.key === 'Escape') closeRename()
          }}
        />
        {renameError && <div className={css.dialogError}>{renameError}</div>}
      </Modal>

      {/* Delete confirmation dialog */}
      <Modal
        open={deleteTarget !== null}
        onClose={closeDelete}
        closeLabel={t('close')}
        title={uiLabel(`删除工作区 "${deleteTarget?.title ?? ''}"`, `Delete workspace "${deleteTarget?.title ?? ''}"`)}
        footer={
          <>
            <Button variant="outline" disabled={deleting} onClick={closeDelete}>
              {t('cancel')}
            </Button>
            <Button variant="primary" disabled={deleting} onClick={confirmDelete}>
              {uiLabel('删除', 'Delete')}
            </Button>
          </>
        }
      >
        <div>{uiLabel('仅删除工作区注册记录，会话日志和目录文件保留。', 'Deletes only the workspace registration record; files remain.')}</div>
        {deleteError && <div className={css.dialogError}>{deleteError}</div>}
      </Modal>
    </div>
  )
}
