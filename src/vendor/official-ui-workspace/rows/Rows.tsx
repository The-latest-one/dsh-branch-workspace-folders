/**
 * Workspace browser tree row components: pure presentational.
 * Fully aligned with DSH 0.1.7-rc.1 while providing hierarchical fork-tree
 * indentation, branch chevrons, branch descendant count badges, and slot-rendered actions.
 */
import { useEffect, useRef, useState, useMemo } from 'react'
import clsx from 'clsx'
import {
  HoverCard,
  IconAlarmClockOutlineRegular,
  IconBranchOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconEditOutlineRegular,
  IconEllipsisOutlineRegular,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
  IconNewChatOutlineRegular,
  IconPinFillRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  IconTreeCornerRegular,
  IconTriangleRightFillRegular,
  IconUnarchiveOutlineRegular,
  Menu,
  Tooltip,
  relativeTime,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import { abbreviateHomePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { GroupNode, SearchResultNode, SessionNode } from '../tree.ts'
import { countDescendants, aggregateDescendantStatus, type BranchNode } from '../branch.ts'
import { uiLabel } from '../ui-label.ts'
import css from './Rows.module.css'

/** The standard locale seat, prop-passed from the browser root. */
type RowTranslate = WorkspaceBrowserProps['t']

/** Row display title: blank rows show the localized New Session label. */
export function displayTitle(node: SessionNode, t: RowTranslate): string {
  return node.blank ? t('session.new') : node.title
}

/** Localized compact relative time ("刚刚"/"5分钟" in zh, "now"/"5min" in en). */
export function timeLabel(updatedAt: number, now: number, t: RowTranslate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

/** Hover-card variant: distances wrap in the ago template; the now bucket stays bare. */
function hoverTimeLabel(updatedAt: number, now: number, t: RowTranslate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t('time.ago', { t: t(`time.${unit}`, { n }) })
}

/** Absolute creation time through the dictionary's date template. */
function createdLabel(createdAt: number, t: RowTranslate): string {
  const d = new Date(createdAt)
  const pad2 = (v: number): string => String(v).padStart(2, '0')
  const date = t('date.ymd', { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })
  return t('hover.created', { time: `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` })
}

/** Hover-card body: workspace title, display directory path, absolute creation time. */
function WorkspaceHoverContent({
  label,
  cwd,
  createdAt,
  t,
}: {
  label: string
  cwd: string | undefined
  createdAt: number
  t: RowTranslate
}) {
  return (
    <div className={css.hoverContent}>
      <div className={css.hoverTitle}>{label}</div>
      <div className={css.hoverPath}>{cwd}</div>
      <div className={css.hoverTime}>{createdLabel(createdAt, t)}</div>
    </div>
  )
}

/**
 * Row drag wiring supplied by the tree owner.
 */
export interface RowDragProps {
  start: () => void
  active: boolean
  marker: 'before' | 'after' | null
  hover: (half: 'before' | 'after') => void
  drop: (half: 'before' | 'after') => void
  end: () => void
}

interface WorkspaceRowDragProps {
  start: () => void
  end: () => void
}

export function rowHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/**
 * Project (workspace) header row: folder + title.
 */
export function ProjectRowItem({
  group,
  onToggle,
  onCreate,
  actions,
  drag,
  home,
  t,
  currentCollapsed,
  containsCurrentDescendant,
}: {
  group: GroupNode
  onToggle: () => void
  onCreate: () => void
  actions?: { rename: () => void; delete: () => void } | undefined
  drag?: WorkspaceRowDragProps | undefined
  home?: string | undefined
  t: RowTranslate
  currentCollapsed?: boolean | undefined
  containsCurrentDescendant?: boolean | undefined
}) {
  const row = group
  const label = row.workspaceId === undefined ? t('group.ungrouped') : row.label
  const active =
    (group.expanded && group.containsCurrent) ||
    (!group.expanded && (currentCollapsed || containsCurrentDescendant))
  const [menuOpen, setMenuOpen] = useState(false)
  const workspaceMenuItems = [
    { id: 'rename', label: t('rename'), icon: <IconEditOutlineRegular /> },
    { id: 'delete', label: t('delete.workspace'), icon: <IconTrashOutlineRegular />, danger: true },
  ]
  const ownRow = (
    <div
      className={clsx(css.projectRow, menuOpen && css.menuOpen)}
      role="treeitem"
      aria-expanded={row.expanded}
      onClick={onToggle}
      draggable={drag !== undefined}
      onDragStart={
        drag === undefined
          ? undefined
          : (e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', row.key)
              drag.start()
            }
      }
      onDragEnd={drag?.end}
    >
      <span className={clsx(css.slot, css.folder, active && css.folderActive)}>
        {row.expanded ? <IconFolderOpenRegular /> : <IconFolderCloseRegular />}
      </span>
      <span className={clsx(css.slot, css.chevron)}>
        <IconTriangleRightFillRegular
          className={clsx(css.arrow, row.expanded && css.arrowOpen)}
        />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{label}</span>
      </span>
      <span className={css.rowActions}>
        {actions !== undefined && (
          <Menu
            open={menuOpen}
            onClose={() => {
              setMenuOpen(false)
            }}
            items={workspaceMenuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              if (id === 'rename') actions.rename()
              else if (id === 'delete') actions.delete()
            }}
            portal
            closeOnPointerLeave
            anchor={
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('actions.workspace.aria', { name: label })}
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen((v) => !v)
                }}
              >
                <IconEllipsisOutlineRegular />
              </button>
            }
          />
        )}
        <Tooltip
          label={t('actions.newSession')}
          side="bottom"
          align="end"
          delayMs={500}
        >
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('actions.newSession.aria', { name: label })}
            onClick={(e) => {
              e.stopPropagation()
              onCreate()
            }}
          >
            <IconNewChatOutlineRegular />
          </button>
        </Tooltip>
      </span>
    </div>
  )

  if (row.createdAt === undefined) return ownRow
  return (
    <HoverCard
      anchor={ownRow}
      content={
        <WorkspaceHoverContent
          label={row.label}
          cwd={row.cwd === undefined ? undefined : abbreviateHomePath(row.cwd, home)}
          createdAt={row.createdAt}
          t={t}
        />
      }
      disabled={menuOpen}
      copyText={row.cwd}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}

function assertNever(value: never): never {
  throw new Error(`unknown pending interaction: ${String(value)}`)
}

interface SessionStatus {
  state: StateDotState
  label: string
  trailingLabel?: string
}

function sessionStatuses(
  node: Pick<
    SessionNode,
    'pendingInteraction' | 'running' | 'runningSubagentCount' | 'completed'
  >,
  t: RowTranslate,
): readonly [SessionStatus, ...SessionStatus[]] {
  const subagents: SessionStatus | undefined =
    node.runningSubagentCount === 0
      ? undefined
      : {
          state: 'ongoing',
          label: t(
            node.runningSubagentCount === 1
              ? 'status.subagentsRunning.one'
              : 'status.subagentsRunning.other',
            { n: node.runningSubagentCount },
          ),
        }
  let pending: SessionStatus | undefined
  switch (node.pendingInteraction) {
    case 'approval':
      pending = {
        state: 'warning',
        label: t('status.waitingApproval'),
        trailingLabel: t('status.waitingApproval'),
      }
      break
    case 'plan-review':
      pending = {
        state: 'warning',
        label: t('status.planReview'),
        trailingLabel: t('status.planReview'),
      }
      break
    case 'question':
      pending = {
        state: 'warning',
        label: t('status.waitingAnswer'),
        trailingLabel: t('status.waitingAnswer'),
      }
      break
    case undefined:
      break
    default:
      return assertNever(node.pendingInteraction)
  }

  if (pending !== undefined) return subagents === undefined ? [pending] : [pending, subagents]
  if (node.running) {
    const primary: SessionStatus = { state: 'ongoing', label: t('status.running') }
    return subagents === undefined ? [primary] : [primary, subagents]
  }
  if (subagents !== undefined) return [subagents]
  if (node.completed) return [{ state: 'done', label: t('status.completed') }]
  return [{ state: 'idle', label: t('status.idle') }]
}

function SessionStatusDots({
  statuses,
}: {
  statuses: readonly [SessionStatus, ...SessionStatus[]]
}) {
  return (
    <>
      <StateDot state={statuses[0].state} />
      {statuses.map((status) => (
        <span className={css.visuallyHidden} key={status.label}>
          {status.label}
        </span>
      ))}
    </>
  )
}

function ActiveScheduleIndicator({
  t,
  search = false,
}: {
  t: RowTranslate
  search?: boolean
}) {
  const label = t('schedule.active')
  return (
    <span
      className={clsx(css.scheduleIndicator, search && css.searchScheduleIndicator)}
      role="img"
      aria-label={label}
      title={label}
    >
      <IconAlarmClockOutlineRegular />
    </span>
  )
}

function PinnedIndicator({ t }: { t: RowTranslate }) {
  const label = uiLabel('已置顶', 'Pinned')
  return (
    <span
      className={css.pinnedIndicator}
      role="img"
      aria-label={label}
      title={label}
    >
      <IconPinFillRegular size={14} />
    </span>
  )
}

function SessionHoverContent({
  node,
  now,
  t,
  path = [],
}: {
  node: SessionNode
  now: number
  t: RowTranslate
  path?: readonly string[]
}) {
  const statuses = sessionStatuses(node, t)
  const pathLabel = path.length > 0 ? path.join(' / ') : undefined
  return (
    <div className={css.hoverContent}>
      {pathLabel !== undefined && (
        <div className={css.hoverTime} style={{ fontSize: 12 }}>
          {pathLabel}
        </div>
      )}
      <div className={css.hoverTitle}>{displayTitle(node, t)}</div>
      {!node.blank && (
        <div className={css.hoverTime}>{hoverTimeLabel(node.updatedAt, now, t)}</div>
      )}
      {statuses.map((status) => (
        <div className={css.hoverStatus} key={status.label}>
          <StateDot state={status.state} />
          <span>{status.label}</span>
        </div>
      ))}
    </div>
  )
}

export function SearchResultItem({
  result,
  currentId,
  onOpen,
  onUnarchive,
  t,
}: {
  result: SearchResultNode
  currentId: string | undefined
  onOpen: (id: SearchResultNode['id']) => void
  onUnarchive?: (id: SearchResultNode['id']) => void
  t: RowTranslate
}) {
  const selected = result.id === currentId
  const statuses = sessionStatuses(result, t)
  const primaryStatus = statuses[0]
  return (
    <div
      className={clsx(
        css.searchResultRow,
        selected && css.selected,
        result.archived && css.archived,
      )}
      role="treeitem"
      aria-selected={selected}
      aria-description={result.archived ? t('toast.archivedNotOpenable') : undefined}
      onClick={() => {
        onOpen(result.id)
      }}
    >
      <span className={css.searchResultHeading}>
        <span className={css.slot}>
          {!result.archived && (primaryStatus.state !== 'idle' || result.completed) && (
            <SessionStatusDots statuses={statuses} />
          )}
        </span>
        <span className={css.searchResultTitle}>{result.title}</span>
        {result.hasActiveSchedule && <ActiveScheduleIndicator t={t} search />}
        {result.archived && onUnarchive !== undefined && (
          <span className={css.rowActions}>
            <Tooltip
              label={t('actions.unarchive')}
              side="bottom"
              align="end"
              delayMs={500}
            >
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('menu.unarchiveSession')}
                onClick={(e) => {
                  e.stopPropagation()
                  onUnarchive(result.id)
                }}
              >
                <IconUnarchiveOutlineRegular size={14} />
              </button>
            </Tooltip>
          </span>
        )}
      </span>
      <span className={css.searchResultMeta}>
        <span className={css.searchResultWorkspace}>
          {result.workspace || t('group.ungrouped')}
        </span>
        {result.snippet !== undefined && (
          <span className={css.searchResultSnippet}>{result.snippet}</span>
        )}
      </span>
    </div>
  )
}

/**
 * SessionNodeItem: renders one session row with branch indentation,
 * fold/unfold chevron, quiet badge, and slot-composed actions.
 */
export function SessionNodeItem({
  node,
  currentId,
  now,
  onOpen,
  onRenameRequest,
  renderSlot,
  onReveal,
  drag,
  flat = false,
  depth = 0,
  collapsed = false,
  onToggleCollapse,
  path = [],
  isCurrentCollapsedAncestor = false,
  t,
}: {
  node: SessionNode
  currentId: string | undefined
  now: number
  onOpen: (id: SessionNode['id']) => void
  onRenameRequest?: (id: SessionNode['id'], currentTitle: string) => void
  renderSlot?: any
  onReveal?: (() => void) | undefined
  drag?: RowDragProps | undefined
  flat?: boolean | undefined
  depth?: number | undefined
  collapsed?: boolean | undefined
  onToggleCollapse?: ((id: SessionNode['id']) => void) | undefined
  path?: readonly string[] | undefined
  isCurrentCollapsedAncestor?: boolean | undefined
  t: RowTranslate
}) {
  const row = node
  const title = displayTitle(node, t)
  const selected = node.id === currentId
  const branchChildren = node.children ?? []
  const totalDescendants = countDescendants(node as unknown as BranchNode)

  const statuses = useMemo(() => {
    const ownStatuses = sessionStatuses(node, t)
    const ownActive = ownStatuses[0].state !== 'idle'
    if (ownActive || !collapsed || branchChildren.length === 0) {
      return ownStatuses
    }
    const descendantStatus = aggregateDescendantStatus(node as unknown as BranchNode)
    if (
      descendantStatus.hasPendingInteraction === undefined &&
      !descendantStatus.hasRunning &&
      !descendantStatus.runningSubagentCount &&
      !descendantStatus.hasCompleted
    ) {
      return ownStatuses
    }

    const bubbledProxy = {
      pendingInteraction: descendantStatus.hasPendingInteraction,
      running: descendantStatus.hasRunning ?? false,
      runningSubagentCount: descendantStatus.runningSubagentCount ?? 0,
      completed: descendantStatus.hasCompleted ?? false,
    }
    return sessionStatuses(bubbledProxy, t)
  }, [collapsed, branchChildren.length, node, t])

  const primaryStatus = statuses[0]
  const showStatus = primaryStatus.state !== 'idle'
  const draggable = drag !== undefined && !row.blank && !row.archived
  const [menuOpen, setMenuOpen] = useState(false)
  const [rowHovered, setRowHovered] = useState(false)
  const menuOpenState = useMemo(() => [menuOpen, setMenuOpen], [menuOpen])
  const rowRef = useRef<HTMLDivElement>(null)
  const hasBranchToggle = branchChildren.length > 0 && onToggleCollapse !== undefined

  useEffect(() => {
    if (onReveal === undefined) return
    rowRef.current?.scrollIntoView({ block: 'nearest' })
    onReveal()
  }, [onReveal])

  const ownRow = (
    <div
      ref={rowRef}
      className={clsx(
        css.sessionRow,
        selected && css.selected,
        menuOpen && css.menuOpen,
        row.archived && css.archived,
        branchChildren.length > 0 && css.branchParent,
        depth === 0 && branchChildren.length > 0 && css.branchRoot,
        depth > 0 && css.branchChild,
        depth >= 2 && css.deepBranch,
        flat && !showStatus && css.flatSessionRowWithoutStatus,
        drag?.marker === 'before' && css.dropBefore,
        drag?.marker === 'after' && css.dropAfter,
      )}
      style={
        depth > 0
          ? ({
              '--dsh-branch-indent': `${depth * 16}px`,
              '--dsh-branch-depth': depth,
            } as any)
          : undefined
      }
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-description={row.archived ? uiLabel('已归档的会话无法直接打开', 'Archived session cannot be opened') : undefined}
      {...(branchChildren.length > 0 ? { 'aria-expanded': !collapsed } : {})}
      onClick={() => {
        onOpen(node.id)
      }}
      onPointerEnter={() => {
        setRowHovered(true)
      }}
      onPointerLeave={() => {
        setRowHovered(false)
      }}
      draggable={draggable}
      onDragStart={
        !draggable
          ? undefined
          : (e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', node.id)
              drag.start()
            }
      }
      onDragEnd={!draggable ? undefined : drag.end}
      onDragOver={
        drag === undefined
          ? undefined
          : (e) => {
              if (!drag.active) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              drag.hover(rowHalf(e))
            }
      }
      onDrop={
        drag === undefined
          ? undefined
          : (e) => {
              if (!drag.active) return
              e.preventDefault()
              drag.drop(rowHalf(e))
            }
      }
    >
      {/* Leading chevron: only for branch parents with children */}
      {hasBranchToggle ? (
        <button
          type="button"
          className={css.branchToggleSlot}
          aria-label={collapsed ? uiLabel('展开分支', 'Expand branch') : uiLabel('折叠分支', 'Collapse branch')}
          aria-expanded={!collapsed}
          onPointerDown={(e) => {
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onToggleCollapse(node.id)
          }}
          style={
            isCurrentCollapsedAncestor
              ? { color: 'var(--dsw-alias-state-business-primary)' }
              : undefined
          }
        >
          {collapsed ? (
            <IconChevronRightOutlineRegular />
          ) : (
            <IconChevronDownOutlineRegular />
          )}
        </button>
      ) : depth > 0 ? (
        <span className={css.branchGuideSlot} aria-hidden="true">
          <IconTreeCornerRegular size={14} />
        </span>
      ) : null}

      {/* Status dot */}
      {(!flat || showStatus) && (
        <span className={css.slot}>
          {!row.archived && showStatus && <SessionStatusDots statuses={statuses} />}
        </span>
      )}

      {/* Title */}
      <span
        className={css.title}
        onDoubleClick={
          row.blank
            ? undefined
            : (e) => {
                e.stopPropagation()
                onRenameRequest?.(node.id, row.title)
              }
        }
      >
        {title}
      </span>

      {/* Active schedule indicator */}
      {row.hasActiveSchedule && <ActiveScheduleIndicator t={t} />}

      {/* Branch count badge: non-intrusive, auto-hidden on hover so actions have full width */}
      {branchChildren.length > 0 && (
        <span
          className={css.branchBadge}
          style={
            isCurrentCollapsedAncestor
              ? { color: 'var(--dsw-alias-state-business-primary)' }
              : undefined
          }
        >
          <IconBranchOutlineRegular size={11} />
          <span>{totalDescendants}</span>
        </span>
      )}

      {/* Pinned indicator */}
      {row.pinned && !row.archived && <PinnedIndicator t={t} />}

      {/* Time / trailing label */}
      {!row.blank && (
        <span
          className={css.time}
          aria-hidden={primaryStatus.trailingLabel === undefined ? undefined : true}
        >
          {primaryStatus.trailingLabel ?? timeLabel(row.updatedAt, now, t)}
        </span>
      )}

      {/* Slot-composed row actions and context menu */}
      {!row.blank && (
        <span
          className={css.rowActions}
          onClick={(e) => {
            e.stopPropagation()
          }}
        >
          {renderSlot ? (
            <>
              <Menu
                open={menuOpen}
                onClose={() => {
                  setMenuOpen(false)
                }}
                portal
                closeOnPointerLeave
                items={[]}
                anchor={
                  <button
                    type="button"
                    className={css.iconButton}
                    aria-label={t('actions.session.aria', { name: title })}
                    onClick={() => {
                      setMenuOpen((v) => !v)
                    }}
                  >
                    <IconEllipsisOutlineRegular />
                  </button>
                }
              >
                {renderSlot(
                  'sidebar.workspaces.session.menu.item',
                  {
                    sessionId: node.id,
                    displayTitle: row.title,
                  },
                  { hookContext: menuOpenState },
                )}
              </Menu>
              {renderSlot('sidebar.workspaces.session.row.action', {
                sessionId: node.id,
                displayTitle: row.title,
              })}
            </>
          ) : (
            <Menu
              open={menuOpen}
              onClose={() => {
                setMenuOpen(false)
              }}
              items={[
                { id: 'rename', label: t('rename'), icon: <IconEditOutlineRegular /> },
                { id: 'fork', label: t('menu.fork'), icon: <IconBranchOutlineRegular /> },
              ]}
              onSelect={(id) => {
                setMenuOpen(false)
                if (id === 'rename') onRenameRequest?.(node.id, row.title)
              }}
              portal
              closeOnPointerLeave
              anchor={
                <button
                  type="button"
                  className={css.iconButton}
                  aria-label={t('actions.session.aria', { name: title })}
                  onClick={() => {
                    setMenuOpen((v) => !v)
                  }}
                >
                  <IconEllipsisOutlineRegular />
                </button>
              }
            />
          )}
        </span>
      )}
    </div>
  )

  return (
    <HoverCard
      anchor={ownRow}
      content={<SessionHoverContent node={node} now={now} t={t} path={path} />}
      openDelayMs={800}
      disabled={menuOpen || drag?.active === true}
      copyText={row.blank ? undefined : row.title}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}
