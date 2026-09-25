/**
 * Branch helpers — ported from the former vendored client.cjs with fidelity.
 * All branch tree operations are cycle-safe and orphan-aware.
 */

import type { SessionPendingInteractionStatus } from './tree.ts'

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
  const visit = (startNodes: readonly BranchNode[]): void => {
    const stack: BranchNode[] = [...startNodes]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (reachable.has(node.id)) continue
      reachable.add(node.id)
      const children = (node as any).children
      if (Array.isArray(children)) {
        for (let i = children.length - 1; i >= 0; i--) {
          if (!reachable.has(children[i].id)) stack.push(children[i])
        }
      }
    }
  }
  visit(roots as BranchNode[])
  for (const node of nodes) {
    if (!reachable.has(node.id)) (node as any).cycle = true
  }
  for (const node of nodes) {
    if (!reachable.has(node.id)) {
      roots.push(node)
      visit([node as BranchNode])
    }
  }
  return roots
}

/** Flatten a session tree in display order, carrying each node's depth. Cycle-safe & stack-safe. */
export function flattenSessionTree<T extends BranchNode>(
  roots: readonly T[],
  depth = 0,
  rows: Array<{ node: T; depth: number }> = [],
  seen = new Set<string>(),
  collapsedIds?: ReadonlySet<string>,
): Array<{ node: T; depth: number }> {
  interface StackFrame<Item> {
    node: Item
    depth: number
  }
  const stack: StackFrame<T>[] = []
  for (let i = roots.length - 1; i >= 0; i--) {
    stack.push({ node: roots[i], depth })
  }

  while (stack.length > 0) {
    const { node, depth: d } = stack.pop()!
    if (seen.has(node.id)) continue
    seen.add(node.id)
    rows.push({ node, depth: d })

    const children: readonly T[] | undefined = (node as any).children
    if (children !== undefined && children.length > 0 && !(collapsedIds !== undefined && collapsedIds.has(node.id))) {
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: children[i], depth: d + 1 })
      }
    }
  }
  return rows
}

/** Find the ancestor ids that lead to a session id in a session tree. Cycle-safe & stack-safe. */
export function findSessionAncestors<T extends BranchNode>(
  nodes: readonly T[],
  targetId: string,
  initialAncestors: string[] = [],
): string[] | null {
  interface AncestorLink {
    id: string
    prev?: AncestorLink
  }
  interface AncestorFrame<Item> {
    node: Item
    link?: AncestorLink
  }

  let baseLink: AncestorLink | undefined
  for (const ancId of initialAncestors) {
    baseLink = { id: ancId, prev: baseLink }
  }

  const seen = new Set<string>()
  const stack: AncestorFrame<T>[] = []
  for (let i = nodes.length - 1; i >= 0; i--) {
    stack.push({ node: nodes[i], link: baseLink })
  }

  while (stack.length > 0) {
    const { node, link } = stack.pop()!
    if (node.id === targetId) {
      const result: string[] = []
      let curr = link
      while (curr !== undefined) {
        result.push(curr.id)
        curr = curr.prev
      }
      return result.reverse()
    }
    if (seen.has(node.id)) continue
    seen.add(node.id)

    const children: readonly T[] | undefined = (node as any).children
    if (children !== undefined && children.length > 0) {
      const nextLink: AncestorLink = { id: node.id, prev: link }
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: children[i], link: nextLink })
      }
    }
  }
  return null
}

/** Count every descendant (direct children plus their descendants) of a tree node. Cycle-safe & stack-safe. */
export function countDescendants(node: BranchNode): number {
  let count = 0
  const seen = new Set<string>([node.id])
  const stack: BranchNode[] = [...(((node as any).children ?? []) as BranchNode[])]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current.id)) continue
    seen.add(current.id)
    count += 1
    const children = (current as any).children
    if (Array.isArray(children)) {
      for (let i = children.length - 1; i >= 0; i--) {
        if (!seen.has(children[i].id)) stack.push(children[i])
      }
    }
  }
  return count
}

/** Build a nodeId -> ancestor-title array map for a session tree. Cycle-safe & stack-safe. */
export function buildPathMap<T extends BranchNode>(roots: readonly T[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  interface PathFrame<Item> {
    node: Item
    ancestors: string[]
  }
  const seen = new Set<string>()
  const stack: PathFrame<T>[] = []
  for (let i = roots.length - 1; i >= 0; i--) {
    stack.push({ node: roots[i], ancestors: [] })
  }

  while (stack.length > 0) {
    const { node, ancestors } = stack.pop()!
    if (seen.has(node.id)) continue
    seen.add(node.id)
    map.set(node.id, ancestors)

    const children: readonly T[] | undefined = (node as any).children
    if (children !== undefined && children.length > 0) {
      const nextAncestors = [...ancestors, (node as any).title ?? node.id]
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: children[i], ancestors: nextAncestors })
      }
    }
  }
  return map
}

/** Build a nodeId -> sibling node array map for a session tree. Cycle-safe & stack-safe. */
export function buildSiblingsMap<T extends BranchNode>(roots: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  const seen = new Set<string>()
  const stack: (readonly T[])[] = [roots]

  while (stack.length > 0) {
    const group = stack.pop()!
    for (const node of group) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      const siblings = group.filter((n) => n.id !== node.id) as T[]
      map.set(node.id, siblings)
      const children = (node as any).children as readonly T[] | undefined
      if (Array.isArray(children) && children.length > 0) {
        stack.push(children)
      }
    }
  }

  return map
}

/** Collect ids of nodes that have at least one child (branch nodes). Cycle-safe & stack-safe. */
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
  const seen = new Set<string>()
  const stack = [...roots]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (seen.has(node.id)) continue
    seen.add(node.id)
    const children = (node.children as BranchNode[]) || []
    if (children.length > 0) {
      ids.push(node.id)
      for (let i = children.length - 1; i >= 0; i--) {
        if (!seen.has(children[i].id)) stack.push(children[i])
      }
    }
  }
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

export type TimeSortMode = 'updatedAt-desc' | 'updatedAt-asc' | 'none'

/**
 * Sort a session tree by recency non-recursively (bottom-up DFS iteration).
 * Safe for extreme recursion depth and cycles.
 */
export function sortTreeByUpdatedAt<T extends BranchNode>(nodes: readonly T[], mode: TimeSortMode): T[] {
  if (mode === 'none') return [...nodes]
  const factor = mode === 'updatedAt-asc' ? 1 : -1
  const compareNodes = (a: any, b: any) => {
    const ta = typeof a?.updatedAt === 'number' ? a.updatedAt : Number.NEGATIVE_INFINITY
    const tb = typeof b?.updatedAt === 'number' ? b.updatedAt : Number.NEGATIVE_INFINITY
    if (ta !== tb) return (ta - tb) * factor
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }

  const cloneMap = new Map<any, any>()
  const stack: any[] = [...nodes]
  const allNodes: any[] = []
  const seen = new Set<any>()

  while (stack.length > 0) {
    const curr = stack.pop()
    if (!curr || seen.has(curr)) continue
    seen.add(curr)
    allNodes.push(curr)
    const cloned = { ...curr, children: Array.isArray(curr.children) ? [...curr.children] : curr.children }
    cloneMap.set(curr, cloned)
    if (Array.isArray(curr.children)) {
      for (let i = curr.children.length - 1; i >= 0; i--) {
        stack.push(curr.children[i])
      }
    }
  }

  for (let i = allNodes.length - 1; i >= 0; i--) {
    const orig = allNodes[i]
    const cloned = cloneMap.get(orig)
    if (cloned && Array.isArray(cloned.children) && cloned.children.length > 0) {
      const clonedChildren = cloned.children.map((c: any) => cloneMap.get(c) ?? c)
      clonedChildren.sort(compareNodes)
      cloned.children = clonedChildren
    }
  }

  const sortedRoots = nodes.map((r) => cloneMap.get(r) ?? r)
  sortedRoots.sort(compareNodes)
  return sortedRoots
}

export interface AggregatedDescendantStatus {
  hasPendingInteraction?: SessionPendingInteractionStatus
  hasRunning?: boolean
  runningSubagentCount?: number
  hasCompleted?: boolean
}

/**
 * Collect and aggregate highest-priority status across all descendants of a node.
 * Stack-safe & cycle-safe.
 */
export function aggregateDescendantStatus<T extends BranchNode>(
  node: T,
): AggregatedDescendantStatus {
  const result: AggregatedDescendantStatus = {}
  const children = (node as any).children
  if (!Array.isArray(children) || children.length === 0) return result

  const seen = new Set<string>([node.id])
  const stack: any[] = [...children]

  while (stack.length > 0) {
    const curr = stack.pop()!
    if (!curr || !curr.id || seen.has(curr.id)) continue
    seen.add(curr.id)

    // 1. Check warning-level pending interaction (Highest priority)
    if (curr.pendingInteraction !== undefined && result.hasPendingInteraction === undefined) {
      result.hasPendingInteraction = curr.pendingInteraction
    }

    // 2. Check running / subagents
    if (curr.running) result.hasRunning = true
    if (typeof curr.runningSubagentCount === 'number' && curr.runningSubagentCount > 0) {
      result.runningSubagentCount = (result.runningSubagentCount ?? 0) + curr.runningSubagentCount
    }

    // 3. Check completed
    if (curr.completed) result.hasCompleted = true

    const nextChildren = curr.children
    if (Array.isArray(nextChildren) && nextChildren.length > 0) {
      for (let i = nextChildren.length - 1; i >= 0; i--) {
        if (nextChildren[i] && nextChildren[i].id && !seen.has(nextChildren[i].id)) {
          stack.push(nextChildren[i])
        }
      }
    }
  }
  return result
}
