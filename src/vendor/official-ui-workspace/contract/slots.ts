/**
 * ui-workspace contracts for DeepSeek Harness 0.1.7-rc.1
 */
import type { SessionSearchResultItem } from '@deepseek-ai/dsh-api-session-controller/client'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { createWorkspaceViewStore } from '../stores.ts'

export interface HostObservable<T> {
  getSnapshot: () => T
  subscribe: (listener: () => void) => () => void
}

export interface DirectoryFlowOwnerProps {
  open: boolean
  busy: boolean
  onPicked: (path: string) => void
  onCancel: () => void
  onError: (message: string) => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.hero.workspace.directoryFlow': {
      kind: 'single'
      scope: 'root'
      owner: DirectoryFlowOwnerProps
    }
    'sidebar.workspaces.directoryFlow': {
      kind: 'single'
      scope: 'root'
      owner: DirectoryFlowOwnerProps
    }
    'sidebar.workspaces.session.menu.item': {
      kind: 'list'
      scope: 'root'
      owner: { sessionId: SessionId; displayTitle: string }
    }
    'sidebar.workspaces.session.row.action': {
      kind: 'list'
      scope: 'root'
      owner: { sessionId: SessionId; displayTitle: string }
    }
    'sidebar.session.row.leading': {
      kind: 'list'
      scope: 'root'
      owner: { sessionId: SessionId }
    }
    'sidebar.session.row.hover': {
      kind: 'list'
      scope: 'root'
      owner: { sessionId: SessionId }
    }
  }
}

export type DirectoryPickingInjected = {
  hooks: {
    directoryFlow: HostObservable<boolean>
  }
}

export type WorkspaceBrowserInjected = {
  hooks: DirectoryPickingInjected['hooks'] & {
    hostInfo: HostObservable<RemoteHostFacts>
  }
  startSession: (workspaceId?: WorkspaceId) => void
  open: (sessionId: SessionId) => void
  searchSessions: (
    query: string,
    signal: AbortSignal,
  ) => Promise<{ items: readonly SessionSearchResultItem[]; hasMore: boolean }>
  searchResultLimit: number
  requestSessionRename: (sessionId: SessionId, currentTitle: string) => void
  notifyArchivedNotOpenable: () => void
  renameWorkspace: (workspaceId: WorkspaceId, title: string) => Promise<void>
  deleteWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  insertWorkspaceBefore: (
    workspaceId: WorkspaceId,
    beforeWorkspaceId?: WorkspaceId,
  ) => Promise<void>
  unarchiveSession: (sessionId: SessionId) => Promise<void>
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
}

export type WorkspaceViewStoreHandle = ReturnType<typeof createWorkspaceViewStore>

export interface WorkspaceBrowserProps {
  wide: boolean
  expandSidebar: () => void
  useSessions: any
  useSessionStatus?: any
  useWorkspaces: any
  useStore: any
  actions: any
  startSession: (workspaceId?: WorkspaceId) => void
  open: (sessionId: SessionId) => void
  searchSessions: (
    query: string,
    signal: AbortSignal,
  ) => Promise<{ items: readonly SessionSearchResultItem[]; hasMore: boolean }>
  searchResultLimit: number
  requestSessionRename: (sessionId: SessionId, currentTitle: string) => void
  notifyArchivedNotOpenable: () => void
  renameWorkspace: (workspaceId: WorkspaceId, title: string) => Promise<void>
  deleteWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  insertWorkspaceBefore: (
    workspaceId: WorkspaceId,
    beforeWorkspaceId?: WorkspaceId,
  ) => Promise<void>
  unarchiveSession: (sessionId: SessionId) => Promise<void>
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
  useDirectoryFlow: (selector: (occupied: boolean) => any) => any
  useHostInfo: (selector: (facts: RemoteHostFacts) => any) => any
  useShortcuts?: any
  useWorkspaceShortcuts?: any
  requestSearch?: () => void
  requestAddWorkspace?: () => void
  closeAddWorkspace?: () => void
  setDirectoryBusy?: (busy: boolean) => void
  dismissForkError?: () => void
  renderSlot?: (slotName: string, ...args: any[]) => any
  t: (key: string, params?: any) => string
  usePanelInfo?: <T = any>(
    selector: (info: { activePanelId: string | null }) => T,
  ) => T
}

export type WorkspacePickerInjected = DirectoryPickingInjected & {
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
}

export interface WorkspacePickerProps {
  open: boolean
  anchorRef?: any
  useWorkspaces: any
  selectedId?: any
  onPick: (workspaceId: WorkspaceId) => void
  onClose: () => void
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
  useDirectoryFlow: (selector: (occupied: boolean) => any) => any
  renderSlot?: (slotName: string, ...args: any[]) => any
  t: (key: string, params?: any) => string
}
