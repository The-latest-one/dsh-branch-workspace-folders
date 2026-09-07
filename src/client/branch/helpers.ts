/**
 * Branch helpers — public re-export of the vendored implementation.
 * The canonical implementation lives with the vendored official source so the
 * browser renderer and the archive page share one copy.
 */
export {
  buildSessionTree,
  flattenSessionTree,
  findSessionAncestors,
  countDescendants,
  buildPathMap,
  buildSiblingsMap,
  collectBranchIds,
  countSessionDescendantsFromList,
  type BranchNode,
} from '../../vendor/official-ui-workspace/branch.ts'
