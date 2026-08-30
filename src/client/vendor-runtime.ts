// Shared access to the vendored official WorkspaceBrowser CJS module.
// The ModuleLoader wrapper provides `require` in the browser bundle; keeping
// this in one module avoids double-bundling the vendor file from multiple
// client entry points.

declare const require: any

const WorkspaceBrowserModule = require('../vendor/workspace-browser/client.cjs') as any

export const WorkspaceBrowser: any = WorkspaceBrowserModule.WorkspaceBrowser
export const buildSessionTree: any = WorkspaceBrowserModule.buildSessionTree
export const flattenSessionTree: any = WorkspaceBrowserModule.flattenSessionTree
export const findSessionAncestors: any = WorkspaceBrowserModule.findSessionAncestors
export const countDescendants: any = WorkspaceBrowserModule.countDescendants
export const collectBranchIds: any = WorkspaceBrowserModule.collectBranchIds
export const createWorkspaceViewStore: any = WorkspaceBrowserModule.createWorkspaceViewStore

export default WorkspaceBrowserModule