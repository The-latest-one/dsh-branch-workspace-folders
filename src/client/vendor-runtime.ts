// Shared access to the vendored official ui-workspace source (0.1.2-rc.1
// baseline + branch features). Keeping this in one module avoids double-
// bundling the vendored source from multiple client entry points.
export { WorkspaceBrowser } from '../vendor/official-ui-workspace/rows/WorkspaceBrowser.tsx'
export { createWorkspaceViewStore } from '../vendor/official-ui-workspace/stores.ts'
export {
  buildSessionTree,
  flattenSessionTree,
  findSessionAncestors,
  countDescendants,
  buildPathMap,
  buildSiblingsMap,
  collectBranchIds,
  countSessionDescendantsFromList,
  sortTreeByUpdatedAt,
  type TimeSortMode,
  type BranchNode,
} from '../vendor/official-ui-workspace/branch.ts'
