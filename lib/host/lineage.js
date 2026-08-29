/**
 * Shared lineage helpers for DSH fork-tree construction.
 *
 * DSH’s own branch judgment is based on the durable `parentSession` header:
 * any session with a different parent is a child in the fork lineage. Subagent
 * children also carry `parentSession`, so they are part of the same DSH tree;
 * the client can still label them with `origin: 'subagent'`.
 */
export function isForkChildLike(s) {
    return !!s.parentId && s.parentId !== s.sessionId;
}
/**
 * Collect the family of a session: its DSH parent ancestors plus every descendant
 * reachable from the root. Cycle-safe.
 */
export function collectFamilyIds(items, currentId) {
    const byId = new Map(items.map((item) => [item.sessionId, item]));
    const family = new Set([currentId]);
    // Climb DSH parent ancestors.
    let cursorId = currentId;
    const seen = new Set();
    while (cursorId && byId.has(cursorId) && !seen.has(cursorId)) {
        seen.add(cursorId);
        const item = byId.get(cursorId);
        const parent = isForkChildLike(item) ? item.parentId : undefined;
        if (parent && byId.has(parent) && !seen.has(parent))
            family.add(parent);
        cursorId = parent ?? '';
    }
    // Build parent -> children map using DSH parentSession.
    const childrenOf = new Map();
    for (const item of items) {
        if (!isForkChildLike(item) || !item.parentId)
            continue;
        const list = childrenOf.get(item.parentId) ?? [];
        list.push(item.sessionId);
        childrenOf.set(item.parentId, list);
    }
    // BFS from root to collect all descendants.
    const rootId = [...family][family.size - 1] ?? currentId;
    const queue = [rootId];
    const queued = new Set([rootId]);
    while (queue.length) {
        const id = queue.shift();
        for (const child of childrenOf.get(id) ?? []) {
            if (!queued.has(child)) {
                queued.add(child);
                family.add(child);
                queue.push(child);
            }
        }
    }
    return family;
}
//# sourceMappingURL=lineage.js.map