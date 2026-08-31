import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconArchiveOutline20,
  IconBranchOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconRefreshOutline16,
  IconTrashOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { buildSessionTree, flattenSessionTree } from './vendor-runtime'

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
  branch: '分支',
  deleted: '已永久删除 {n} 个会话。',
  restored: '已恢复该会话。',
  workError: '操作失败',
  expandAll: '全部展开',
  collapseAll: '全部折叠',
  expandBranch: '展开分支',
  collapseBranch: '折叠分支',
  showMore: '显示更多',
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
  branch: 'branches',
  deleted: 'Permanently deleted {n} sessions.',
  restored: 'Session restored.',
  workError: 'Operation failed',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  expandBranch: 'Expand branch',
  collapseBranch: 'Collapse branch',
  showMore: 'Show more',
}

const dictionaries: Record<string, Record<string, string>> = { zh, en }

const NS = 'branch-workspace-archives'
const ARCHIVED_STYLE_ID = 'dsh-branch-workspace-folders-archives-css'
let archivedStyleCount = 0

function formatTime(value: number | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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
  const [confirm, setConfirm] = useState<ArchivedSessionDTO | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [defaultsApplied, setDefaultsApplied] = useState(false)
  const [visibleLimit, setVisibleLimit] = useState(50)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/branch-workspace/api/archives', { headers: { accept: 'application/json' } })
      const json = await res.json().catch(() => null)
      if (!json || json.ok !== true) throw new Error(json?.error || label('loadFailed'))
      setSessions(Array.isArray(json.data?.sessions) ? json.data.sessions : [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    archivedStyleCount += 1
    if (archivedStyleCount === 1) {
      const style = document.createElement('style')
      style.id = ARCHIVED_STYLE_ID
      style.textContent = `
.bwf-archive-settings{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary)}
.bwf-archive-header{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.bwf-archive-header h2{margin:0;font-size:16px;line-height:24px;font-weight:600}
.bwf-archive-empty{color:var(--dsw-alias-label-secondary);padding:12px 0}
.bwf-archive-error{color:var(--dsw-alias-danger-fill, #d92d20);padding:8px 0}
.bwf-archive-notice{color:var(--dsw-alias-label-secondary);padding:8px 0}
.bwf-archive-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.bwf-archive-row{display:flex;align-items:center;gap:8px;min-height:32px;padding:4px 8px;border-radius:6px}
.bwf-archive-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.bwf-archive-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bwf-archive-badge{display:inline-flex;align-items:center;gap:2px;color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap}
.bwf-archive-time{color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap}
.bwf-archive-actions{display:inline-flex;align-items:center;gap:4px;opacity:.85}
.bwf-archive-toggle{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;padding:0;border:none;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-radius:6px}
.bwf-archive-show-more{width:100%;margin-top:4px}
`
      document.head.appendChild(style)
    }
    return () => {
      archivedStyleCount -= 1
      if (archivedStyleCount === 0) {
        const el = document.getElementById(ARCHIVED_STYLE_ID)
        el?.remove()
      }
    }
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
    return buildSessionTree(nodes)
  }, [treeNodes])

  useEffect(() => {
    if (defaultsApplied || roots.length === 0) return
    const initial = new Set<string>()
    for (const root of roots) {
      if (root.children && root.children.length > 0) initial.add(root.id)
    }
    setCollapsedIds(initial)
    setDefaultsApplied(true)
  }, [roots, defaultsApplied])

  const rows = useMemo(() => flattenSessionTree(roots, 0, [], new Set(), collapsedIds), [roots, collapsedIds])
  const visibleRows = useMemo(() => rows.slice(0, visibleLimit), [rows, visibleLimit])
  const byId = useMemo(() => new Map(sessions.map((s) => [s.sessionId, s])), [sessions])

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
    setCollapsedIds(new Set())
    setVisibleLimit((limit) => Math.max(limit, rows.length))
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

  const restore = (sessionId: string) => runAction(sessionId, '/branch-workspace/api/restore', label('restored'))
  const purge = (target: ArchivedSessionDTO) =>
    runAction(target.sessionId, '/branch-workspace/api/purge', label('deleted', { n: target.descendantCount + 1 }))

  if (loading && sessions.length === 0) {
    return (
      <div className="bwf-archive-settings">
        <div className="bwf-archive-header">
          <IconArchiveOutline20 />
          <h2>{label('title')}</h2>
        </div>
        <p className="bwf-archive-empty">{label('loading')}</p>
      </div>
    )
  }

  return (
    <div className="bwf-archive-settings">
      <div className="bwf-archive-header">
        <IconArchiveOutline20 />
        <h2>{label('title')}</h2>
        <Button size="sm" variant="ghost" icon={<IconRefreshOutline16 />} onClick={load} disabled={loading}>
          {label('refresh')}
        </Button>
        {branchRoots.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={allCollapsed ? expandAll : collapseAll}>
            {allCollapsed ? label('expandAll') : label('collapseAll')}
          </Button>
        ) : null}
      </div>
      {error ? <p className="bwf-archive-error" role="alert">{error}</p> : null}
      {notice ? <p className="bwf-archive-notice" role="status">{notice}</p> : null}
      {!loading && sessions.length === 0 ? <p className="bwf-archive-empty">{label('empty')}</p> : null}
      {rows.length > 0 ? (
        <>
          <ul className="bwf-archive-list" role="tree" aria-label={label('title')}>
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
                  aria-selected={false}
                  aria-expanded={expandable ? !collapsed : undefined}
                  className="bwf-archive-row"
                  style={{ paddingLeft: 8 + depth * 20 }}
                >
                  {expandable ? (
                    <button
                      type="button"
                      className="bwf-archive-toggle"
                      aria-label={collapsed ? label('expandBranch') : label('collapseBranch')}
                      aria-expanded={!collapsed}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleCollapsed(node.id)
                      }}
                    >
                      {collapsed ? <IconChevronRightOutline14 /> : <IconChevronDownOutline14 />}
                    </button>
                  ) : depth > 0 ? <span style={{ width: 20, flex: 'none' }} /> : null}
                  {depth > 0 && !expandable ? <span style={{ color: 'var(--dsw-alias-label-tertiary)' }}>└ </span> : null}
                  <span className="bwf-archive-title" title={node.title}>
                    {node.title || node.id}
                  </span>
                  {descendantCount > 0 ? (
                    <span className="bwf-archive-badge" aria-label={`${descendantCount} ${label('branch')}`}>
                      <IconBranchOutline16 size={11} />
                      {descendantCount}
                    </span>
                  ) : null}
                  {node.running ? <span aria-label="running" style={{ color: 'var(--dsw-alias-success-fill, #12b76a)' }}>●</span> : null}
                  <span className="bwf-archive-time">{formatTime(node.updatedAt)}</span>
                  <span className="bwf-archive-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<IconRefreshOutline16 />}
                      disabled={busyId === node.id}
                      onClick={() => restore(node.id)}
                    >
                      {busyId === node.id ? label('restoring') : label('restore')}
                    </Button>
                    {dto && !dto.parentKnown ? (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<IconTrashOutline16 />}
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
            <Button className="bwf-archive-show-more" variant="ghost" onClick={showMore}>
              {label('showMore')} ({rows.length - visibleLimit})
            </Button>
          ) : null}
        </>
      ) : null}

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={label('purgeTitle')}
        closeLabel={label('close')}
        description={confirm ? label('purgeDesc', { n: confirm.descendantCount }) : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={!!busyId}>
              {label('cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => confirm && purge(confirm)}
              disabled={!confirm || !!busyId}
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