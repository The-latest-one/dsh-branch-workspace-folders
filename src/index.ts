/**
 * dsh-branch-workspace-folders — host half.
 *
 * Reads DSH session logs/headers and exposes a lightweight HTTP API that
 * groups all forked sessions under their root session. The client sidebar
 * consumes this API to render "branch folders" in the left workspace area.
 */
import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs'
import { cp, writeFile, mkdir, rename, rm } from 'node:fs/promises'
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
  if (!remote) return false
  if (remote === '::1' || remote.startsWith('::1%')) return true
  let r = remote
  if (r.startsWith('::ffff:')) r = r.slice(7)
  return r.startsWith('127.')
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
let persistenceCache: { at: number; root: string; signature: string; locations: SessionLocation[] } | null = null
let purgeMutex: Promise<void> = Promise.resolve()
const ARCHIVES_CACHE_TTL_MS = 10000
interface ArchivesCache {
  at: number
  archivedKey: string
  sessions: ArchivedSessionDTO[]
}
let archivesCache: ArchivesCache | null = null

/**
 * Persistent metadata cache for archived-session listing.
 *
 * DSH headers are cheap and contain the fork graph (id, parentSession, cwd,
 * createdAt), but archived rows also need title / updatedAt / running / blank
 * which normally require decompressing the full session log. Cache those
 * display fields per session keyed by log mtime, so archive pages do not have
 * to reparse every session on every cold request.
 */
interface ArchivedMetaEntry {
  sessionId: string
  parentId?: string
  cwd?: string
  title?: string
  updatedAt?: number
  running?: boolean
  blank?: boolean
  mtimeMs?: number
}
interface ArchivedMetaCache {
  version: number
  byId: Record<string, ArchivedMetaEntry>
}
const ARCHIVED_META_CACHE_VERSION = 1
let archivedMetaState: { root: string; data: ArchivedMetaCache } | null = null
let archivedMetaDirty = false
let archivedMetaSaveChain: Promise<void> = Promise.resolve()

function archivedMetaPath(root: string): string {
  return join(root, '..', '.dsh-branch-workspace-meta.json')
}

function getArchivedMetaCache(root: string): ArchivedMetaCache {
  if (archivedMetaState && archivedMetaState.root === root) {
    return archivedMetaState.data
  }
  const empty: ArchivedMetaCache = { version: ARCHIVED_META_CACHE_VERSION, byId: {} }
  try {
    const text = readFileSync(archivedMetaPath(root), 'utf8')
    const parsed = JSON.parse(text) as Partial<ArchivedMetaCache>
    if (
      parsed &&
      parsed.version === ARCHIVED_META_CACHE_VERSION &&
      parsed.byId &&
      typeof parsed.byId === 'object'
    ) {
      archivedMetaState = { root, data: parsed as ArchivedMetaCache }
      archivedMetaDirty = false
      return parsed as ArchivedMetaCache
    }
  } catch {
    // first run or corrupt cache; start empty
  }
  archivedMetaState = { root, data: empty }
  archivedMetaDirty = false
  return empty
}

function scheduleArchivedMetaSave(root: string, data: ArchivedMetaCache): void {
  archivedMetaDirty = true
  archivedMetaSaveChain = archivedMetaSaveChain.catch(() => {}).then(async () => {
    if (!archivedMetaDirty || !archivedMetaState || archivedMetaState.root !== root || archivedMetaState.data !== data) {
      return
    }
    try {
      const path = archivedMetaPath(root)
      const tmp = `${path}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(data))
      await rename(tmp, path)
      archivedMetaDirty = false
    } catch {
      // Keep dirty so the next archive request retries the write.
    }
  })
}

function safeMtimeMs(file: string): number | undefined {
  try {
    return statSync(file).mtimeMs
  } catch {
    return undefined
  }
}

function headerParentId(header: any): string | undefined {
  if (!header) return undefined
  return header.parentSession ?? header.parentId
}

function lineageFromLocations(locations: SessionLocation[]): Array<{ sessionId: string; parentId?: string }> {
  return locations.map((location) => ({
    sessionId: location.sessionId,
    parentId: headerParentId(location.header),
  }))
}

function countDescendantsFromLocations(locations: SessionLocation[], sessionId: string): number {
  const childrenOf = new Map<string, string[]>()
  for (const location of locations) {
    const parentId = headerParentId(location.header)
    if (!parentId || parentId === location.sessionId) continue
    const list = childrenOf.get(parentId) ?? []
    list.push(location.sessionId)
    childrenOf.set(parentId, list)
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

/** Cheap filesystem fingerprint: directory entries + per-file mtime hash, no header IO. */
function sessionFilesSignature(files: SessionFileRef[]): string {
  let maxMtimeMs = 0
  let sumMtimeMs = 0
  for (const ref of files) {
    try {
      const st = statSync(ref.file)
      if (st.mtimeMs > maxMtimeMs) maxMtimeMs = st.mtimeMs
      sumMtimeMs = (sumMtimeMs + Math.floor(st.mtimeMs)) % 2147483647
    } catch {
      // ignore unreadable files
    }
  }
  return `${files.length}:${maxMtimeMs}:${sumMtimeMs}`
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
    } catch (error: any) {
      const msg = String(error?.message ?? error)
      if (msg.includes('corrupt Zstandard')) {
        // Committed frame is structurally corrupt — log loud instead of silently dropping
        console.warn('[branch-workspace] skip corrupt session log:', ref.file, msg)
      }
      // ignore corrupt/unreadable logs (live torn tail is already handled as incomplete)
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
    const sigFiles = listSessionFiles(root)
    const sig = sessionFilesSignature(sigFiles)
    if (persistenceCache && persistenceCache.root === root && persistenceCache.signature === sig && now - persistenceCache.at < SESSIONS_CACHE_TTL_MS) {
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
          persistenceCache = { at: now, root, signature: sig, locations }
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
  const MAX_BODY_BYTES = 256 * 1024
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > MAX_BODY_BYTES) {
      const err: any = new Error('request body too large')
      err.code = 'PAYLOAD_TOO_LARGE'
      throw err
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

function invalidateCaches(): void {
  sessionsCache = null
  persistenceCache = null
  archivesCache = null
  archivedMetaDirty = false
  archivedMetaSaveChain = Promise.resolve()
}

function getWorkspaceRegistry(ctx: AppContext, wctx: any): any {
  try {
    return ctx.get?.('workspaceRegistry') ?? wctx?.workspaceRegistry ?? ctx.get?.('workspaces')
  } catch {
    return wctx?.workspaceRegistry ?? undefined
  }
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
  const root = homeSessionsRoot(wctx)
  const locations = await discoverSessionLocations(wctx, root, getPersistence())
  const fileSig = sessionFilesSignature(locations.map(l => ({ sessionId: l.sessionId, workspace: l.workspace, file: l.file })) as any)
  const compositeKey = `${archivedKey}|sig:${fileSig}`
  if (archivesCache && archivesCache.archivedKey === compositeKey && now - archivesCache.at < ARCHIVES_CACHE_TTL_MS) {
    return archivesCache.sessions
  }
  const byLocation = new Map(locations.map((location) => [location.sessionId, location]))
  const lineage = lineageFromLocations(locations)
  const liveService = ctx.get?.('sessions')
  const meta = getArchivedMetaCache(root)
  let metaChanged = false
  const result: ArchivedSessionDTO[] = []

  for (const id of archivedIds) {
    const location = byLocation.get(id)
    const cached = meta.byId[id]
    const headerParent = location ? headerParentId(location.header) : undefined
    const parentId = headerParent ?? cached?.parentId
    const parentKnown = !!parentId && parentId !== id && (byLocation.has(parentId) || !!meta.byId[parentId] || !!liveService?.get?.(parentId))
    const descendantCount = countDescendantsFromLocations(locations, id)

    if (!location) {
      result.push({
        sessionId: id,
        parentId,
        title: cached?.title || id,
        cwd: cached?.cwd,
        updatedAt: cached?.updatedAt,
        running: cached?.running,
        blank: cached?.blank,
        parentKnown,
        descendantCount,
        missing: true,
      })
      continue
    }

    const mtimeMs = safeMtimeMs(location.file)
    let entry = cached
    if (!entry || entry.mtimeMs !== mtimeMs) {
      try {
        const s = await parseSessionAt(location, getPersistence(), ctx.logger)
        entry = {
          sessionId: id,
          parentId: s.parentId ?? headerParentId(location.header),
          cwd: s.cwd,
          title: s.title || id,
          updatedAt: s.lastActiveAt,
          running: s.running,
          blank: s.blank,
          mtimeMs,
        }
        meta.byId[id] = entry
        metaChanged = true
      } catch (error) {
        ctx.logger?.warn?.('[branch-workspace] skip unreadable archived session:', id, String(error))
        entry = cached ?? {
          sessionId: id,
          parentId: headerParentId(location.header),
          cwd: location.header?.cwd,
          title: id,
          updatedAt: location.header?.createdAt,
          mtimeMs,
        }
        meta.byId[id] = entry
      }
    }

    result.push({
      sessionId: id,
      parentId: entry.parentId ?? headerParentId(location.header),
      title: entry.title || id,
      cwd: entry.cwd,
      updatedAt: entry.updatedAt,
      running: entry.running,
      blank: entry.blank,
      parentKnown,
      descendantCount,
    })
  }

  if (metaChanged) {
    scheduleArchivedMetaSave(root, meta)
  }
  archivesCache = { at: Date.now(), archivedKey: compositeKey, sessions: result }
  return result
}

async function purgeSessions(
  ctx: AppContext,
  wctx: any,
  sessionIds: string[],
  getPersistence: () => DshPersistence | undefined,
): Promise<{ purged: number }> {
  let release: () => void
  const wait = new Promise<void>((res) => (release = res))
  const prev = purgeMutex
  purgeMutex = wait
  await prev
  try {
  const registry = getWorkspaceRegistry(ctx, wctx)
  if (!registry) throw new Error('workspace registry unavailable')
  const ids = Array.from(new Set(sessionIds.filter((id) => typeof id === 'string' && id.length > 0)))
  if (ids.length === 0) return { purged: 0 }
  if (ids.length > 32) throw new Error('单次最多处理 32 个会话')
  const archivedIds = Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds : []
  for (const sessionId of ids) {
    if (!archivedIds.includes(sessionId)) throw new Error('只能永久删除已归档的根会话')
  }
  const root = homeSessionsRoot(wctx)
  const locations = await discoverSessionLocations(wctx, root, getPersistence())
  // Purge only needs the durable fork graph from SessionHeader, not full logs.
  // This removes the previous all-session decompress/parse bottleneck.
  // Include archived ids that are already missing from disk but whose parent
  // chain is known through the persistent metadata cache. Without this a
  // missing archived child is invisible to collectFamilyIds() and would survive
  // a root purge in archivedSessionIds.
  const archivedMeta = getArchivedMetaCache(root)
  const lineageItems = lineageFromLocations(locations)
  const lineageById = new Map(lineageItems.map((item) => [item.sessionId, item]))
  for (const id of archivedIds) {
    if (lineageById.has(id)) continue
    lineageItems.push({
      sessionId: id,
      parentId: archivedMeta.byId[id]?.parentId ?? headerParentId(archivedMeta.byId[id] as any),
    })
  }
  const lineage = lineageItems
  const byId = new Map(lineage.map((item) => [item.sessionId, item.parentId]))
  const liveService = ctx.get?.('sessions')

  // Permanent delete is intentionally root-only: it removes the whole fork
  // tree. Refuse requests that name a child to avoid deleting an unarchived
  // root the user may not have intended to destroy. Validate all roots before
  // any mutation so a batch cannot partially fail.
  for (const sessionId of ids) {
    const targetParent = byId.get(sessionId)
    if (targetParent && targetParent !== sessionId && (byId.has(targetParent) || !!liveService?.get?.(targetParent))) {
      throw new Error('只能删除根会话（该会话存在父会话）')
    }
  }

  const familySets = ids.map((sessionId) => collectFamilyIds(lineage, sessionId))
  const family = new Set<string>()
  for (const set of familySets) {
    for (const id of set) family.add(id)
  }
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
    for (const m of [...moved].reverse()) {
      try {
        await rename(m.trashDir, m.dir)
      } catch (e: any) {
        if (e?.code === 'EXDEV') {
          try {
            await cp(m.trashDir, m.dir, { recursive: true, force: true, errorOnExist: false })
            await rm(m.trashDir, { recursive: true, force: true })
          } catch {}
        }
      }
    }
  }

  for (const p of paths) {
    const trashDir = join(trashRoot, p.id)
    try {
      try { await rm(trashDir, { recursive: true, force: true }) } catch {}
      await rename(p.dir, trashDir)
      moved.push({ dir: p.dir, trashDir })
    } catch (error: any) {
      if (error?.code === 'ENOENT') continue
      if (error?.code === 'EXDEV') {
        // The sessions root and trash root are on different filesystems.
        // Copy the directory (with its session log) then remove the original.
        try {
          await cp(p.dir, trashDir, { recursive: true, force: true, errorOnExist: false })
          await rm(p.dir, { recursive: true, force: true })
          moved.push({ dir: p.dir, trashDir })
          continue
        } catch (copyError: any) {
          try {
            await rm(trashDir, { recursive: true, force: true })
          } catch {
            // best-effort partial-copy cleanup
          }
          await rollbackMoves()
          throw new Error(`移动会话目录失败: ${String(copyError?.message ?? copyError)}`)
        }
      }
      await rollbackMoves()
      throw new Error(`移动会话目录失败: ${String(error?.message ?? error)}`)
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

    // Drop deleted sessions from the persistent display cache so a future
    // purge/list never resurrects stale archived metadata.
    const meta = getArchivedMetaCache(root)
    let metaChanged = false
    for (const id of family) {
      if (meta.byId[id]) {
        delete meta.byId[id]
        metaChanged = true
      }
    }
    if (metaChanged) {
      scheduleArchivedMetaSave(root, meta)
    }

    invalidateCaches()
    return { purged: family.size }
  } catch (error) {
    await rollbackMoves()
    throw error
  }
  } finally {
    release!()
  }
}


async function restoreSessions(
  ctx: AppContext,
  wctx: any,
  sessionIds: string[],
): Promise<{ restored: string[] }> {
  const registry = getWorkspaceRegistry(ctx, wctx)
  if (!registry) throw new Error('workspace registry unavailable')

  const ids = Array.from(new Set(sessionIds.filter((id) => typeof id === 'string' && id.length > 0)))
  if (ids.length === 0) return { restored: [] }
  const archivedIds = Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds : (registry.requireState?.()?.archivedSessionIds ?? registry.global?.get?.()?.archivedSessionIds ?? [])
  for (const id of ids) {
    if (!archivedIds.includes(id)) throw new Error(`只能恢复已归档的会话: ${id}`)
  }

  const remove = new Set(ids)
  const persist = async (state: any) => {
    if (!state) throw new Error('workspace registry state unavailable')
    const next = {
      ...state,
      archivedSessionIds: (state.archivedSessionIds ?? []).filter((id: string) => !remove.has(id)),
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
  return { restored: ids }
}

async function restoreBranch(
  ctx: AppContext,
  wctx: any,
  sessionId: string,
  getPersistence: () => DshPersistence | undefined,
): Promise<{ restored: string[] }> {
  const sessions = await listArchivedSessions(ctx, wctx, getPersistence)
  const archivedById = new Map(sessions.map((s) => [s.sessionId, s]))
  if (!archivedById.has(sessionId)) throw new Error('只能恢复已归档的会话')
  // Build family from full header graph (including non-archived intermediates) so a leaf whose middle ancestor
  // is not archived can still be reached; then filter to archived-only ids.
  const root = homeSessionsRoot(wctx)
  const locations = await discoverSessionLocations(wctx, root, getPersistence())
  const archivedMeta = getArchivedMetaCache(root)
  const lineageItems: Array<{ sessionId: string; parentId?: string }> = lineageFromLocations(locations)
  const lineageById = new Map(lineageItems.map((item) => [item.sessionId, item]))
  for (const id of archivedById.keys()) {
    if (lineageById.has(id)) continue
    lineageItems.push({ sessionId: id, parentId: (archivedById.get(id)?.parentId ?? archivedMeta.byId[id]?.parentId) as string | undefined })
  }
  const family = collectFamilyIds(lineageItems as any, sessionId)
  const ids = Array.from(family).filter((id) => archivedById.has(id))
  return restoreSessions(ctx, wctx, ids)
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
        if (!isLoopback(remote)) {
          sendJson(res, 403, { ok: false, error: '仅允许本机访问' })
          return
        }

        try {
          if (req.method === 'GET' && pathname === `${API_PREFIX}/health`) {
            sendJson(res, 200, { ok: true })
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
            } catch (e: any) {
              if (e?.code === 'PAYLOAD_TOO_LARGE') {
                sendJson(res, 413, { ok: false, error: 'request body too large' })
                try { (req as any).destroy?.() } catch {}
                return
              }
              sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
              return
            }
            if (!sessionId) {
              sendJson(res, 400, { ok: false, error: 'sessionId required' })
              return
            }
            const data = await purgeSessions(ctx, wctx, [sessionId], getPersistence)
            sendJson(res, 200, { ok: true, data })
            return
          }

          if (req.method === 'POST' && pathname === `${API_PREFIX}/purge-batch`) {
            let sessionIds: string[] = []
            try {
              const body = JSON.parse(await readBody(req) || '{}')
              if (!Array.isArray(body.sessionIds)) {
                sendJson(res, 400, { ok: false, error: 'sessionIds must be string[]' })
                return
              }
              if (body.sessionIds.some((id: unknown) => typeof id !== 'string' || (id as string).length === 0)) {
                sendJson(res, 400, { ok: false, error: 'sessionIds must be non-empty strings' })
                return
              }
              sessionIds = body.sessionIds as string[]
            } catch (e: any) {
              if (e?.code === 'PAYLOAD_TOO_LARGE') {
                sendJson(res, 413, { ok: false, error: 'request body too large' })
                try { (req as any).destroy?.() } catch {}
                return
              }
              sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
              return
            }
            if (sessionIds.length === 0) {
              sendJson(res, 400, { ok: false, error: 'sessionIds required' })
              return
            }
            const data = await purgeSessions(ctx, wctx, sessionIds, getPersistence)
            sendJson(res, 200, { ok: true, data })
            return
          }

          if (req.method === 'POST' && pathname === `${API_PREFIX}/restore`) {
            let sessionId = ''
            try {
              const body = JSON.parse(await readBody(req) || '{}')
              sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
            } catch (e: any) {
              if (e?.code === 'PAYLOAD_TOO_LARGE') {
                sendJson(res, 413, { ok: false, error: 'request body too large' })
                try { (req as any).destroy?.() } catch {}
                return
              }
              sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
              return
            }
            if (!sessionId) {
              sendJson(res, 400, { ok: false, error: 'sessionId required' })
              return
            }
            await restoreSessions(ctx, wctx, [sessionId])
            sendJson(res, 200, { ok: true, data: { restored: sessionId } })
            return
          }

          if (req.method === 'POST' && pathname === `${API_PREFIX}/restore-batch`) {
            let sessionIds: string[] = []
            try {
              const body = JSON.parse(await readBody(req) || '{}')
              if (!Array.isArray(body.sessionIds)) {
                sendJson(res, 400, { ok: false, error: 'sessionIds must be string[]' })
                return
              }
              if (body.sessionIds.some((id: unknown) => typeof id !== 'string' || (id as string).length === 0)) {
                sendJson(res, 400, { ok: false, error: 'sessionIds must be non-empty strings' })
                return
              }
              sessionIds = body.sessionIds as string[]
            } catch (e: any) {
              if (e?.code === 'PAYLOAD_TOO_LARGE') {
                sendJson(res, 413, { ok: false, error: 'request body too large' })
                try { (req as any).destroy?.() } catch {}
                return
              }
              sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
              return
            }
            if (sessionIds.length === 0) {
              sendJson(res, 400, { ok: false, error: 'sessionIds required' })
              return
            }
            const data = await restoreSessions(ctx, wctx, sessionIds)
            sendJson(res, 200, { ok: true, data })
            return
          }

          if (req.method === 'POST' && pathname === `${API_PREFIX}/restore-branch`) {
            let sessionId = ''
            try {
              const body = JSON.parse(await readBody(req) || '{}')
              sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
            } catch (e: any) {
              if (e?.code === 'PAYLOAD_TOO_LARGE') {
                sendJson(res, 413, { ok: false, error: 'request body too large' })
                try { (req as any).destroy?.() } catch {}
                return
              }
              sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
              return
            }
            if (!sessionId) {
              sendJson(res, 400, { ok: false, error: 'sessionId required' })
              return
            }
            const data = await restoreBranch(ctx, wctx, sessionId, getPersistence)
            sendJson(res, 200, { ok: true, data })
            return
          }

          const knownPaths = new Set([`${API_PREFIX}/health`, `${API_PREFIX}/archives`, `${API_PREFIX}/purge`, `${API_PREFIX}/purge-batch`, `${API_PREFIX}/restore`, `${API_PREFIX}/restore-batch`, `${API_PREFIX}/restore-branch`])
          if (knownPaths.has(pathname)) {
            sendJson(res, 405, { ok: false, error: 'method not allowed' })
          } else {
            sendJson(res, 404, { ok: false, error: 'not found' })
          }
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
    invalidateCaches()
    archivedMetaState = null
  }
}

export default apply
