/**
 * dsh-branch-workspace-folders — host half.
 *
 * Reads DSH session logs/headers and exposes a lightweight HTTP API that
 * groups all forked sessions under their root session. The client sidebar
 * consumes this API to render "branch folders" in the left workspace area.
 */
import { readdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readSessionHeader } from './host/zstd.js';
import { parseSessionLog } from './host/session-log.js';
import { readSessionLogAsync } from './host/zstd.js';
import { isForkChildLike } from './host/lineage.js';
export const name = 'dsh-branch-workspace-folders';
function isLoopback(remote) {
    return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}
function expandHome(p) {
    if (p === '~')
        return homedir();
    if (p.startsWith('~/'))
        return join(homedir(), p.slice(2));
    return p;
}
function homeSessionsRoot(ctx) {
    if (ctx && typeof ctx.dshHomePath === 'function') {
        try {
            const resolved = ctx.dshHomePath('sessions');
            if (resolved)
                return String(resolved);
        }
        catch {
            // fall through
        }
    }
    const env = process.env.DSH_HOME;
    const root = env && env.trim() ? expandHome(env.trim()) : join(homedir(), '.dsh');
    return join(root, 'sessions');
}
const SESSIONS_CACHE_TTL_MS = 2000;
let sessionsCache = null;
let persistenceCache = null;
const CLUSTERS_CACHE_TTL_MS = 5000;
const MAX_CONCURRENT_PARSES = 4;
let clustersCache = null;
function discoverSessionsCached(root) {
    let mtimeMs = 0;
    try {
        mtimeMs = statSync(root).mtimeMs;
    }
    catch {
        // ignore
    }
    const now = Date.now();
    if (sessionsCache &&
        sessionsCache.root === root &&
        sessionsCache.mtimeMs === mtimeMs &&
        now - sessionsCache.at < SESSIONS_CACHE_TTL_MS) {
        return sessionsCache.locations;
    }
    const locations = discoverSessions(root);
    sessionsCache = { root, at: now, mtimeMs, locations };
    return locations;
}
function discoverSessions(root) {
    const locations = [];
    if (!existsSync(root))
        return locations;
    let workspaces = [];
    try {
        workspaces = readdirSync(root);
    }
    catch {
        return locations;
    }
    for (const workspace of workspaces) {
        const workspaceDir = join(root, workspace);
        let entries = [];
        try {
            entries = readdirSync(workspaceDir);
        }
        catch {
            continue;
        }
        for (const sessionId of entries) {
            const file = join(workspaceDir, sessionId, 'session.jsonl.zstd');
            if (!existsSync(file))
                continue;
            try {
                const header = readSessionHeader(file);
                locations.push({
                    sessionId: String(header.id ?? sessionId),
                    workspace,
                    file,
                    header,
                });
            }
            catch {
                // ignore corrupt/unreadable logs
            }
        }
    }
    return locations;
}
async function parseSessionAt(location, persistence, logger) {
    if (persistence && typeof persistence.readFrom === 'function') {
        try {
            const { meta, events } = await persistence.readFrom(location.sessionId, 0);
            return parseSessionLog(events, meta);
        }
        catch (error) {
            logger?.warn?.('[branch-workspace] sessionPersistence.readFrom failed, fallback to file read:', location.sessionId, String(error));
        }
    }
    const events = await readSessionLogAsync(location.file);
    return parseSessionLog(events, location.header);
}
async function discoverSessionLocations(ctx, root, persistence) {
    if (persistence && typeof persistence.list === 'function') {
        const now = Date.now();
        if (persistenceCache && now - persistenceCache.at < SESSIONS_CACHE_TTL_MS) {
            return persistenceCache.locations;
        }
        try {
            const headers = await persistence.list();
            if (Array.isArray(headers)) {
                const locations = [];
                for (const header of headers) {
                    const located = persistence.locate?.(header);
                    const file = located?.path;
                    if (!file || !existsSync(file))
                        continue;
                    locations.push({
                        sessionId: String(header.id ?? ''),
                        workspace: '',
                        file,
                        header,
                    });
                }
                if (locations.length > 0) {
                    persistenceCache = { at: now, locations };
                    return locations;
                }
            }
        }
        catch (error) {
            ctx.logger?.warn?.('[branch-workspace] sessionPersistence.list failed, fallback to fs scan', String(error));
        }
    }
    return discoverSessionsCached(root);
}
function toClusterSession(s) {
    return {
        sessionId: s.sessionId,
        parentId: s.parentId,
        title: s.title || s.sessionId,
        origin: s.origin,
        cwd: s.cwd,
        running: s.running,
        blank: s.blank,
        updatedAt: s.lastActiveAt,
    };
}
export function buildClusters(parsed) {
    const byId = new Map(parsed.map((s) => [s.sessionId, s]));
    const childrenOf = new Map();
    const roots = [];
    for (const s of parsed) {
        const parent = isForkChildLike(s) && byId.has(s.parentId) ? s.parentId : undefined;
        if (parent) {
            const list = childrenOf.get(parent) ?? [];
            list.push(s.sessionId);
            childrenOf.set(parent, list);
        }
        else {
            roots.push(s);
        }
    }
    const sortedRoots = [...roots].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.sessionId.localeCompare(b.sessionId));
    const clusters = [];
    const seen = new Set();
    for (const root of sortedRoots) {
        if (seen.has(root.sessionId))
            continue;
        const sessions = [];
        const queue = [root.sessionId];
        const localSeen = new Set();
        while (queue.length) {
            const id = queue.shift();
            if (localSeen.has(id))
                continue;
            localSeen.add(id);
            seen.add(id);
            const s = byId.get(id);
            if (s)
                sessions.push(toClusterSession(s));
            for (const child of childrenOf.get(id) ?? []) {
                if (!localSeen.has(child) && !seen.has(child))
                    queue.push(child);
            }
        }
        clusters.push({
            rootSessionId: root.sessionId,
            rootTitle: root.title || root.sessionId,
            sessions,
        });
    }
    // Safety net: any session not reached by a root (e.g. malformed cycles) gets
    // its own top-level cluster, and its reachable descendants are collected too.
    for (const s of parsed) {
        if (seen.has(s.sessionId))
            continue;
        const sessions = [];
        const queue = [s.sessionId];
        const localSeen = new Set();
        while (queue.length) {
            const id = queue.shift();
            if (localSeen.has(id))
                continue;
            localSeen.add(id);
            seen.add(id);
            const current = byId.get(id);
            if (current)
                sessions.push(toClusterSession(current));
            for (const child of childrenOf.get(id) ?? []) {
                if (!localSeen.has(child) && !seen.has(child))
                    queue.push(child);
            }
        }
        clusters.push({
            rootSessionId: s.sessionId,
            rootTitle: s.title || s.sessionId,
            sessions,
        });
    }
    return clusters;
}
async function parseAllSessions(locations, persistence, logger) {
    const parsed = [];
    let index = 0;
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT_PARSES, locations.length) }, async () => {
        while (index < locations.length) {
            const current = index++;
            const loc = locations[current];
            try {
                parsed.push(await parseSessionAt(loc, persistence, logger));
            }
            catch (error) {
                logger?.warn?.('[branch-workspace] skip unreadable session:', loc.sessionId, String(error));
            }
        }
    });
    await Promise.all(workers);
    return parsed;
}
/**
 * Filter clusters by current workspace without breaking the fork tree.
 *
 * A branch may live in a different cwd from its root session. Filtering
 * individual sessions before clustering would split that tree, so we keep the
 * complete cluster and only decide whether the cluster is relevant to the
 * requested workspace.
 */
function filterClustersByCwd(clusters, cwd) {
    if (!cwd)
        return clusters;
    return clusters.filter((cluster) => cluster.sessions.some((session) => session.cwd === cwd));
}
export function apply(ctx) {
    const cleanup = [];
    let currentPersistence;
    try {
        currentPersistence = ctx.get?.('sessionPersistence');
    }
    catch {
        currentPersistence = undefined;
    }
    let disposePersistenceInjection;
    try {
        const result = ctx.inject?.(['sessionPersistence'], (pctx) => {
            currentPersistence = pctx.sessionPersistence ?? ctx.get?.('sessionPersistence');
            return () => {
                currentPersistence = ctx.get?.('sessionPersistence');
            };
        });
        if (typeof result === 'function')
            disposePersistenceInjection = result;
    }
    catch (error) {
        ctx.logger?.warn?.('[branch-workspace] optional sessionPersistence injection skipped:', String(error));
    }
    const disposeInjection = ctx.inject?.(['webServer'], (wctx) => {
        const webServer = wctx.webServer;
        if (!webServer)
            return;
        const getPersistence = () => currentPersistence ?? wctx.sessionPersistence ?? ctx.get?.('sessionPersistence');
        const API_PREFIX = '/branch-workspace/api';
        const sendJson = (res, status, payload) => {
            res.statusCode = status;
            res.setHeader('content-type', 'application/json');
            res.setHeader('cache-control', 'no-store');
            res.end(JSON.stringify(payload));
        };
        const disposer = webServer.register({
            kind: 'prefix',
            path: API_PREFIX,
            handler: async (req, res) => {
                const url = new URL(req.url ?? '/', 'http://x');
                const pathname = url.pathname;
                const remote = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
                if (remote && !isLoopback(remote)) {
                    sendJson(res, 403, { ok: false, error: '仅允许本机访问' });
                    return;
                }
                try {
                    if (req.method === 'GET' && pathname === `${API_PREFIX}/health`) {
                        sendJson(res, 200, { ok: true });
                        return;
                    }
                    if (req.method === 'GET' && pathname === `${API_PREFIX}/clusters`) {
                        const now = Date.now();
                        const root = homeSessionsRoot(wctx);
                        let rootMtimeMs = 0;
                        try {
                            rootMtimeMs = statSync(root).mtimeMs;
                        }
                        catch {
                            // ignore; fall through to TTL-only cache
                        }
                        if (clustersCache &&
                            clustersCache.root === root &&
                            clustersCache.rootMtimeMs === rootMtimeMs &&
                            now - clustersCache.at < CLUSTERS_CACHE_TTL_MS) {
                            const cachedClusters = filterClustersByCwd(clustersCache.clusters, url.searchParams.get('cwd')?.trim());
                            sendJson(res, 200, { ok: true, data: { clusters: cachedClusters } });
                            return;
                        }
                        const locations = await discoverSessionLocations(wctx, root, getPersistence());
                        const parsed = await parseAllSessions(locations, getPersistence(), ctx.logger);
                        // Build the complete fork-tree **before** applying the workspace filter.
                        // This keeps cross-workspace branch children attached to their real root
                        // instead of turning them into isolated roots.
                        const fullClusters = buildClusters(parsed);
                        clustersCache = { at: now, root, rootMtimeMs, clusters: fullClusters };
                        const cwd = url.searchParams.get('cwd')?.trim();
                        const clusters = filterClustersByCwd(fullClusters, cwd);
                        sendJson(res, 200, { ok: true, data: { clusters } });
                        return;
                    }
                    sendJson(res, 404, { ok: false, error: 'not found' });
                }
                catch (error) {
                    sendJson(res, 500, {
                        ok: false,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            },
        });
        ctx.logger?.info?.('[branch-workspace] /branch-workspace/api ready');
        cleanup.push(disposer);
        return () => {
            try {
                disposer();
            }
            catch { }
        };
    });
    if (disposePersistenceInjection)
        cleanup.push(disposePersistenceInjection);
    return () => {
        for (const dispose of cleanup) {
            try {
                dispose();
            }
            catch { }
        }
        try {
            disposeInjection?.();
        }
        catch { }
    };
}
export default apply;
//# sourceMappingURL=index.js.map