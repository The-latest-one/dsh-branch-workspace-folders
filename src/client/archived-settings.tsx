import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  IconArchiveOutlineRegular,
  IconBranchOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
  Modal,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ArchivedSettings.module.css'
import { buildSessionTree, flattenSessionTree, sortTreeByUpdatedAt, type TimeSortMode } from './vendor-runtime'

export interface ArchivedSessionDTO {
  sessionId: string
  parentId?: string
  title: string
  cwd?: string
  updatedAt?: number
  running?: boolean
  blank?: boolean
  parentKnown: boolean
  descendantCount: number
  missing?: boolean
}

const zh: Record<string, string> = {
  nav: '已归档会话',
  title: '已归档会话',
  empty: '没有已归档的会话。',
  loading: '加载中…',
  loadFailed: '加载失败',
  refresh: '刷新',
  restore: '恢复',
  restoring: '恢复中…',
  purge: '永久删除',
  purging: '删除中…',
  cancel: '取消',
  close: '关闭',
  purgeTitle: '永久删除整个分支？',
  purgeDesc: '将永久删除该根会话及其 {n} 个分支，日志文件不可恢复。',
  running: '运行中',
  branch: '分支',
  branch_one: '分支',
  branch_other: '分支',
  deleted: '已永久删除 {n} 个会话。',
  restored: '已恢复该会话。',
  workError: '操作失败',
  expandAll: '全部展开',
  collapseAll: '全部折叠',
  expandBranch: '展开分支',
  collapseBranch: '折叠分支',
  showMore: '显示更多 ({n})',
  selectAll: '全选',
  selectSession: '选择会话',
  restoreSelected: '恢复选中',
  deleteSelected: '删除选中',
  restoreBranch: '恢复整个分支',
  restoredSelected: '已恢复 {n} 个会话。',
  restoredBranch: '已恢复整个分支。',
  timeSortDefault: '默认',
  timeSortDesc: '时间 ↓',
  timeSortAsc: '时间 ↑',
}

const en: Record<string, string> = {
  nav: 'Archived sessions',
  title: 'Archived sessions',
  empty: 'No archived sessions.',
  loading: 'Loading…',
  loadFailed: 'Failed to load',
  refresh: 'Refresh',
  restore: 'Restore',
  restoring: 'Restoring…',
  purge: 'Delete permanently',
  purging: 'Deleting…',
  cancel: 'Cancel',
  close: 'Close',
  purgeTitle: 'Permanently delete this branch?',
  purgeDesc: 'This permanently deletes the root session and its {n} branch sessions. Log files cannot be recovered.',
  running: 'Running',
  branch: 'branches',
  branch_one: 'branch',
  branch_other: 'branches',
  deleted: 'Permanently deleted {n} sessions.',
  restored: 'Session restored.',
  workError: 'Operation failed',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  expandBranch: 'Expand branch',
  collapseBranch: 'Collapse branch',
  showMore: 'Show more ({n})',
  selectAll: 'Select all',
  selectSession: 'Select session',
  restoreSelected: 'Restore selected',
  deleteSelected: 'Delete selected',
  restoreBranch: 'Restore whole branch',
  restoredSelected: 'Restored {n} sessions.',
  restoredBranch: 'Restored the whole branch.',
  timeSortDefault: 'Default',
  timeSortDesc: 'Time ↓',
  timeSortAsc: 'Time ↑',
}

const dictionaries: Record<string, Record<string, string>> = { zh, en }

const NS = 'branch-workspace-archives'
const TIME_SORT_STORAGE_KEY = 'dsh.branch-workspace.archives.timeSort'

function formatTime(value: number | undefined): string {
  if (value == null) return ''
  const d = new Date(value)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function readStoredTimeSort(): TimeSortMode {
  try {
    if (typeof localStorage === 'undefined') return 'none'
    const raw = localStorage.getItem(TIME_SORT_STORAGE_KEY)
    return raw === 'updatedAt-desc' || raw === 'updatedAt-asc' || raw === 'none' ? raw : 'none'
  } catch {
    return 'none'
  }
}

function uiLabel(t: ((key: string, params?: any) => string) | undefined, zhKey: string, enKey: string): string {
  if (t) return t(zhKey) || zhKey
  return /^zh/i.test(typeof navigator !== 'undefined' ? navigator.language : '') ? zhKey : enKey
}

export function ArchivedSettingsSection(props: any): any {
  const t = props?.t
  const onMutated = props?.onMutated
  const label = (key: string, params?: any) => {
    if (typeof t === 'function') return t(key, params) ?? key
    const dict = /^zh/i.test(typeof navigator !== 'undefined' ? navigator.language : '') ? zh : en
    const template = dict[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in params ? String(params[name]) : ''))
  }

  const [sessions, setSessions] = useState<ArchivedSessionDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const [confirm, setConfirm] = useState<ArchivedSessionDTO | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [defaultsApplied, setDefaultsApplied] = useState(false)
  const [visibleLimit, setVisibleLimit] = useState(50)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [timeSort, setTimeSort] = useState<TimeSortMode>(readStoredTimeSort)
  const cycleTimeSort = () => {
    setTimeSort((current) => (current === 'none' ? 'updatedAt-desc' : current === 'updatedAt-desc' ? 'updatedAt-asc' : 'none'))
  }
  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(TIME_SORT_STORAGE_KEY, timeSort)
    } catch {
      // localStorage can be unavailable in private/embedded contexts; sorting still works in memory.
    }
  }, [timeSort])
  const timeSortLabel = timeSort === 'updatedAt-desc' ? label('timeSortDesc') : timeSort === 'updatedAt-asc' ? label('timeSortAsc') : label('timeSortDefault')

  const load = async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/branch-workspace/api/archives', { headers: { accept: 'application/json' }, signal })
      const json = await res.json().catch(() => null)
      if (!json || json.ok !== true) throw new Error(json?.error || label('loadFailed'))
      const nextSessions = Array.isArray(json.data?.sessions) ? json.data.sessions : []
      setSessions(nextSessions)
      const available = new Set(nextSessions.map((s: ArchivedSessionDTO) => s.sessionId))
      setSelectedIds((prev) => new Set(Array.from(prev).filter((id) => available.has(id))))
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const treeNodes = useMemo(
    () =>
      sessions.map((s) => ({
        id: s.sessionId,
        parentId: s.parentId,
        title: s.title,
        updatedAt: s.updatedAt,
        running: s.running,
        blank: s.blank,
        children: [] as any[],
      })),
    [sessions],
  )
  const roots = useMemo(() => {
    const nodes = treeNodes.map((n) => ({ ...n, children: [] as any[] }))
    const built = buildSessionTree(nodes)
    return sortTreeByUpdatedAt(built, timeSort)
  }, [treeNodes, timeSort])

  useEffect(() => {
    if (defaultsApplied || roots.length === 0) return
    const initial = new Set<string>()
    for (const root of roots) {
      if (root.children && root.children.length > 0) initial.add(root.id)
    }
    setCollapsedIds(initial)
    setDefaultsApplied(true)
  }, [roots, defaultsApplied])

  useEffect(() => {
    if (!defaultsApplied) return
    const valid = new Set(roots.map((r: any) => r.id))
    setCollapsedIds((prev) => {
      let changed = false
      const next = new Set<string>()
      for (const id of prev) if (valid.has(id)) next.add(id); else changed = true
      return changed ? next : prev
    })
  }, [roots, defaultsApplied])

  const rows = useMemo(() => flattenSessionTree(roots, 0, [], new Set(), collapsedIds), [roots, collapsedIds])
  const visibleRows = useMemo(() => rows.slice(0, visibleLimit), [rows, visibleLimit])
  const byId = useMemo(() => new Map(sessions.map((s) => [s.sessionId, s])), [sessions])

  const selectedRows = rows.filter(({ node }: { node: any }) => selectedIds.has(node.id))
  const selectedRootRows = selectedRows.filter(({ node }: { node: any }) => {
    const dto = byId.get(node.id)
    return !!dto && !dto.parentKnown
  })
  const allSelected = rows.length > 0 && rows.every(({ node }: { node: any }) => selectedIds.has(node.id))
  const toggleSelect = (sessionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }
  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(rows.map(({ node }: { node: any }) => node.id)))
  }

  const branchRoots = useMemo(() => roots.filter((root: any) => root.children && root.children.length > 0), [roots])
  const allCollapsed = branchRoots.length > 0 && branchRoots.every((root: any) => collapsedIds.has(root.id))
  const toggleCollapsed = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const expandAll = () => {
    const total = rows.length
    setCollapsedIds(new Set())
    setVisibleLimit((limit) => Math.max(limit, total))
  }
  const collapseAll = () => {
    setCollapsedIds(new Set(branchRoots.map((root: any) => root.id)))
    setVisibleLimit(50)
  }
  const showMore = () => setVisibleLimit((limit) => limit + 50)

  const runAction = async (sessionId: string, path: string, successText: string) => {
    setBusyId(sessionId)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const json = await res.json().catch(() => null)
      if (!json || json.ok !== true) throw new Error(json?.error || label('workError'))
      setNotice(successText)
      setConfirm(null)
      // The sidebar keeps its own sessions/workspaces client stores. After
      // restore/purge, refresh those stores so a deleted session does not
      // linger as a stale "Ungrouped" partition until a full browser reload.
      if (typeof onMutated === 'function') {
        try {
          await onMutated()
        } catch (refreshError) {
          console.error('[dsh-branch-workspace-folders] sidebar refresh after archive mutation failed', refreshError)
        }
      }
      await load()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusyId(null)
    }
  }

  const runBatchAction = async (path: string, payload: Record<string, unknown>, successText: string) => {
    setBatchBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => null)
      if (!json || json.ok !== true) throw new Error(json?.error || label('workError'))
      setNotice(successText)
      setSelectedIds(new Set())
      // The sidebar keeps its own sessions/workspaces client stores. After
      // restore/purge, refresh those stores so a deleted session does not
      // linger as a stale "Ungrouped" partition until a full browser reload.
      if (typeof onMutated === 'function') {
        try {
          await onMutated()
        } catch (refreshError) {
          console.error('[dsh-branch-workspace-folders] sidebar refresh after archive mutation failed', refreshError)
        }
      }
      await load()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBatchBusy(false)
    }
  }

  const restore = (sessionId: string) => runAction(sessionId, '/branch-workspace/api/restore', label('restored'))
  const purge = (target: ArchivedSessionDTO) =>
    runAction(target.sessionId, '/branch-workspace/api/purge', label('deleted', { n: target.descendantCount + 1 }))
  const restoreBranch = (target: ArchivedSessionDTO) => runAction(target.sessionId, '/branch-workspace/api/restore-branch', label('restoredBranch'))
  const restoreSelected = () => runBatchAction(
    '/branch-workspace/api/restore-batch',
    { sessionIds: Array.from(selectedIds) },
    label('restoredSelected', { n: selectedIds.size }),
  )
  const deleteSelected = () => runBatchAction(
    '/branch-workspace/api/purge-batch',
    { sessionIds: selectedRootRows.map(({ node }: { node: any }) => node.id) },
    label('deleted', {
      n: selectedRootRows.reduce((sum: number, { node }: { node: any }) => sum + ((byId.get(node.id)?.descendantCount ?? 0) + 1), 0),
    }),
  )

  if (loading && sessions.length === 0) {
    return (
      <div className={css.archiveSettings}>
        <div className={css.header}>
          <IconArchiveOutlineRegular />
          <h2>{label('title')}</h2>
        </div>
        <p className={css.empty}>{label('loading')}</p>
      </div>
    )
  }

  return (
    <div className={css.archiveSettings}>
      <div className={css.header}>
        <IconArchiveOutlineRegular />
        <h2>{label('title')}</h2>
        <Button size="sm" variant="ghost" onClick={cycleTimeSort} disabled={batchBusy || !!busyId}>
          {timeSortLabel}
        </Button>
        {branchRoots.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={allCollapsed ? expandAll : collapseAll}>
            {allCollapsed ? label('expandAll') : label('collapseAll')}
          </Button>
        ) : null}
      </div>
      {error ? <p className={css.error} role="alert">{error}</p> : null}
      {notice ? <p className={css.notice} role="status">{notice}</p> : null}
      {!loading && sessions.length === 0 ? <p className={css.empty}>{label('empty')}</p> : null}
      {rows.length > 0 ? (
        <>
          <div className={css.toolbar}>
            <Checkbox
              checked={allSelected}
              onChange={toggleSelectAll}
              disabled={batchBusy || !!busyId}
              label={label('selectAll')}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={selectedIds.size === 0 || batchBusy || !!busyId}
              onClick={restoreSelected}
            >
              {label('restoreSelected')}{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={selectedRootRows.length === 0 || batchBusy || !!busyId}
              onClick={deleteSelected}
            >
              {label('deleteSelected')}{selectedRootRows.length > 0 ? ` (${selectedRootRows.length})` : ''}
            </Button>
          </div>
          <ul className={css.list} role="tree" aria-label={label('title')}>
            {visibleRows.map(({ node, depth }: { node: any; depth: number }) => {
              const dto = byId.get(node.id)
              const descendantCount = dto?.descendantCount ?? 0
              const collapsed = collapsedIds.has(node.id)
              const expandable = !!node.children && node.children.length > 0
              return (
                <li
                  key={node.id}
                  role="treeitem"
                  aria-level={depth + 1}
                  aria-selected={selectedIds.has(node.id)}
                  aria-expanded={expandable ? !collapsed : undefined}
                  className={css.row}
                  style={{ paddingLeft: 8 + depth * 16 }}
                >
                  <Checkbox
                    checked={selectedIds.has(node.id)}
                    onChange={() => toggleSelect(node.id)}
                    disabled={batchBusy || !!busyId}
                    label=""
                    className={css.itemCheckbox}
                    title={`${label('selectSession')}: ${node.title || node.id}`}
                  />
                  {expandable ? (
                    <button
                      type="button"
                      className={css.toggle}
                      tabIndex={-1}
                      aria-hidden="true"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleCollapsed(node.id)
                      }}
                    >
                      {collapsed ? <IconChevronRightOutlineRegular /> : <IconChevronDownOutlineRegular />}
                    </button>
                  ) : (
                    <span className={css.toggleSpacer} aria-hidden="true" />
                  )}
                  <span className={css.title} title={node.title}>
                    {node.title || node.id}
                  </span>
                  {descendantCount > 0 ? (
                    <span className={css.badge} aria-label={`${descendantCount} ${descendantCount===1 ? label('branch_one') : label('branch_other')}`}>
                      <IconBranchOutlineRegular size={11} />
                      {descendantCount}
                    </span>
                  ) : null}
                  {node.running ? <StateDot state="ongoing" /> : null}
                  <span className={css.time}>{formatTime(node.updatedAt)}</span>
                  <span className={css.actions}>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<IconRefreshOutlineRegular />}
                      disabled={busyId === node.id || batchBusy}
                      onClick={() => restore(node.id)}
                    >
                      {busyId === node.id ? label('restoring') : label('restore')}
                    </Button>
                    {dto && !dto.parentKnown && descendantCount > 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<IconBranchOutlineRegular />}
                        disabled={busyId === node.id || batchBusy}
                        onClick={() => restoreBranch(dto)}
                      >
                        {label('restoreBranch')}
                      </Button>
                    ) : null}
                    {dto && !dto.parentKnown ? (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<IconTrashOutlineRegular />}
                        disabled={busyId === node.id}
                        onClick={() => setConfirm(dto)}
                      >
                        {label('purge')}
                      </Button>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>
          {rows.length > visibleLimit ? (
            <Button className={css.showMore} variant="ghost" onClick={showMore}>
              {label('showMore', { n: rows.length - visibleLimit })}
            </Button>
          ) : null}
        </>
      ) : null}

      <Modal
        open={!!confirm}
        onClose={() => { if (!busyId) setConfirm(null) }}
        title={label('purgeTitle')}
        closeLabel={label('close')}
        description={confirm ? label('purgeDesc', { n: confirm.descendantCount + 1 }) : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={!!busyId}>
              {label('cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => confirm && purge(confirm)}
              disabled={!confirm || (confirm ? busyId === confirm.sessionId : false)}
            >
              {busyId ? label('purging') : label('purge')}
            </Button>
          </>
        }
      >
        <p>{confirm?.title}</p>
      </Modal>
    </div>
  )
}

export const archivedLocales = { zh, en }
export const archivedNamespace = NS
export { uiLabel, dictionaries }