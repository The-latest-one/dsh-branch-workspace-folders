/**
 * Shared lineage helpers for DSH fork-tree construction.
 *
 * DSH’s own branch judgment is based on the durable `parentSession` header:
 * any session with a different parent is a child in the fork lineage. Subagent
 * children also carry `parentSession`, so they are part of the same DSH tree;
 * the client can still label them with `origin: 'subagent'`.
 */
export interface LineageLike {
    sessionId: string;
    parentId?: string;
    seedLength?: number;
    origin?: string;
}
export declare function isForkChildLike(s: LineageLike): boolean;
/**
 * Collect the family of a session: its DSH parent ancestors plus every descendant
 * reachable from the root. Cycle-safe.
 */
export declare function collectFamilyIds<T extends LineageLike>(items: T[], currentId: string): Set<string>;
