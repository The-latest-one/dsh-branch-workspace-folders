/**
 * Branch helpers — ported from the former vendored client.cjs with fidelity.
 * All branch tree operations are cycle-safe and orphan-aware.
 */

export interface BranchNode {
  id: string
  parentId?: string
  title?: string
  displayTitle?: string
  children?: BranchNode[]
  orphan?: boolean
  cycle?: boolean
  [k: string]: any
}

/**
 * Build a parentId -> children tree from a workspace's flat session nodes.
 * Nodes whose parent is absent from the group become roots. The input nodes
 * are reused; children arrays are reset on each build so repeated renders do
 * not accumulate duplicates.
 */
export function buildSessionTree<T extends BranchNode>(sessions: readonly T[]): T[] {
  const nodes = sessions.map((node) => {
    const copy: any = { ...node, children: [] as BranchNode[] }
    delete copy.orphan
    delete copy.cycle
    return copy as T
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const roots: T[] = []
  for (const node of nodes) {
    const parentId = (node as any).parentId
    const parent = parentId !== undefined && parentId !== node.id ? byId.get(parentId) : undefined
    if (parent === undefined) {
      if (parentId !== undefined && parentId !== node.id) (node as any).orphan = true
      roots.push(node)
    } else {
      ;(parent as any).children.push(node)
    }
  }
  const reachable = new Set<string>()
  const visit = (node: BranchNode): void => {
    if (reachable.has(node.id)) return
    reachable.add(node.id)
    for (const child of (node as any).children ?? []) visit(child)
  }
  for (const root of roots) visit(root as BranchNode)
  for (const node of nodes) {
    if (!reachable.has(node.id)) (node as any).cycle = true
  }
  for (const node of nodes) {
    if (!reachable.has(node.id)) {
      roots.push(node)
      visit(node as BranchNode)
    }
  }
  return roots
}

/** Flatten a session tree in display order, carrying each node's depth. */
export function flattenSessionTree<T extends BranchNode>(
  roots: readonly T[],
  depth = 0,
  rows: Array<{ node: T; depth: number }> = [],
  seen = new Set<string>(),
  collapsedIds?: ReadonlySet<string>,
): Array<{ node: T; depth: number }> {
  for (const node of roots) {
    if (seen.has(node.id)) continue
    seen.add(node.id)
    rows.push({ node, depth })
    const children: readonly T[] | undefined = (node as any).children
    if (children !== undefined && children.length > 0 && !(collapsedIds !== undefined && collapsedIds.has(node.id))) {
      flattenSessionTree(children as unknown as readonly T[], depth + 1, rows, seen, collapsedIds)
    }
  }
  return rows
}

/** Find the ancestor ids that lead to a session id in a session tree. */
export function findSessionAncestors<T extends BranchNode>(
  nodes: readonly T[],
  targetId: string,
  ancestors: string[] = [],
): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return ancestors
    const found = findSessionAncestors(((node as any).children ?? []) as readonly T[], targetId, [...ancestors, node.id])
    if (found !== null) return found
  }
  return null
}

/** Count every descendant (direct children plus their descendants) of a tree node. Cycle-safe. */
export function countDescendants(node: BranchNode): number {
  let count = 0
  const seen = new Set<string>()
  const walk = (current: BranchNode): void => {
    if (seen.has(current.id)) return
    seen.add(current.id)
    for (const child of ((current as any).children ?? []) as BranchNode[]) {
      count += 1
      walk(child)
    }
  }
  walk(node)
  return count
}

/** Build a nodeId -> ancestor-title array map for a session tree. Cycle-safe. */
export function buildPathMap<T extends BranchNode>(roots: readonly T[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const walk = (nodes: readonly T[], ancestors: T[], seen: Set<string>): void => {
    for (const node of nodes) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      map.set(node.id, ancestors.map((a: any) => a.title))
      walk((((node as any).children ?? []) as readonly T[]), [...ancestors, node], seen)
      seen.delete(node.id)
    }
  }
  walk(roots, [], new Set())
  return map
}

/** Build a nodeId -> sibling node array map for a session tree. Cycle-safe. */
export function buildSiblingsMap<T extends BranchNode>(roots: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  const walk = (nodes: readonly T[], seen: Set<string>): void => {
    const siblingsByNode = new Map<string, T[]>()
    for (const node of nodes) siblingsByNode.set(node.id, nodes.filter((n) => n.id !== node.id) as T[])
    for (const node of nodes) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      map.set(node.id, siblingsByNode.get(node.id) || [])
      walk((((node as any).children ?? []) as readonly T[]), seen)
    }
  }
  walk(roots, new Set())
  return map
}

/** Collect ids of nodes that have at least one child (branch nodes). Cycle-safe. */
export function collectBranchIds<T extends BranchNode>(sessions: readonly T[]): string[] {
  const byId = new Map<string, BranchNode>()
  for (const session of sessions) {
    if (session === undefined) continue
    byId.set((session as any).id, { id: (session as any).id, parentId: (session as any).parentId, children: [] })
  }
  const roots: BranchNode[] = []
  for (const node of byId.values()) {
    const parent = node.parentId !== undefined && node.parentId !== node.id ? byId.get(node.parentId) : undefined
    if (parent === undefined) roots.push(node)
    else (parent.children as BranchNode[]).push(node)
  }
  const ids: string[] = []
  const walk = (nodes: readonly BranchNode[], seen = new Set<string>()): void => {
    for (const node of nodes) {
      if (seen.has(node.id)) continue
      const nextSeen = new Set(seen)
      nextSeen.add(node.id)
      if (((node.children as BranchNode[]) || []).length > 0) ids.push(node.id)
      walk(((node.children as BranchNode[]) || []) as readonly BranchNode[], nextSeen)
    }
  }
  walk(roots)
  return ids
}

/** Count descendant fork sessions from the flat list/graph (used for archive-root confirmations). Cycle-safe. */
export function countSessionDescendantsFromList(
  list: { ids: readonly string[]; byId: Record<string, { id: string; parentId?: string } | undefined> },
  sessionId: string,
): number {
  const byParent = new Map<string, string[]>()
  for (const id of list.ids) {
    const session = list.byId[id]
    if (session === undefined || session.parentId === undefined || session.parentId === id) continue
    const children = byParent.get(session.parentId) || []
    children.push(session.id)
    byParent.set(session.parentId, children)
  }
  let count = 0
  const seen = new Set<string>([sessionId])
  const stack = [...(byParent.get(sessionId) || [])]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    count += 1
    const next = byParent.get(id)
    if (next !== undefined) {
      for (const child of next) stack.push(child)
    }
  }
  return count
}
