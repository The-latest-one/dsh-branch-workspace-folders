/**
 * Workspace browser tree row components (figma Cell set 14:3080): pure presentational —
 * all data and callbacks arrive via props. Hover swaps (folder->chevron,
 * time->ellipsis, action buttons) are CSS-only. Row ... menus are visual-only
 * except workspace Rename/Delete and session Rename/Fork/Archive; the session
 * and workspace hover cards are suppressed while a menu is open.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  HoverCard, IconAlarmClockOutline16, IconArchiveOutline20, IconBranchOutline16,
  IconChevronDownOutline14, IconChevronRightOutline14, IconEditOutline16,
  IconEllipsisOutline16, IconFolderClose16, IconFolderOpen16, IconPlusOutline16,
  IconTrashOutline16, IconTriangleRightFill14, Menu, relativeTime, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import { abbreviateHomePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { GroupNode, SearchResultNode, SessionNode } from '../tree.ts'
import { countDescendants, type BranchNode } from '../branch.ts'
import { uiLabel } from '../ui-label.ts'
import css from './Rows.module.css'

/** The standard locale seat, prop-passed from the browser root. */
type RowTranslate = WorkspaceBrowserProps['t']

/** Row display title: blank rows show the localized New Session label. */
function displayTitle(node: SessionNode, t: RowTranslate): string {
  return node.blank ? t('session.new') : node.title
}

/** Localized compact relative time ("刚刚"/"5分钟" in zh, "now"/"5min" in en). */
function timeLabel(updatedAt: number, now: number, t: RowTranslate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

/** Hover-card variant: distances wrap in the ago template; the now bucket stays bare (no "now ago"). */
function hoverTimeLabel(updatedAt: number, now: number, t: RowTranslate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t('time.ago', { t: t(`time.${unit}`, { n }) })
}

/**
 * Absolute creation time through the dictionary's date template (the message
 * clock pattern): `toLocaleString` would follow the browser language, not the
 * app locale, and produce mixed-language text after a switch.
 */
function createdLabel(createdAt: number, t: RowTranslate): string {
  const d = new Date(createdAt)
  const pad2 = (v: number): string => String(v).padStart(2, '0')
  const date = t('date.ymd', { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })
  return t('hover.created', { time: `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` })
}

/** Hover-card body: workspace title, display directory path, absolute creation time. */
function WorkspaceHoverContent({ label, cwd, createdAt, t }: {
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
 * Row drag wiring supplied by the tree owner. `drop` reports the half of the
 * row where the pointer released so the owner can resolve an insert anchor.
 */
export interface RowDragProps {
  /** Start dragging this row. */
  start: () => void
  /** A compatible row drag is in flight. */
  active: boolean
  /** Current marker on this row: insert line above, below, or none. */
  marker: 'before' | 'after' | null
  /** Report the hovered half while a compatible drag passes over this row. */
  hover: (half: 'before' | 'after') => void
  drop: (half: 'before' | 'after') => void
  end: () => void
}

/** Drag lifecycle owned by a workspace row; its enclosing group owns hit testing. */
interface WorkspaceRowDragProps {
  start: () => void
  end: () => void
}

/** Pointer-position half of a row (insert line above or below). */
function rowHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/**
 * Project (workspace) header row: folder + title;
 * hover reveals the chevron and create button, and dwelling on a real
 * Workspace shows its hover card (the ungrouped bucket has none).
 * `containsCurrent` arrives on the node (derivation fact, no renderer scan).
 * @param props.group - derived group node.
 * @param props.onToggle - expand/collapse the group.
 * @param props.onCreate - start a frontend Session inside this Workspace.
 * @param props.drag - optional workspace-row drag wiring.
 * @param props.home - host account home for POSIX hover-path abbreviation.
 * @param props.t - the browser root's locale seat.
 * @returns the row element.
 */
export function ProjectRowItem({ group, onToggle, onCreate, actions, drag, home, t }: {
  group: GroupNode
  onToggle: () => void
  onCreate: () => void
  /** Real-Workspace actions; absent for the ungrouped bucket (no menu shown). */
  actions?: { rename: () => void; delete: () => void } | undefined
  /** Present only for real Workspace rows in the grouped view. */
  drag?: WorkspaceRowDragProps | undefined
  /** Host account home; POSIX home-rooted hover paths display as `~`. */
  home?: string | undefined
  t: RowTranslate
}) {
  const row = group
  // The ungrouped bucket has no workspace title: its label is dictionary copy.
  const label = row.workspaceId === undefined ? t('group.ungrouped') : row.label
  const active = group.expanded && group.containsCurrent
  const [menuOpen, setMenuOpen] = useState(false)
  const workspaceMenuItems = [
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    { id: 'delete', label: t('delete.workspace'), icon: <IconTrashOutline16 />, danger: true },
  ]
  const ownRow = (
    <div
      className={clsx(css.projectRow, menuOpen && css.menuOpen)}
      role="treeitem"
      aria-expanded={row.expanded}
      onClick={onToggle}
      draggable={drag !== undefined}
      onDragStart={drag === undefined
        ? undefined
        : (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', row.key)
          drag.start()
        }}
      onDragEnd={drag?.end}
    >
      <span className={clsx(css.slot, css.folder, active && css.folderActive)}>
        {row.expanded ? <IconFolderOpen16 /> : <IconFolderClose16 />}
      </span>
      <span className={clsx(css.slot, css.chevron)}>
        <IconTriangleRightFill14 className={clsx(css.arrow, row.expanded && css.arrowOpen)} />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{label}</span>
      </span>
      <span className={css.rowActions}>
        {actions !== undefined && (
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={workspaceMenuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              // Unknown ids leave before the dispatch: a future menu row must
              // not inherit the destructive branch as an else fallback.
              /* v8 ignore next -- Menu can emit only the rename and delete rows supplied above. */
              if (id !== 'rename' && id !== 'delete') return
              if (id === 'rename') actions.rename()
              else actions.delete()
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('actions.workspace.aria', { name: label })}
                onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
              >
                <IconEllipsisOutline16 />
              </button>
            )}
          />
        )}
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('actions.newSession.aria', { name: label })}
          onClick={(e) => { e.stopPropagation(); onCreate() }}
        >
          <IconPlusOutline16 />
        </button>
      </span>
    </div>
  )
  // The ungrouped bucket has no backing Workspace: no card to show.
  if (row.createdAt === undefined) return ownRow
  return (
    <HoverCard
      anchor={ownRow}
      content={<WorkspaceHoverContent
        label={row.label}
        cwd={row.cwd === undefined ? undefined : abbreviateHomePath(row.cwd, home)}
        createdAt={row.createdAt}
        t={t}
      />}
      disabled={menuOpen}
      copyText={row.cwd}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}

/* v8 ignore next 3 -- closed-union backstop; only reached if the status is forged */
function assertNever(value: never): never {
  throw new Error(`unknown pending interaction: ${String(value)}`)
}

interface SessionStatus {
  state: StateDotState
  label: string
}

/**
 * Session status presentation; pending interaction is primary and live activity
 * outranks completion reminders.
 */
function sessionStatuses(
  node: Pick<SessionNode, 'pendingInteraction' | 'running' | 'runningSubagentCount' | 'completed'>,
  t: RowTranslate,
): readonly [SessionStatus, ...SessionStatus[]] {
  const subagents: SessionStatus | undefined = node.runningSubagentCount === 0
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
      pending = { state: 'warning', label: t('status.waitingApproval') }
      break
    case 'plan-review':
      pending = { state: 'warning', label: t('status.planReview') }
      break
    case 'question':
      pending = { state: 'warning', label: t('status.waitingAnswer') }
      break
    case undefined: break
    /* v8 ignore next -- closed PendingInteractionStatus union */
    default: return assertNever(node.pendingInteraction)
  }
  if (pending !== undefined) return subagents === undefined ? [pending] : [pending, subagents]
  if (node.running) {
    const primary: SessionStatus = { state: 'ongoing', label: t('status.running') }
    return subagents === undefined ? [primary] : [primary, subagents]
  }
  if (subagents !== undefined) return [subagents]
  if (node.completed) return [{ state: 'done', label: t('status.completed') }]
  return [{ state: 'done', label: t('status.idle') }]
}

/** Primary status dot plus every status's screen-reader label, shared by the search and session rows. */
function SessionStatusDots({ statuses }: { statuses: readonly [SessionStatus, ...SessionStatus[]] }) {
  return (
    <>
      <StateDot state={statuses[0].state} />
      {statuses.map(status => (
        <span className={css.visuallyHidden} key={status.label}>{status.label}</span>
      ))}
    </>
  )
}

/** Non-interactive active-Schedule marker; the enclosing row remains the only action. */
function ActiveScheduleIndicator({ t, search = false }: { t: RowTranslate; search?: boolean }) {
  const label = t('schedule.active')
  return (
    <span
      className={clsx(css.scheduleIndicator, search && css.searchScheduleIndicator)}
      role="img"
      aria-label={label}
      title={label}
    >
      <IconAlarmClockOutline16 />
    </span>
  )
}

/** Hover-card body: full title, relative time, and every relevant live status. */
function SessionHoverContent({ node, now, t, path = [] }: {
  node: SessionNode
  now: number
  t: RowTranslate
  /** Ancestor title chain from the fork-tree root (branch breadcrumb). */
  path?: readonly string[]
}) {
  const statuses = sessionStatuses(node, t)
  const pathLabel = path.length > 0 ? path.map(part => part).join(' / ') : undefined
  return (
    <div className={css.hoverContent}>
      {pathLabel !== undefined && (
        <div className={css.hoverTime} style={{ fontSize: 12 }}>{pathLabel}</div>
      )}
      <div className={css.hoverTitle}>{displayTitle(node, t)}</div>
      {/* Same placeholder rule as the row's trailing cell: no timestamp
          before the first prompt. */}
      {!node.blank && <div className={css.hoverTime}>{hoverTimeLabel(node.updatedAt, now, t)}</div>}
      {statuses.map(status => (
        <div className={css.hoverStatus} key={status.label}>
          <StateDot state={status.state} />
          <span>{status.label}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * One flat search result: title, Workspace context, and optional content
 * excerpt. Search navigation opens the session only; it does not address an
 * event inside the conversation.
 * @param props.result - merged local/content search row.
 * @param props.currentId - selected session id.
 * @param props.onOpen - open the selected session.
 * @param props.t - Workspace-browser translation seat.
 * @returns the result button.
 */
export function SearchResultItem({ result, currentId, onOpen, t }: {
  result: SearchResultNode
  currentId: string | undefined
  onOpen: (id: SearchResultNode['id']) => void
  t: RowTranslate
}) {
  const selected = result.id === currentId
  const statuses = sessionStatuses(result, t)
  const primaryStatus = statuses[0]
  return (
    <button
      type="button"
      className={clsx(css.searchResultRow, selected && css.selected)}
      role="treeitem"
      aria-selected={selected}
      onClick={() => { onOpen(result.id) }}
    >
      <span className={css.searchResultHeading}>
        <span className={css.slot}>
          {(primaryStatus.state !== 'done' || result.completed) && (
            <SessionStatusDots statuses={statuses} />
          )}
        </span>
        <span className={css.searchResultTitle}>{result.title}</span>
        {result.hasActiveSchedule && <ActiveScheduleIndicator t={t} search />}
      </span>
      <span className={css.searchResultMeta}>
        <span className={css.searchResultWorkspace}>{result.workspace || t('group.ungrouped')}</span>
        {result.snippet !== undefined && (
          <span className={css.searchResultSnippet}>{result.snippet}</span>
        )}
      </span>
    </button>
  )
}

/**
 * One top-level 34px session row: status dot (pending user interaction outranks
 * own or descendant activity), title, relative time, and the row actions menu.
 * @param props.node - derived session node.
 * @param props.currentId - selected session id (row highlight).
 * @param props.now - epoch ms for relative-time formatting.
 * @param props.onOpen - open a session by id.
 * @param props.onRename - open the session rename dialog (id + current title).
 * @param props.onFork - fork a session at its last completed turn.
 * @param props.onArchive - archive a session by id.
 * @param props.onReveal - scroll this row into view after search navigation, then acknowledge it.
 * @param props.drag - optional draggable-row wiring.
 * @param props.flat - omit the empty status slot in the hierarchy-free flat list.
 * @param props.t - the browser root's locale seat.
 * @returns the session row.
 */
/**
 * One session row: status dot (pending user interaction outranks own or
 * descendant activity), title, relative time, and the row actions menu.
 * Branch rows additionally render the tree chevron, fork badge with a
 * direct-branch jump menu, current-session capsule, and sibling jump.
 * @param props.node - derived session node.
 * @param props.currentId - selected session id (row highlight).
 * @param props.now - epoch ms for relative-time formatting.
 * @param props.onOpen - open a session by id.
 * @param props.onRename - open the session rename dialog (id + current title).
 * @param props.onFork - fork a session at its last completed turn.
 * @param props.onArchive - archive a session by id.
 * @param props.onReveal - scroll this row into view after search navigation, then acknowledge it.
 * @param props.drag - optional draggable-row wiring.
 * @param props.flat - omit the empty status slot in the hierarchy-free flat list.
 * @param props.depth - tree nesting depth (0 = top-level row).
 * @param props.collapsed - branch-collapsed state of this node.
 * @param props.onToggleCollapse - toggle this node's branch collapse; present only for branch nodes.
 * @param props.path - ancestor title chain from the fork-tree root (hover breadcrumb).
 * @param props.siblings - sibling rows under the same branch parent (branch jump targets).
 * @param props.onJumpSibling - jump to the previous/next sibling branch.
 * @param props.selectionMode - batch-selection mode: show the row checkbox.
 * @param props.selected - this row is in the batch selection.
 * @param props.onToggleSelect - toggle this row in the batch selection.
 * @param props.muted - row is dimmed (search refinement context).
 * @param props.isCurrent - this row is the current session.
 * @param props.isCurrentCollapsedAncestor - this row is the visible collapsed ancestor of the current session.
 * @param props.t - the browser root's locale seat.
 * @returns the session row.
 */
export function SessionNodeItem({
  node, currentId, now, onOpen, onRename, onFork, onArchive, onReveal, drag, flat = false, t,
  depth = 0,
  collapsed = false,
  onToggleCollapse,
  path = [],
  siblings = [],
  onJumpSibling,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  muted = false,
  isCurrent = false,
  isCurrentCollapsedAncestor = false,
}: {
  node: SessionNode
  currentId: string | undefined
  now: number
  onOpen: (id: SessionNode['id']) => void
  /** Open the browser-owned session rename dialog (row menu action). */
  onRename: (id: SessionNode['id'], currentTitle: string) => void
  /** Fork a session at its last completed turn (row menu action). */
  onFork: (id: SessionNode['id']) => void
  /** Archive this session (row menu action; commits without a dialog). */
  onArchive: (id: SessionNode['id']) => void
  /** Scroll this row into view after search navigation, then acknowledge it. */
  onReveal?: (() => void) | undefined
  /** Present only on draggable rows (workspace-group sessions outside search). */
  drag?: RowDragProps | undefined
  /** The row is rendered without a parent Workspace header. */
  flat?: boolean | undefined
  /** Tree nesting depth (0 = top-level row). */
  depth?: number | undefined
  /** Branch-collapsed state of this node. */
  collapsed?: boolean | undefined
  /** Toggle this node's branch collapse; present only for branch nodes. */
  onToggleCollapse?: ((id: SessionNode['id']) => void) | undefined
  /** Ancestor title chain from the fork-tree root (hover breadcrumb). */
  path?: readonly string[] | undefined
  /** Sibling rows under the same branch parent (branch jump targets). */
  siblings?: readonly SessionNode[] | undefined
  /** Jump to the previous/next sibling branch. */
  onJumpSibling?: ((dir: 'prev' | 'next', id: SessionNode['id']) => void) | undefined
  /** Batch-selection mode: show the row checkbox. */
  selectionMode?: boolean | undefined
  /** This row is in the batch selection. */
  selected?: boolean | undefined
  /** Toggle this row in the batch selection. */
  onToggleSelect?: ((id: SessionNode['id']) => void) | undefined
  /** Row is dimmed (search refinement context). */
  muted?: boolean | undefined
  /** This row is the current session. */
  isCurrent?: boolean | undefined
  /** This row is the visible collapsed ancestor of the current session. */
  isCurrentCollapsedAncestor?: boolean | undefined
  t: RowTranslate
}) {
  const row = node
  const title = displayTitle(node, t)
  const rowSelected = node.id === currentId
  const statuses = sessionStatuses(node, t)
  const primaryStatus = statuses[0]
  const showStatus = primaryStatus.state !== 'done' || row.completed
  const [menuOpen, setMenuOpen] = useState(false)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const branchChildren = node.children ?? []
  const totalDescendants = countDescendants(node as unknown as BranchNode)
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (onReveal === undefined) return
    rowRef.current?.scrollIntoView({ block: 'nearest' })
    onReveal()
  }, [onReveal])
  // Archive hides the row through the registry-global archive set and never
  // touches the session log, so it is not styled as destructive and needs no
  // confirmation dialog.
  const sessionMenuItems = [
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    { id: 'fork', label: t('menu.fork'), icon: <IconBranchOutline16 /> },
    // 20-native glyph in the menu's 16px icon slot (Menu.module.css .itemIcon).
    { id: 'archive', label: t('menu.archiveSession'), icon: <IconArchiveOutline20 size={16} /> },
  ]
  const branchMenuItems = [
    {
      type: 'label' as const,
      id: 'branch-header',
      text: `${branchChildren.length} ${uiLabel('个直接分支 / 共', 'direct branches /')} ${totalDescendants} ${uiLabel('个分支', 'branches total')}`,
    },
    ...branchChildren.map((child) => ({
      id: child.id,
      label: displayTitle(child, t),
      icon: child.running ? <StateDot state="ongoing" /> : <StateDot state="done" />,
    })),
  ]
  // Figma session cell: pad 8, status slot 16, then a 4px title gap.
  const ownRow = (
    <div
      ref={rowRef}
      className={clsx(
        css.sessionRow, rowSelected && css.selected, menuOpen && css.menuOpen,
        depth === 0 && css.branchRoot, depth > 0 && css.branchChild,
        muted && css.rowMuted,
        flat && !showStatus && css.flatSessionRowWithoutStatus,
        drag?.marker === 'before' && css.dropBefore, drag?.marker === 'after' && css.dropAfter,
      )}
      style={depth > 0
        ? { paddingLeft: `calc(var(--dsh-sidebar-inline-padding, 8px) + ${depth * 16}px)` }
        : undefined}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={rowSelected}
      {...(branchChildren.length > 0 ? { 'aria-expanded': !collapsed } : {})}
      onClick={() => { onOpen(node.id) }}
      draggable={drag !== undefined}
      onDragStart={drag === undefined
        ? undefined
        : (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', node.id)
          drag.start()
        }}
      onDragEnd={drag?.end}
      onDragOver={drag === undefined
        ? undefined
        : (e) => {
          if (!drag.active) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          drag.hover(rowHalf(e))
        }}
      onDrop={drag === undefined
        ? undefined
        : (e) => {
          if (!drag.active) return
          e.preventDefault()
          drag.drop(rowHalf(e))
        }}
    >
      {selectionMode && (
        <span style={{ display: 'inline-flex', alignItems: 'center', flex: 'none', paddingRight: 2 }}>
          <input
            type="checkbox"
            checked={selected}
            aria-label={uiLabel('选择会话', 'Select session')}
            onClick={(e) => { e.stopPropagation() }}
            onChange={() => { if (onToggleSelect !== undefined) onToggleSelect(node.id) }}
          />
        </span>
      )}
      {onToggleCollapse !== undefined && branchChildren.length > 0 && (
        <button
          type="button"
          aria-label={collapsed ? uiLabel('展开分支', 'Expand branch') : uiLabel('折叠分支', 'Collapse branch')}
          aria-expanded={!collapsed}
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.id) }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
            width: 20,
            height: 20,
            padding: 0,
            border: 'none',
            background: 'none',
            color: 'var(--dsw-alias-label-tertiary)',
            cursor: 'pointer',
            borderRadius: 6,
          }}
        >
          {collapsed ? <IconChevronRightOutline14 /> : <IconChevronDownOutline14 />}
        </button>
      )}
      {/* Pending interaction and own or descendant activity outrank the
          finished-but-unviewed reminder, which returns after activity stops
          and is cleared by opening the session. */}
      {(!flat || showStatus) && (
        <span className={css.slot}>
          {showStatus && <SessionStatusDots statuses={statuses} />}
        </span>
      )}
      <span className={css.title}>{title}</span>
      {(node.orphan === true || node.cycle === true) && (
        <span
          role="img"
          aria-label={node.orphan ? uiLabel('缺失父节点', 'Orphan session') : uiLabel('检测到环', 'Cycle detected')}
          data-orphan={node.orphan === true ? 'true' : undefined}
          data-cycle={node.cycle === true ? 'true' : undefined}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flex: 'none',
            marginLeft: 2,
            color: 'var(--dsw-alias-state-warning-primary)',
            fontSize: 12,
            cursor: 'help',
          }}
          title={node.orphan ? uiLabel('缺失父节点', 'Orphan session') : uiLabel('检测到环', 'Cycle detected')}
        >
          {node.orphan ? '⚠' : '↻'}
        </span>
      )}
      {(isCurrent || isCurrentCollapsedAncestor) && (
        <span
          {...(isCurrent ? { 'data-current-session': 'true' } : { 'data-current-collapsed': 'true' })}
          role="status"
          title={isCurrent
            ? uiLabel('当前会话', 'Current session')
            : uiLabel('当前工作区 · 当前折叠会话', 'Current workspace · collapsed session')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flex: '0 1 auto',
            marginLeft: 6,
            padding: '0 6px',
            height: 18,
            borderRadius: 999,
            fontSize: 11,
            lineHeight: 1,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: 'var(--dsw-alias-state-business-primary)',
            background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, transparent)',
          }}
        >
          {isCurrent
            ? uiLabel('当前', 'Current')
            : uiLabel('当前工作区 · 当前折叠会话', 'Current workspace · collapsed session')}
        </span>
      )}
      {branchChildren.length > 0 && (
        <Menu
          open={branchMenuOpen}
          onClose={() => { setBranchMenuOpen(false) }}
          items={branchMenuItems}
          onSelect={(id) => {
            setBranchMenuOpen(false)
            onOpen(id as SessionNode['id'])
          }}
          portal
          closeOnPointerLeave
          anchor={(
            <button
              type="button"
              className={clsx(css.iconButton, css.branchBadge)}
              aria-label={`${branchChildren.length} ${uiLabel('个直接分支 / 共', 'direct branches /')} ${totalDescendants} ${uiLabel('个分支', 'branches total')}`}
              title={`${branchChildren.length} ${uiLabel('个直接分支 / 共', 'direct branches /')} ${totalDescendants} ${uiLabel('个分支', 'branches total')}`}
              onClick={(e) => { e.stopPropagation(); setBranchMenuOpen(v => !v) }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2px',
                flex: 'none',
                minWidth: 24,
                minHeight: 22,
                color: 'var(--dsw-alias-label-tertiary)',
                fontSize: '12px',
                lineHeight: '17px',
                padding: '0 6px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                borderRadius: 6,
              }}
            >
              <IconBranchOutline16 size={11} />
              <span>{totalDescendants}</span>
            </button>
          )}
        />
      )}
      {row.hasActiveSchedule && <ActiveScheduleIndicator t={t} />}
      {/* A blank New Session row is a provisional placeholder: nothing has
          happened in it yet, so a "now" timestamp and the row verbs
          (rename/fork/archive) would all act on content that does not
          exist — both trailing cells stay off until the first prompt. */}
      {!row.blank && <span className={css.time}>{timeLabel(row.updatedAt, now, t)}</span>}
      {!row.blank && (
        <span className={css.rowActions}>
          {siblings.length > 1 && onJumpSibling !== undefined && (
            <button
              type="button"
              className={css.iconButton}
              aria-label={uiLabel('上一个分支', 'Previous branch')}
              onClick={(e) => { e.stopPropagation(); onJumpSibling('prev', node.id) }}
            >
              ↑
            </button>
          )}
          {siblings.length > 1 && onJumpSibling !== undefined && (
            <button
              type="button"
              className={css.iconButton}
              aria-label={uiLabel('下一个分支', 'Next branch')}
              onClick={(e) => { e.stopPropagation(); onJumpSibling('next', node.id) }}
            >
              ↓
            </button>
          )}
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={sessionMenuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              if (id === 'rename') onRename(node.id, row.title)
              if (id === 'fork') onFork(node.id)
              if (id === 'archive') onArchive(node.id)
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('actions.session.aria', { name: title })}
                onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
              >
                <IconEllipsisOutline16 />
              </button>
            )}
          />
        </span>
      )}
    </div>
  )
  return (
    <HoverCard
      anchor={ownRow}
      content={<SessionHoverContent node={node} now={now} t={t} path={path} />}
      disabled={menuOpen || branchMenuOpen || drag?.active === true}
      copyText={row.blank ? undefined : row.title}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}
