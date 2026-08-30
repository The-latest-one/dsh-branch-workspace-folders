/**
 * dsh-branch-workspace-folders — host half.
 *
 * Reads DSH session logs/headers and exposes a lightweight HTTP API that
 * groups all forked sessions under their root session. The client sidebar
 * consumes this API to render "branch folders" in the left workspace area.
 */
import { readdirSync, existsSync, statSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { readSessionHeader } from './host/zstd.js'
import { parseSessionLog, type ParsedSession } from './host/session-log.js'
import { readSessionLogAsync } from './host/zstd.js'
import { collectFamilyIds, isForkChildLike } from './host/lineage.js'

export const name = 'dsh-branch-workspace-folders'

interface DshLogger {
  info?: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
}

interface DshPersistenceSession {
  id: string
  [key: string]: unknown
}

interface DshPersistence {
  list(): Promise<DshPersistenceSession[]>
  locate?(header: unknown): { path: string } | undefined
  readFrom?(id: string, fromSeq: number): Promise<{ meta: unknown; events: unknown[] }>
}

interface AppContext {
  dshHomePath?: (...segments: string[]) => string
  logger?: DshLogger
  sessionPersistence?: DshPersistence
  inject?: (services: string[], callback: (wctx: any) => unknown) => (() => void) | void
  get?: (name: string) => any
}

function isLoopback(remote: string): boolean {
  return remote.startsWith('127.') || remote === '::1' || remote === '::ffff:127.0.0.1'
}

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

function homeSessionsRoot(ctx?: AppContext): string {
  if (ctx && typeof ctx.dshHomePath === 'function') {
    try {
      const resolved = ctx.dshHomePath('sessions')
      if (resolved) return String(resolved)
    } catch {
      // fall through
    }
  }
  const env = process.env.DSH_HOME
  const root = env && env.trim() ? expandHome(env.trim()) : join(homedir(), '.dsh')
  return join(root, 'sessions')
}

interface SessionLocation {
  sessionId: string
  workspace: string
  file: string
  header: any
}

interface SessionFileRef {
  sessionId: string
  workspace: string
  file: string
}

const SESSIONS_CACHE_TTL_MS = 2000
let sessionsCache: { root: string; at: number; mtimeMs: number; signature: string; locations: SessionLocation[] } | null = null
let persistenceCache: { at: number; locations: SessionLocation[] } | null = null
interface ClustersCache {
  at: number
  root: string
  rootMtimeMs: number
  signature: string
  clusters: BranchClusterDTO[]
}
const CLUSTERS_CACHE_TTL_MS = 5000
const ARCHIVES_CACHE_TTL_MS = 10000
const MAX_CONCURRENT_PARSES = 4
let clustersCache: ClustersCache | null = null
interface ArchivesCache {
  at: number
  archivedKey: string
  sessions: ArchivedSessionDTO[]
}
let archivesCache: ArchivesCache | null = null

/** Cheap filesystem fingerprint: directory entries + per-file mtime, no header IO. */
function sessionFilesSignature(files: SessionFileRef[]): string {
  let maxMtimeMs = 0
  for (const ref of files) {
    try {
      const st = statSync(ref.file)
      if (st.mtimeMs > maxMtimeMs) maxMtimeMs = st.mtimeMs
    } catch {
      // ignore unreadable files
    }
  }
  return `${files.length}:${maxMtimeMs}`
}

/** List session log paths without reading any session header. */
function listSessionFiles(root: string): SessionFileRef[] {
  const files: SessionFileRef[] = []
  if (!existsSync(root)) return files
  let workspaces: string[] = []
  try {
    workspaces = readdirSync(root)
  } catch {
    return files
  }
  for (const workspace of workspaces) {
    const workspaceDir = join(root, workspace)
    let entries: string[] = []
    try {
      entries = readdirSync(workspaceDir)
    } catch {
      continue
    }
    for (const sessionId of entries) {
      const file = join(workspaceDir, sessionId, 'session.jsonl.zstd')
      if (!existsSync(file)) continue
      files.push({ sessionId, workspace, file })
    }
  }
  return files
}

function discoverSessionsFromFiles(files: SessionFileRef[]): SessionLocation[] {
  const locations: SessionLocation[] = []
  for (const ref of files) {
    try {
      const header = readSessionHeader(ref.file)
      locations.push({
        sessionId: String(header.id ?? ref.sessionId),
        workspace: ref.workspace,
        file: ref.file,
        header,
      })
    } catch {
      // ignore corrupt/unreadable logs
    }
  }
  return locations
}

function discoverSessions(root: string): SessionLocation[] {
  return discoverSessionsFromFiles(listSessionFiles(root))
}

function discoverSessionsCached(root: string): SessionLocation[] {
  let mtimeMs = 0
  try {
    mtimeMs = statSync(root).mtimeMs
  } catch {
    // ignore
  }
  const files = listSessionFiles(root)
  const signature = sessionFilesSignature(files)
  const now = Date.now()
  if (
    sessionsCache &&
    sessionsCache.root === root &&
    sessionsCache.mtimeMs === mtimeMs &&
    sessionsCache.signature === signature &&
    now - sessionsCache.at < SESSIONS_CACHE_TTL_MS
  ) {
    return sessionsCache.locations
  }
  const locations = discoverSessionsFromFiles(files)
  sessionsCache = { root, at: now, mtimeMs, signature, locations }
  return locations
}

async function parseSessionAt(
  location: SessionLocation,
  persistence: DshPersistence | undefined,
  logger?: DshLogger,
): Promise<ParsedSession> {
  if (persistence && typeof persistence.readFrom === 'function') {
    try {
      const { meta, events } = await persistence.readFrom(location.sessionId, 0)
      return parseSessionLog(events as any[], meta as any)
    } catch (error) {
      logger?.warn?.('[branch-workspace] sessionPersistence.readFrom failed, fallback to file read:', location.sessionId, String(error))
    }
  }
  const events = await readSessionLogAsync(location.file)
  return parseSessionLog(events, location.header)
}

async function discoverSessionLocations(
  ctx: AppContext,
  root: string,
  persistence: DshPersistence | undefined,
): Promise<SessionLocation[]> {
  if (persistence && typeof persistence.list === 'function') {
    const now = Date.now()
    if (persistenceCache && now - persistenceCache.at < SESSIONS_CACHE_TTL_MS) {
      return persistenceCache.locations
    }
    try {
      const headers = await persistence.list()
      if (Array.isArray(headers)) {
        const locations: SessionLocation[] = []
        for (const header of headers) {
          const located = persistence.locate?.(header)
          const file = located?.path
          if (!file || !existsSync(file)) continue
          locations.push({
            sessionId: String(header.id ?? ''),
            workspace: '',
            file,
            header,
          })
        }
        if (locations.length > 0) {
          persistenceCache = { at: now, locations }
          return locations
        }
      }
    } catch (error) {
      ctx.logger?.warn?.('[branch-workspace] sessionPersistence.list failed, fallback to fs scan', String(error))
    }
  }
  return discoverSessionsCached(root)
}

export interface ClusterSessionDTO {
  sessionId: string
  parentId?: string
  title: string
  origin?: string
  running?: boolean
  blank?: boolean
  updatedAt?: number
  cwd?: string
}

export interface BranchClusterDTO {
  rootSessionId: string
  rootTitle: string
  sessions: ClusterSessionDTO[]
}

function toClusterSession(s: ParsedSession): ClusterSessionDTO {
  return {
    sessionId: s.sessionId,
    parentId: s.parentId,
    title: s.title || s.sessionId,
    origin: s.origin,
    cwd: s.cwd,
    running: s.running,
    blank: s.blank,
    updatedAt: s.lastActiveAt,
  }
}

export function buildClusters(parsed: ParsedSession[]): BranchClusterDTO[] {
  const byId = new Map(parsed.map((s) => [s.sessionId, s]))
  const childrenOf = new Map<string, string[]>()
  const roots: ParsedSession[] = []

  for (const s of parsed) {
    const parent = isForkChildLike(s) && byId.has(s.parentId!) ? s.parentId! : undefined
    if (parent) {
      const list = childrenOf.get(parent) ?? []
      list.push(s.sessionId)
      childrenOf.set(parent, list)
    } else {
      roots.push(s)
    }
  }

  const sortedRoots = [...roots].sort(
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.sessionId.localeCompare(b.sessionId),
  )

  const clusters: BranchClusterDTO[] = []
  const seen = new Set<string>()

  for (const root of sortedRoots) {
    if (seen.has(root.sessionId)) continue
    const sessions: ClusterSessionDTO[] = []
    const queue = [root.sessionId]
    const localSeen = new Set<string>()
    let qi = 0
    while (qi < queue.length) {
      const id = queue[qi++]!
      if (localSeen.has(id)) continue
      localSeen.add(id)
      seen.add(id)
      const s = byId.get(id)
      if (s) sessions.push(toClusterSession(s))
      for (const child of childrenOf.get(id) ?? []) {
        if (!localSeen.has(child) && !seen.has(child)) queue.push(child)
      }
    }
    clusters.push({
      rootSessionId: root.sessionId,
      rootTitle: root.title || root.sessionId,
      sessions,
    })
  }

  // Safety net: any session not reached by a root (e.g. malformed cycles) gets
  // its own top-level cluster, and its reachable descendants are collected too.
  for (const s of parsed) {
    if (seen.has(s.sessionId)) continue
    const sessions: ClusterSessionDTO[] = []
    const queue = [s.sessionId]
    const localSeen = new Set<string>()
    let qi = 0
    while (qi < queue.length) {
      const id = queue[qi++]!
      if (localSeen.has(id)) continue
      localSeen.add(id)
      seen.add(id)
      const current = byId.get(id)
      if (current) sessions.push(toClusterSession(current))
      for (const child of childrenOf.get(id) ?? []) {
        if (!localSeen.has(child) && !seen.has(child)) queue.push(child)
      }
    }
    clusters.push({
      rootSessionId: s.sessionId,
      rootTitle: s.title || s.sessionId,
      sessions,
    })
  }

  return clusters
}

async function parseAllSessions(
  locations: SessionLocation[],
  persistence: DshPersistence | undefined,
  logger?: DshLogger,
): Promise<ParsedSession[]> {
  const parsed: ParsedSession[] = []
  let index = 0
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT_PARSES, locations.length) }, async () => {
    while (index < locations.length) {
      const current = index++
      const loc = locations[current]
      try {
        parsed.push(await parseSessionAt(loc, persistence, logger))
      } catch (error) {
        logger?.warn?.('[branch-workspace] skip unreadable session:', loc.sessionId, String(error))
      }
    }
  })
  await Promise.all(workers)
  return parsed
}

/**
 * Filter clusters by current workspace without breaking the fork tree.
 *
 * A branch may live in a different cwd from its root session. Filtering
 * individual sessions before clustering would split that tree, so we keep the
 * complete cluster and only decide whether the cluster is relevant to the
 * requested workspace.
 */
function filterClustersByCwd(clusters: BranchClusterDTO[], cwd?: string): BranchClusterDTO[] {
  if (!cwd) return clusters
  return clusters.filter((cluster) => cluster.sessions.some((session) => session.cwd === cwd))
}

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

async function readBody(req: any): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function invalidateCaches(): void {
  sessionsCache = null
  persistenceCache = null
  clustersCache = null
  archivesCache = null
}

function getWorkspaceRegistry(ctx: AppContext, wctx: any): any {
  try {
    return ctx.get?.('workspaceRegistry') ?? wctx?.workspaceRegistry ?? ctx.get?.('workspaces')
  } catch {
    return wctx?.workspaceRegistry ?? undefined
  }
}

function countParsedDescendants(items: ParsedSession[], sessionId: string): number {
  const childrenOf = new Map<string, string[]>()
  for (const item of items) {
    if (!item.parentId || item.parentId === item.sessionId) continue
    const list = childrenOf.get(item.parentId) ?? []
    list.push(item.sessionId)
    childrenOf.set(item.parentId, list)
  }
  let count = 0
  const seen = new Set<string>([sessionId])
  const stack = childrenOf.get(sessionId) ?? []
  while (stack.length > 0) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    count += 1
    const next = childrenOf.get(id)
    if (next) {
      for (const child of next) stack.push(child)
    }
  }
  return count
}

async function listArchivedSessions(
  ctx: AppContext,
  wctx: any,
  getPersistence: () => DshPersistence | undefined,
): Promise<ArchivedSessionDTO[]> {
  const registry = getWorkspaceRegistry(ctx, wctx)
  const archivedIds = Array.isArray(registry?.archivedSessionIds) ? registry.archivedSessionIds : []
  if (archivedIds.length === 0) {
    archivesCache = null
    return []
  }

  const archivedKey = `${archivedIds.length}:${archivedIds.join(',')}`
  const now = Date.now()
  if (archivesCache && archivesCache.archivedKey === archivedKey && now - archivesCache.at < ARCHIVES_CACHE_TTL_MS) {
    return archivesCache.sessions
  }

  const root = homeSessionsRoot(wctx)
  const locations = await discoverSessionLocations(wctx, root, getPersistence())
  const parsed = await parseAllSessions(locations, getPersistence(), ctx.logger)
  const byId = new Map(parsed.map((s) => [s.sessionId, s]))
  const liveService = ctx.get?.('sessions')
  const result: ArchivedSessionDTO[] = []

  for (const id of archivedIds) {
    const s = byId.get(id)
    if (!s) {
      result.push({
        sessionId: id,
        title: id,
        parentKnown: false,
        descendantCount: 0,
        missing: true,
      })
      continue
    }
    const parentKnown = !!s.parentId && s.parentId !== id && (byId.has(s.parentId) || !!liveService?.get?.(s.parentId))
    const descendantCount = countParsedDescendants(parsed, id)

    result.push({
      sessionId: id,
      parentId: s.parentId,
      title: s.title || id,
      cwd: s.cwd,
      updatedAt: s.lastActiveAt,
      running: s.running,
      blank: s.blank,
      parentKnown,
      descendantCount,
    })
  }

  archivesCache = { at: Date.now(), archivedKey, sessions: result }
  return result
}

async function purgeSession(
  ctx: AppContext,
  wctx: any,
  sessionId: string,
  getPersistence: () => DshPersistence | undefined,
): Promise<{ purged: number }> {
  const registry = getWorkspaceRegistry(ctx, wctx)
  if (!registry) throw new Error('workspace registry unavailable')
  const archivedIds = Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds : []
  if (!archivedIds.includes(sessionId)) throw new Error('只能永久删除已归档的根会话')
  const root = homeSessionsRoot(wctx)
  const locations = await discoverSessionLocations(wctx, root, getPersistence())
  const parsed = await parseAllSessions(locations, getPersistence(), ctx.logger)
  const byId = new Map(parsed.map((s) => [s.sessionId, s]))
  // Allow metadata-only purge for archived ids whose log directory is already
  // missing/corrupt; `collectFamilyIds` still returns the id itself and the
  // later removal from archivedSessionIds cleans the durable state.
  const target = byId.get(sessionId) ?? { sessionId, parentId: undefined, title: sessionId } as any

  // Permanent delete is intentionally root-only: it removes the whole fork
  // tree. Refuse requests that name a child to avoid deleting an unarchived
  // root the user may not have intended to destroy.
  const liveService = ctx.get?.('sessions')
  if (target.parentId && target.parentId !== sessionId && (byId.has(target.parentId) || !!liveService?.get?.(target.parentId))) {
    throw new Error('只能删除根会话（该会话存在父会话）')
  }

  const family = collectFamilyIds(parsed, sessionId)
  for (const id of family) {
    if (liveService?.get?.(id)) {
      throw new Error(`会话正在运行或已加载，无法永久删除: ${id}`)
    }
  }

  const fileBySession = new Map(locations.map((l) => [l.sessionId, l.file]))
  const paths: { id: string; dir: string }[] = []
  for (const id of family) {
    const file = fileBySession.get(id)
    if (file) paths.push({ id, dir: dirname(file) })
  }

  const trashRoot = join(root, '..', '.trash-sessions')
  await mkdir(trashRoot, { recursive: true })
  const moved: { dir: string; trashDir: string }[] = []

  const rollbackMoves = async () => {
    for (const m of moved.reverse()) {
      try {
        await rename(m.trashDir, m.dir)
      } catch {
        // best-effort rollback
      }
    }
  }

  for (const p of paths) {
    const trashDir = join(trashRoot, p.id)
    try {
      await rename(p.dir, trashDir)
      moved.push({ dir: p.dir, trashDir })
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        await rollbackMoves()
        throw new Error(`移动会话目录失败: ${String(error?.message ?? error)}`)
      }
    }
  }

  try {
    const writeArchived = async (ids: string[]) => {
      const persist = async (state: any) => {
        if (!state) throw new Error('workspace registry state unavailable')
        if (registry?.setState) {
          await registry.setState({ ...state, archivedSessionIds: ids })
        } else if (registry?.global?.set) {
          await registry.global.set({ ...state, archivedSessionIds: ids })
        } else {
          throw new Error('workspace registry cannot persist archived state')
        }
      }
      if (registry && typeof registry.enqueueOperation === 'function') {
        await registry.enqueueOperation(async () => {
          const state = registry.requireState?.()
          if (!state) throw new Error('workspace registry state unavailable')
          await persist(state)
        })
      } else {
        const state = registry?.requireState?.() ?? registry?.global?.get?.()
        await persist(state)
      }
    }

    const currentState = registry?.requireState?.() ?? registry?.global?.get?.()
    const originalArchivedIds = Array.isArray(currentState?.archivedSessionIds) ? currentState.archivedSessionIds : []
    const nextArchivedIds = originalArchivedIds.filter((id: string) => !family.has(id))
    await writeArchived(nextArchivedIds)

    const workspaces = registry?.list?.() ?? []
    const detached: { ws: any; id: string }[] = []
    try {
      for (const ws of workspaces) {
        for (const id of family) {
          if (Array.isArray(ws.sessionIds) && ws.sessionIds.includes(id)) {
            try {
              await ws.detachSession?.(id)
              detached.push({ ws, id })
            } catch {
              // The entity mutator filters invalid/missing paths; ignore if a
              // session is no longer accounted on this workspace.
            }
          }
        }
      }
    } catch (detachError) {
      // Best-effort rollback: restore archived ids, move directories back, then
      // re-attach already-detached sessions (attach needs the original dirs).
      try {
        await writeArchived(originalArchivedIds)
      } catch {
        // ignore secondary rollback failure
      }
      await rollbackMoves()
      for (const d of detached) {
        try {
          await d.ws.attachSession?.(d.id)
        } catch {
          // best-effort rollback
        }
      }
      throw detachError
    }

    for (const m of moved) {
      try {
        await rm(m.trashDir, { recursive: true, force: true })
      } catch (error) {
        ctx.logger?.warn?.(
          '[branch-workspace] failed to remove trash dir; keeping it for manual cleanup:',
          m.trashDir,
          String(error),
        )
      }
    }
    invalidateCaches()
    return { purged: family.size }
  } catch (error) {
    await rollbackMoves()
    throw error
  }
}

async function restoreSession(ctx: AppContext, wctx: any, sessionId: string): Promise<void> {
  const registry = getWorkspaceRegistry(ctx, wctx)
  if (!registry) throw new Error('workspace registry unavailable')

  const persist = async (state: any) => {
    if (!state) throw new Error('workspace registry state unavailable')
    const next = {
      ...state,
      archivedSessionIds: (state.archivedSessionIds ?? []).filter((id: string) => id !== sessionId),
    }
    if (registry?.setState) {
      await registry.setState(next)
    } else if (registry?.global?.set) {
      await registry.global.set(next)
    } else {
      throw new Error('workspace registry cannot persist archived state')
    }
  }

  const update = async () => {
    const state = registry.requireState?.()
    if (!state) throw new Error('workspace registry state unavailable')
    await persist(state)
  }

  if (typeof registry.enqueueOperation === 'function') {
    await registry.enqueueOperation(update)
  } else {
    const state = registry.requireState?.() ?? registry?.global?.get?.()
    await persist(state)
  }
  invalidateCaches()
}

export function apply(ctx: AppContext): (() => void) | void {
  const cleanup: (() => void)[] = []
  let currentPersistence: DshPersistence | undefined
  try {
    currentPersistence = ctx.get?.('sessionPersistence')
  } catch {
    currentPersistence = undefined
  }
  let disposePersistenceInjection: (() => void) | undefined
  try {
    const result = ctx.inject?.(['sessionPersistence'], (pctx: any) => {
      currentPersistence = pctx.sessionPersistence ?? ctx.get?.('sessionPersistence')
      return () => {
        currentPersistence = ctx.get?.('sessionPersistence')
      }
    })
    if (typeof result === 'function') disposePersistenceInjection = result
  } catch (error) {
    ctx.logger?.warn?.('[branch-workspace] optional sessionPersistence injection skipped:', String(error))
  }

  const disposeInjection = ctx.inject?.(['webServer'], (wctx: any) => {
    const webServer = wctx.webServer
    if (!webServer) return
    const getPersistence = (): DshPersistence | undefined =>
      currentPersistence ?? wctx.sessionPersistence ?? ctx.get?.('sessionPersistence')
    const API_PREFIX = '/branch-workspace/api'

    const sendJson = (res: any, status: number, payload: unknown) => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify(payload))
    }

    const disposer = webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (req: any, res: any) => {
        const url = new URL(req.url ?? '/', 'http://x')
        const pathname = url.pathname

        const remote = req.socket?.remoteAddress || req.connection?.remoteAddress || ''
        if (remote && !isLoopback(remote)) {
          sendJson(res, 403, { ok: false, error: '仅允许本机访问' })
          return
        }

        try {
          if (req.method === 'GET' && pathname === `${API_PREFIX}/health`) {
            sendJson(res, 200, { ok: true })
            return
          }

          if (req.method === 'GET' && pathname === `${API_PREFIX}/clusters`) {
            const now = Date.now()
            const root = homeSessionsRoot(wctx)
            let rootMtimeMs = 0
            try {
              rootMtimeMs = statSync(root).mtimeMs
            } catch {
              // ignore; fall through to TTL-only cache
            }
            // Fast path: build a cheap filesystem fingerprint (readdir + stat only)
            // before doing the expensive discover/read-header/parse pass.
            const files = listSessionFiles(root)
            const signature = sessionFilesSignature(files)
            if (
              clustersCache &&
              clustersCache.root === root &&
              clustersCache.rootMtimeMs === rootMtimeMs &&
              clustersCache.signature === signature &&
              now - clustersCache.at < CLUSTERS_CACHE_TTL_MS
            ) {
              const cachedClusters = filterClustersByCwd(clustersCache.clusters, url.searchParams.get('cwd')?.trim())
              sendJson(res, 200, { ok: true, data: { clusters: cachedClusters } })
              return
            }
            const locations = await discoverSessionLocations(wctx, root, getPersistence())
            const parsed = await parseAllSessions(locations, getPersistence(), ctx.logger)
            // Build the complete fork-tree **before** applying the workspace filter.
            // This keeps cross-workspace branch children attached to their real root
            // instead of turning them into isolated roots.
            const fullClusters = buildClusters(parsed)
            clustersCache = { at: now, root, rootMtimeMs, signature, clusters: fullClusters }
            const cwd = url.searchParams.get('cwd')?.trim()
            const clusters = filterClustersByCwd(fullClusters, cwd)
            sendJson(res, 200, { ok: true, data: { clusters } })
            return
          }

          if (req.method === 'GET' && pathname === `${API_PREFIX}/archives`) {
            const sessions = await listArchivedSessions(ctx, wctx, getPersistence)
            sendJson(res, 200, { ok: true, data: { sessions } })
            return
          }

          if (req.method === 'POST' && pathname === `${API_PREFIX}/purge`) {
            let sessionId = ''
            try {
              const body = JSON.parse(await readBody(req) || '{}')
              sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
            } catch {
              sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
              return
            }
            if (!sessionId) {
              sendJson(res, 400, { ok: false, error: 'sessionId required' })
              return
            }
            const data = await purgeSession(ctx, wctx, sessionId, getPersistence)
            sendJson(res, 200, { ok: true, data })
            return
          }

          if (req.method === 'POST' && pathname === `${API_PREFIX}/restore`) {
            let sessionId = ''
            try {
              const body = JSON.parse(await readBody(req) || '{}')
              sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
            } catch {
              sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
              return
            }
            if (!sessionId) {
              sendJson(res, 400, { ok: false, error: 'sessionId required' })
              return
            }
            await restoreSession(ctx, wctx, sessionId)
            sendJson(res, 200, { ok: true, data: { restored: sessionId } })
            return
          }

          sendJson(res, 404, { ok: false, error: 'not found' })
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    })

    ctx.logger?.info?.('[branch-workspace] /branch-workspace/api ready')
    cleanup.push(disposer)
    return () => {
      try {
        disposer()
      } catch {}
    }
  })

  if (disposePersistenceInjection) cleanup.push(disposePersistenceInjection)
  return () => {
    for (const dispose of cleanup) {
      try {
        dispose()
      } catch {}
    }
    try {
      disposeInjection?.()
    } catch {}
  }
}

export default apply
