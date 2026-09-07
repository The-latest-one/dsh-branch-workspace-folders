# dsh-branch-workspace-folders × DSH v0.1.2-rc.1 前端 UI 与功能适配技术文档

- 文档版本：v1.0
- 适配目标：DSH 官方 **v0.1.2-rc.1**（文档根：`/root/Job/A-dsh-docs-v0.1.2-rc.1/`，tag `dsh-v0.1.2-rc.1`）
- 插件版本：`dsh-branch-workspace-folders` 0.1.14（工作树处于“已提交 HEAD 354fa0f + 16:53 拷入新官方源码未接入”的半成品状态）
- 文档定位：前端 UI 与功能适配的技术依据。只覆盖 Web Client 侧；Host 侧（session 解析 / zstd / HTTP API）不在本文范围，仅在风险节提及。

---

## 1. 背景与目标

官方 DSH 升级到 0.1.2-rc.1 后，本插件出现两类症状：

1. **UI 显示异常**：左侧工作区浏览器（WorkspaceBrowser）渲染错位 / 样式不一致 / 新状态展示缺失（等待审批、计划待审、定时任务、完成态等官方新增行状态不显示或显示成旧样式）。
2. **部分功能挂掉**：分支折叠、批量归档、当前会话胶囊、全局折叠等自研增强功能在部分加载顺序 / HMR / 冷启动场景下失效；且工作树在 16:53 拷入新官方源码后 `npm run typecheck` 已经报错（见 §6 证据），当前代码**无法通过构建**。

本文的目标：以官方 0.1.2-rc.1 文档 + 已安装官方包源码为唯一事实来源，给出
“现状 → 官方变更 → 差距 → 适配方案 → 验证矩阵” 的完整技术路径。

---

## 2. 现状（代码地图）

```
dsh-branch-workspace-folders/
├─ src/index.ts                        # Host 半部：读取 session 头/日志，暴露 /branch-workspace/api/* HTTP API
├─ src/host/                           # zstd.ts / session-log.ts / lineage.ts（Host 内部实现）
├─ src/client/
│  ├─ index.tsx                        # 客户端入口：settings.section 注册 + 影子替换官方 sidebar.workspaces entry
│  ├─ vendor-runtime.ts                # 从 vendor/workspace-browser/client.cjs 取出 WorkspaceBrowser 等导出
│  ├─ archived-settings.tsx            # 已归档会话管理页（恢复/永久删除/树形展示/批量）
│  └─ branch/helpers.ts                # 分支树算法（从旧 CJS 抽出，尚未接入构建）
├─ src/vendor/
│  ├─ workspace-browser/client.cjs     # 【旧】官方 ui-workspace 旧版本 + 本插件分支功能，打包产物，161KB
│  └─ official-ui-workspace/           # 【新】官方 0.1.2-rc.1 ui-workspace 源码（16:53 拷入，未接入构建，untracked）
└─ cordis.patch.yml                    # 以 insert 方式挂到 web profile
```

### 2.1 客户端当前的实现方式（关键）

`src/client/index.tsx` 的 `apply()` 做了三件事：

1. **设置页**：向 `settings.section`（list 槽）注册 `id: 'branch-workspace-archives'`、`order: 20`、`label` thunk、`locale`、`inject: () => ({ t })` 的已归档会话管理组件。
2. **影子替换官方浏览器**：`sync()` 从 `slots.entries('sidebar.workspaces')` 找到官方 entry（判定条件：`children?.['sidebar.workspaces.directoryFlow'] || options?.children?.[...]`），把 `entry.component` 换成 `SafeWorkspaceBrowser`（错误边界 + 我们 vendored 的 `WorkspaceBrowser`）。
3. **运行时打补丁**：
   - `patchStoreSpec(store)`：**原地**修改官方 handle 的 `spec`（= defineStore 闭包里的 `decl`，同一对象）——`spec.actions` 追加 `setBranchCollapsed` / `setAllBranchesCollapsed`、`spec.init` 包一层返回 `collapsedBranchesByAccount: {}`、`spec.persist` 改 `'dsh.workspace.view.v6'`（**不能** `store.spec = {...}` 整对象替换，新引擎 `create()` 读闭包里的原 `decl`；**不能**替换 `entry.store`，渲染器按 handle 身份查私有 `_stores`，未注册 handle 直接抛错）；
   - `wrapInject`：在官方 `inject()` 返回对象上追加 `refreshSessions`（供旧组件使用）。

### 2.2 旧 vendored 包的来源

`src/vendor/workspace-browser/client.cjs` 是**旧版官方 ui-workspace（依赖 `@deepseek-ai/dsh-client-runtime/client` 的时代）+ 本插件分支功能**的打包产物。HEAD（354fa0f）只做了最小适配：把 `dsh-client-runtime` 换成 `dsh-client-store`、把 `indexSubagentDescendants` 内联、导出面不变。**它并不是基于 0.1.2-rc.1 官方源码重打的**。

---

## 3. 官方 0.1.2-rc.1 客户端变更总览（依据 docs/ + node_modules 源码）

### 3.1 客户端架构（docs/subsystems/web-client.md）

- 分层：Host 业务服务 → `client/connection` + `api/gateway` + `api/remotes`（传输/API 组装）→ **Client models**（`api/session-controller/client` = `ctx.sessions`；`api/workspace-controller/client` = `ctx.workspaces`）→ UI 适配层（`client/ui-session`、`client/ui-workspace`）→ 会话/展示层（`ui-conversation`、`ui-chat`、`ui-trajectory`）→ `ui-slots`/`ui-renderer` → React。
- 关键服务面：
  - `ctx.sessions`：`ClientSessions → SessionManager → Session`，有 `binding(id)`、`open()`、`search()`、`fork()`、`searchResultLimit` 等（见官方 `index.ts` 用法）。
  - `ctx.workspaces`：`ClientWorkspaceModel`，暴露 `list`（可观察快照）、`create()`、`rename()`、`delete()`、`insertBefore()`、`insertSessionBefore()`、`archiveSession()`。
  - `ctx.remote.*` / `ctx.remote.directoryPicker`：生成式 Remote 方法 + 目录选择能力。
  - `ctx.settingsScope`：设置卡读写句柄（`bind({namespace})` → `scope.set/unset`、`value/base/user`）。
- **没有**旧式 `Runtime` / `HostFrame` / `events.mux` / 通用 `resync()`；`dsh-client-runtime` 已不存在。

### 3.2 槽位体系（docs/subsystems/slots.md + 已安装 ui-settings types）

- 注册形态：`ctx.slots.inject(key, () => ctx.slots.register({ name, children?, store?, inject, locale? }, Component))`。
- 标准 props 与 hooks（按槽 scope 自动注入）：
  - 所有 scope：`useSessions`、`useSessionPendingInteraction`（`ui-session`）、`useWorkspaces`（`ui-workspace`）。
  - `session` scope：`sessionId`、`useSession`、`useProjection`、`useConversation`、`useInput`、`inputActions`、`useChat`、`useTrajectory`。
  - 注册派生的：`useStore`（store 声明）、`t`（locale 声明）。
- 当前层级（与本文相关的摘录）：
  ```
  root
  ├─ sidebar
  │  ├─ sidebar.workspaces
  │  │  └─ sidebar.workspaces.directoryFlow      (single, root)
  │  └─ sidebar.settings
  │     └─ settings.section                      (list, root; owner = { close })
  │        ├─ settings.general.item / settings.models.provider-card / settings.models.footer
  │        └─ settings.plugins.tab → settings.plugin.item   (keyed; 插件配置卡推荐座位)
  └─ conversation
     └─ conversation.hero.workspace
        └─ conversation.hero.workspace.directoryFlow  (single, root)
  ```
- `settings.section` 契约（`@deepseek-ai/dsh-client-ui-settings/lib/types/client/contract/slots.d.ts`）：
  - `kind: 'list'`、`scope: 'root'`、owner 只有 `close: () => void`；
  - 注册项携带 `id`（section key）、`order`（导航位置）、`label`（**注册者本地化文案；thunk 会被 `resolveSlotLabel` 每次读取时求值**，因此无需在 locale 变化时重新注册）；
  - section 数据通过自己的 `inject` face / store 进入，组件不接收 `ctx`。
- `settings.plugin.item`：由拥有 Plugins 段的 `ui-settings-plugins` 声明（本插件 node_modules 未安装该包，但文档 cookbook/adding-a-settings-card.md 说明它是“按 namespace 分发 keyed 卡片”的推荐座位，适合**配置卡**，不适合本文的“已归档会话管理页”）。

### 3.3 官方 ui-workspace 0.1.2-rc.1 源码要点（`src/vendor/official-ui-workspace/`）

这是 16:53 从官方仓库拷入的源码（与已安装 `@deepseek-ai/dsh-client-ui-workspace@0.1.2-rc.1` 的 `lib/client.js` 同源）：

- **打包导出**：官方 `lib/client.js` 只导出 `apply` / `inject`（**不再导出 WorkspaceBrowser 组件**）；组件只存在于 `slots.register()` 的 entry 里。
- **注册**（`index.ts`）：
  ```ts
  export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker']
  ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } })   // 提供 useWorkspaces
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
    name: 'sidebar.workspaces',
    children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
    store: createWorkspaceViewStore(),
    inject: browserInjected,
    locale: NS,   // 'workspace'
  }, WorkspaceBrowser))
  // 同样的模式注册 conversation.hero.workspace → WorkspacePicker
  ```
- **注入面 `WorkspaceBrowserInjected`**（`contract/slots.ts`）：
  - 动作：`startSession` / `open` / `searchSessions` / `searchResultLimit` / `renameSession` / `forkSession` / `renameWorkspace` / `deleteWorkspace` / `insertWorkspaceBefore` / `archiveSession` / `insertSessionBefore` / `createWorkspace`；
  - hooks：`directoryFlow`（该 surface 的目录流洞占用）、`hostInfo`（`ctx.remote.$host`，订阅 `connection/reset`）；
  - **没有 `refreshSessions`**（旧组件依赖它，是我们自己包上去的）。
- **组件 props**（`rows/WorkspaceBrowser.tsx` `WorkspaceBrowser({...})`）：
  `wide, expandSidebar, useSessions, useSessionPendingInteraction, useWorkspaces, useStore, actions, startSession, open, renameSession, forkSession, renameWorkspace, deleteWorkspace, insertWorkspaceBefore, archiveSession, insertSessionBefore, createWorkspace, searchSessions, searchResultLimit, useDirectoryFlow, useHostInfo, renderSlot, t`。
  - 新读取：`useHostInfo(info => info.home)`、`useWorkspaces(s => s.items | s.phase | s.state | s.archivedSessionIds)`、`useSessions(s => s.current/byId[id].blank)`、`useSessionPendingInteraction(...)`。
- **视图 store**（`stores.ts`，`defineStore` from `@deepseek-ai/dsh-client-store`）：
  ```ts
  init: () => ({ groupBy:'workspace', orderBy:'updated', groupExpansion:{},
                 sessionOrderByAccount:{}, sessionUpdatedAtByAccount:{} })
  persist: 'dsh.workspace.view.v5'
  actions: setGroupBy / setOrderBy / setGroupExpanded / retainAccountKeys /
           syncSessionOrderAccount / setSessionOrder
  ```
  **没有 `collapsedBranchesByAccount`**（我们的分支折叠状态字段），persist key 从旧插件的 `v6` 回退为官方 `v5`。
- **树派生**（`tree.ts`）：`SessionNode` 新增 `pendingInteraction?('approval'|'plan-review'|'question')`、`runningSubagentCount`、`completed`、`hasActiveSchedule`；`TreeView = { expandedGroups, ungroupedOrder }`；`owningGroupKey`、`workspaceLabel`、`indexSubagentDescendants`（来自 `./subagent-lineage.ts`）。官方树是**平铺**的（无 children 分支树）。
- **行渲染**（`rows/Rows.tsx`）：新增 `StateDot`/状态文案、`relativeTime`、`HoverCard`、`IconAlarmClockOutline16`（定时任务）、完成态绿点、`abbreviateHomePath`（来自 `@deepseek-ai/dsh-util-workspace-path`）。
- **官方浏览器没有**：MoreMenu、批量选择/批量归档、分支折叠、分支 badge、当前会话胶囊、当前根/工作区标记、溢出折叠（Show more）。这些全是本插件的功能，需要在新源码上重新实现。
- **CSS**：CSS Modules 以 `createElement("style")` 内联进 bundle（类名带内容哈希，如 `bhn1Oq_workspaceDropAfter`）；新类名/新 token（`--dsw-alias-*`）与旧 vendored 的 `qDHVXG_*` 完全不同——**旧 CJS 自带旧 CSS，与 0.1.2-rc.1 官方周边组件样式脱节，这是 UI 显示异常的直接来源之一**。

### 3.4 客户端模块系统（docs/subsystems/client-modules.md）

- 包通过 `package.json` 的 `dsh.client` 声明加入引导图：
  ```json
  "dsh": { "client": { "platform": "web", "inject": ["..."], "immediately": true?, "external": ["..."] } }
  ```
- `inject` = 包名依赖边（工厂到达顺序/预取元数据，**不决定 apply 时序**）；`external` = 精确的非 inject 模块请求（如 `@deepseek-ai/dsh-client-ui-workspace/client`）。
- 必须导出 `exports["./client"]`（懒加载 CJS 工厂产物）；bundle 由 `/plugins/??<pkg>/client.js&rev=...` 提供。
- **bundle 纯度门**：feature 插件禁止 value-import 其他 feature 插件（只允许 `import type`）；共享运行时值只能来自 `client/store`、`ui-primitives` 或浏览器安全工具包。

### 3.5 样式体系（docs/web-styling.md）

- CSS Modules + `clsx`；feature 组件只用 `--dsw-alias-*` 语义 token；主题/明暗由 `ui-theme` 拥有；禁止 Tailwind/组件库；内联样式只允许组件本地自定义属性。

---

## 4. 差距分析（为什么 UI 异常 / 功能挂掉）

| # | 差距 | 影响 | 证据 |
|---|------|------|------|
| G1 | **vendored 浏览器仍是旧官方源码**：旧 CJS 缺 `useSessionPendingInteraction`、`useHostInfo`、`workspaces.state`、`revealSessionId` 流程、新行状态（approval/plan-review/question、completed、schedule、runningSubagentCount），用的是旧 locale key 集与旧 CSS 类名 | 新状态不显示 / 显示为旧样式 / 布局错位（UI 显示异常） | 对比 `client.cjs`（161KB）与 `official-ui-workspace/`（0.1.2-rc.1 源码，125KB 官方产物） |
| G2 | **官方 bundle 不再导出 `WorkspaceBrowser`**；我们 `vendor-runtime.ts` 从**自己** vendored CJS 导入，组件 swap 仍可行（entry.component 可达），但组件必须与官方 entry 的 `children/store/inject/locale` 契约完全对齐 | 只要组件契约对齐 swap 就成立；契约不对齐则整块渲染异常 | 官方 `lib/client.js` 仅 `exports.apply/inject` |
| G3 | **store 运行时补丁依赖时序**：`patchStoreActions` 修改 `store.spec.actions/init`，必须在框架 `store.create()` 实例化之前生效。官方入口在 apply 里 `store: createWorkspaceViewStore()`，若我们的 `sync()` 晚于实例化，`actions` 上就不会有 `setBranchCollapsed` | 分支折叠/全局折叠按钮“点不动/消失”（功能挂掉） | 新 `EngineStoreHandle.create()` 把 actions 烘培成 `BakedActions`；旧插件能跑是因为 root 渲染发生在“roster 稳定后”，我们 patch 先于首次渲染；HMR/重载时该时序不再保证 |
| G4 | **`refreshSessions` 是旧世界产物**：官方 0.1.2-rc.1 注入面没有它；`ctx.sessions` 是流式 Client 模型，可能也没有 `refresh()` | 旧组件依赖的 `refreshSessions` 由我们 wrapper 注入，仍可用；但新源码不需要；若继续依赖 `sessions.refresh()` 需确认新 API | 官方 `WorkspaceBrowserInjected` 定义 |
| G5 | **工作树半成品**：`src/vendor/official-ui-workspace/`（16:53 拷入）不在任何 tsconfig/构建链中，却因 `tsconfig.json` `include: ["src"]` 被 typecheck 扫描 | `npm run typecheck` 报错（缺 `@deepseek-ai/dsh-api-*`、`dsh-client-ui-renderer/client`、`dsh-client-ui-session/client`、`dsh-client-ui-conversation/client`、CSS module 类型、`allowImportingTsExtensions`、`Context.slots/remote` merge 缺失、`.ts` 扩展名导入等） | 实测 `npx tsc -p tsconfig.json --noEmit`（见 §6） |
| G6 | **新官方源码运行时依赖未声明**：`clsx`（已作为传递依赖存在于 node_modules）、`@deepseek-ai/dsh-util-workspace-path`（未安装；官方 bundle 将其内联） | 无法构建 / 无法类型检查 | `official-ui-workspace/rows/*.tsx`、`tree.ts` 的 import |
| G7 | **`dsh.client` 元数据不全**：`package.json dsh.client.inject` 只有 store/slots/sidebar/locale/settings，缺 `@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-api-workspace-controller`（我们 `apply` 实际等待 `sessions`/`workspaces` 服务）、以及官方列出的 `dsh-api-remotes`/`dsh-client-connection`/`dsh-client-ui-conversation`/`dsh-client-ui-renderer`/`dsh-client-ui-session` | 引导图工厂到达顺序/预取不完整（informational，但可能导致 HMR/冷启动竞争） | 官方 `dsh-client-ui-workspace/package.json` `dsh.client.inject` |
| G8 | **设置页注册基本兼容**：`settings.section` 仍是 list 槽，`id/order/label(thunk)/inject` 均受支持；但需确认：新版 shell 是否要求 `label` 为 thunk（是，`resolveSlotLabel` 支持）；owner `close` 我们的组件未用（无碍）；`locale` 注册项冗余（我们通过 inject 传 `t`） | 低风险；建议保留 `settings.section`，不迁移到 `settings.plugin.item`（那是配置卡座位） | ui-settings `slots.d.ts` |
| G9 | **Host 侧**：`ctx.sessionPersistence`（list/locate/readFrom）、`ctx.webServer`、`workspaceRegistry` 仍在 0.1.2-rc.1 文档中存在，Host 半部风险低；唯一注意 `sessionPersistence.readFrom` 语义（返回 `SessionEventSuffix`，不是完整 inspection）——本插件已按旧语义使用 | 低风险，本轮不改 | docs/subsystems/persistence.md |

---

## 5. 适配方案（推荐：全量 re-vendor + 功能回归）

### 5.0 决策

- **选 A（推荐）**：以 `src/vendor/official-ui-workspace/`（官方 0.1.2-rc.1 源码）为基线，把分支功能**直接写进 vendored 源码**，重新打成客户端 bundle。理由：官方源码已拷入；新功能（状态徽标/定时任务/完成态/目录流契约）必须基于新组件才有；旧 CJS 的样式与结构无法“小修”到与新主题一致。
- **选 B（备选/短期）**：继续用旧 CJS，只修 store 补丁时序 + 补 `refreshSessions` + 保留设置页。**不推荐**：UI 显示异常（G1）无法根治。

### 5.1 步骤 1：接入官方源码到构建链（消除 G5/G6/G7）

1. **补 devDependencies**（镜像官方 `dsh-client-ui-workspace/package.json`）：
   - 类型/声明：`@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-api-workspace-controller`、`@deepseek-ai/dsh-client-connection`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-ui-renderer`、`@deepseek-ai/dsh-client-ui-session`、`@deepseek-ai/dsh-schedule`（`^0.1.2-rc.1`）。
   - 运行时：`@deepseek-ai/dsh-util-workspace-path`（`^0.1.2-rc.1`，构建时内联或 external，见 5.3）、`clsx`（`^2.0.0`，官方 dependencies）。
2. **tsconfig**：
   - `tsconfig.client.json`（浏览器面，noEmit）：`compilerOptions` 加 `"allowImportingTsExtensions": true`（vendored 源码用 `.ts`/`.tsx` 相对导入；tsdown 构建不受影响）；`include` 加 `src/vendor/official-ui-workspace/**`（或建独立 `tsconfig.vendor.json` 并让 client 引用）。
   - `tsconfig.json`（Host 面，含 `src`）：把 `src/vendor/official-ui-workspace/**` 与 `src/client/branch/**` 加入 `exclude`，避免 Host 面类型合并冲突（该目录是 client 面代码，`Context.slots/remote` merge 只存在于 client 面）。
   - 补 CSS module 声明：新建 `src/vendor/official-ui-workspace/css-modules.d.ts`（`declare module '*.module.css'`，默认导出 `Record<string,string>`）。
3. **package.json `dsh.client`**（对齐官方 + 我们实际服务）：
   ```json
   "inject": [
     "@deepseek-ai/dsh-client-store",
     "@deepseek-ai/dsh-client-ui-slots",
     "@deepseek-ai/dsh-client-ui-sidebar",
     "@deepseek-ai/dsh-client-locale",
     "@deepseek-ai/dsh-client-ui-settings",
     "@deepseek-ai/dsh-api-session-controller",
     "@deepseek-ai/dsh-api-workspace-controller",
     "@deepseek-ai/dsh-api-remotes",
     "@deepseek-ai/dsh-client-connection",
     "@deepseek-ai/dsh-client-ui-renderer",
     "@deepseek-ai/dsh-client-ui-session"
   ]
   ```
   `external` 保留 `@deepseek-ai/dsh-client-ui-workspace/client`（若最终不再 import 官方 client，可删除，但保留无害且说明“我们 vendored 的 CSS 标签引用官方包”）。

### 5.2 步骤 2：把分支功能重新实现到新官方源码

按功能 → 落点列出（每个功能在 `src/vendor/official-ui-workspace/` 的修改点）：

| 功能 | 落点 | 说明 |
|------|------|------|
| 分支折叠状态 | `stores.ts` | `WorkspaceViewState` 增加 `collapsedBranchesByAccount: Record<string, string[]>`；新增 actions `setBranchCollapsed(d, accountKey, nodeId, collapsed)`、`setAllBranchesCollapsed(d, accountKey, nodeIds, collapsed)`；**persist key 保持 `'dsh.workspace.view.v6'`**（旧插件用户状态无缝继承；官方 v5 数据由 init 默认值兜底） |
| 分支树构建 | `tree.ts` + `src/client/branch/helpers.ts` | 以 `SessionSummary`/`SessionNode` 的 `parentId` 构建 children 树（复用 helpers：`buildSessionTree`/`flattenSessionTree`/`findSessionAncestors`/`countDescendants`/`buildPathMap`/`buildSiblingsMap`/`collectBranchIds`），保留官方字段（pendingInteraction/completed/hasActiveSchedule/runningSubagentCount）；`SessionNode` 增加 `children?`、`branchDescendantCount`、`orphan`/`cycle` 标记 |
| 分支行渲染 | `rows/Rows.tsx` | 行内分支 badge（`IconBranchOutline16`）、折叠 chevron、缩进层级；保留官方 `StateDot`/状态/时间/HoverCard |
| 单分支折叠/展开 | `rows/WorkspaceBrowser.tsx` | 调用 `actions.setBranchCollapsed(accountKey, id, next)`；点击行 chevron 折叠子树 |
| 自动展开当前链 | `rows/WorkspaceBrowser.tsx` | effect：`findSessionAncestors` 得到当前会话祖先链，逐个 `setBranchCollapsed(key, id, false)`；与官方 `revealSessionId` 流程共存 |
| 全局折叠/展开所有分支 | `WorkspaceBrowser.tsx` 的菜单 | 在官方 `ViewOptionsMenu` 旁新增 MoreMenu（或扩展 ViewOptionsMenu），调用 `setAllBranchesCollapsed` |
| 当前会话胶囊 / 当前根、工作区标记 | `rows/Rows.tsx` | `data-current-session`/`data-current-workspace`/`data-current-collapsed` + 胶囊样式 |
| 批量选择 + 批量归档 | `WorkspaceBrowser.tsx` | `selectionMode`/`selectedIds`/`toggleSelect` + 上下文批量条（复用旧 CJS 逻辑，迁到新 JSX）；动作走官方注入面 `archiveSession` / 或 `workspaces.archiveSession` |
| 溢出折叠（Show more） | `rows/Rows.tsx` | 每组默认展示 N 条（默认 5），`sessions.expand`/`sessions.collapse` 用官方新 key |
| 搜索 + snippet + HoverCard | 官方已有，保留 | 不回归 |
| 目录流（Add workspace） | 官方已有，保留 | `useDirectoryFlow` + `renderSlot('sidebar.workspaces.directoryFlow', owner)` 契约不变 |
| 视图选项（groupBy/orderBy） | 官方已有，保留 | `actions.setGroupBy/setOrderBy` |
| `refreshSessions` | 移除或保留为 no-op | 新组件不再需要；若设置页 `onMutated` 需要刷新，改调 `ctx.workspaces`/`ctx.sessions` 的官方刷新/重新订阅 API（需确认新模型方法名，见 §7 待验证） |

### 5.3 步骤 3：改造 `src/client/index.tsx` 影子策略

1. **原地 patch 官方 store handle**（消除 G3；⚠️ 已实测：**不能替换 `entry.store`**）：
   - 我们 bundle 内的扩展版 `createWorkspaceViewStore()` **只用于编译期类型/导出面**，**不作为** `entry.store` 替换值使用。
   - **框架约束（源码级证据，0.1.2-rc.1）**：
     - `dsh-client-ui-renderer` 的 `_register()` 在官方注册时就 `this._acquire(store, scope)`，把 store handle **按对象身份**钉进私有 `_stores` Map；
     - 挂载时 `host.storeOf(entry)` → `resolveStore(entry.store)` 用 **live `entry.store`** 查 `_stores`，查不到直接抛 `"store handle is not registered (entry unloaded, or the handle never went through register)"` → 错误发生在 slot 装配层（早于我们的组件渲染），错误边界接不到 → **整个工作区区域不渲染**；
     - `dsh-client-store` 的 `defineStore(decl)` 返回 `{ spec: decl, create(scopeKey) { ...decl.persist / decl.init() / decl.actions ... } }` —— `create()` 读的是**闭包捕获的原 `decl` 对象**（与 `handle.spec` 同一引用），因此 `store.spec = { ...store.spec }` **整对象替换无效**，必须**原地改 `spec` 的属性**（`spec.actions` 加键、`spec.init` 包一层、`spec.persist` 改值），`create()` 才看得到。
   - **正确做法**：`sync()` 找到官方 entry 后（判定 `children?.['sidebar.workspaces.directoryFlow'] || options?.children?.[...]`）：
     - `entry.component = SafeWorkspaceBrowser(ourVendoredWorkspaceBrowser)`（组件 swap 保留，G2）；
     - `patchStoreSpec(official.store)`：在 `store.spec`（= decl，同一对象）上**原地**：`spec.actions.setBranchCollapsed` / `spec.actions.setAllBranchesCollapsed` 追加函数（记录函数身份，恢复时仅删除自己加的）；`spec.init` 包装为返回 `{ ...base, collapsedBranchesByAccount: base?.collapsedBranchesByAccount || {} }`；`spec.persist` 改为 `'dsh.workspace.view.v6'`（读旧用户状态；官方 v5 由 init 兜底）；
     - **不要重复声明** `sidebar.workspaces.directoryFlow`（官方已声明，重复注册失败）。
   - patch 时机：`ctx.effect` 内 `slots.subscribe('sidebar.workspaces', sync)` + 立即 `sync()`；root 渲染在 roster 稳定后，patch 先于首次实例化（`resolveStore` 在首次挂载时才 `handle.create()`，此刻已读到 patched spec）；restore 时还原 init/persist 并删除自己加的 action。
2. **组件 swap 保留**（G2）：`entry.component = SafeWorkspaceBrowser(ourVendoredWorkspaceBrowser)`；错误边界保留。
3. **注入面**：不再需要 `wrapInject` 加 `refreshSessions`；若新组件保留“刷新”按钮，在 vendored 组件内用 `ctx.sessions`/`ctx.workspaces` 的官方方法或直接依赖流式更新。
4. **`vendor-runtime.ts`**：改为从新 bundle 导出（保留 `WorkspaceBrowser`、`buildSessionTree`、`flattenSessionTree`、`findSessionAncestors`、`countDescendants`、`collectBranchIds`、`createWorkspaceViewStore` 导出面，供 `archived-settings.tsx` 复用；这些 helper 从 `src/client/branch/helpers.ts` 提供）。

### 5.4 步骤 4：设置页

- **保留 `settings.section` 注册**（管理页不是配置卡，`settings.plugin.item` 不适合）；契约兼容（list/root、`id`/`order`/`label` thunk/`inject`）。
- 可选项：去掉 `locale` 注册项（我们通过 inject 传 `t`，且 thunk 已跟随语言）；保留 `label: () => t('nav')`。
- `archived-settings.tsx` 的 `fetch('/branch-workspace/api/...')` 走我们自己的 Host API，不受客户端升级影响；`onMutated` 的 `refreshSidebar` 改为不依赖 `sessions.refresh`（官方流式模型自动收敛；保留可选链调用作为防御）。

### 5.5 步骤 5：构建与打包

- `tsdown.config.ts`：`CLIENT_EXTERNALS` 增加 `@deepseek-ai/dsh-client-ui-workspace/client` 之外的新增运行时包？——**不需要**：`@deepseek-ai/dsh-util-workspace-path`、`clsx` 由 `alwaysBundle` 内联（与官方 bundle 行为一致）；`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-primitives`、`react`、`react/jsx-runtime`、`cordis` 保持 external（运行时由 DSH 提供）。
- `src/client/index.tsx` 入口不变；bundle 仍输出 `lib/client.js`（懒加载 CJS 工厂）。
- `src/vendor/workspace-browser/client.cjs` 退役：删除或归档到 `docs/archive/`，避免与新版混淆；`src/client/branch/helpers.ts` 成为唯一分支算法来源。

### 5.6 步骤 6：验证矩阵

| 验证项 | 方法 | 通过标准 |
|--------|------|----------|
| 类型检查 | `npm run typecheck` | 0 error（含 vendored 源码） |
| 构建 | `npm run build` + `npm pack` | tgz 生成，`lib/client.js` 包含新样式哈希与新 locale |
| 侧边栏渲染 | 启动 DSH web，检查工作区浏览器 | 与官方观感一致；分组/排序/搜索/拖拽/HoverCard/目录流正常 |
| 新状态 | 有 approval/plan-review/question/schedule/completed 的会话 | 徽标与官方一致显示 |
| 分支折叠 | fork 出 2-3 层子会话 | 根会话 badge 计数正确；单分支折叠/展开；全局折叠；当前链自动展开 |
| 批量归档 | 多选 → 批量归档 → 已归档设置页 | 列表刷新、无重复、恢复/永久删除级联正确 |
| 设置页 | 打开 Settings → 已归档会话 | 树形展示、恢复/永久删除、时间排序、批量操作正常 |
| 持久化 | 刷新页面 | `collapsedBranchesByAccount` 从 v6 恢复；groupBy/orderBy/展开状态不丢 |
| HMR/重载 | 插件热重载 + 官方侧栏热重载 | 无重复 entry、无“Duplicate child declaration”、store 补丁不失效 |
| 回归 | 新会话/工作区创建、重命名、删除、fork、archive | 与官方行为一致，无控制台错误 |
| 其他插件 | `dsh-branch-graph-sidebar` 共存 | 无冲突（本插件不修改它） |

---

## 6. 当前工作树的可复现证据

```bash
# 1) 类型检查已失败（16:53 拷入的官方源码未接入构建链）
cd /root/Job/dsh-branch-workspace-folders
npx tsc -p tsconfig.json --noEmit   # 报错样例：
#   src/vendor/official-ui-workspace/index.ts(12,38): error TS2307: Cannot find module '@deepseek-ai/dsh-api-remotes/client'
#   src/vendor/official-ui-workspace/WorkspacePicker.tsx(21,17): error TS2307: Cannot find module './WorkspacePicker.module.css'
#   src/vendor/official-ui-workspace/index.ts(26,36): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled
#   src/vendor/official-ui-workspace/index.ts(76,14): error TS2339: Property 'remote' does not exist on type 'Context'
#   ...

# 2) 官方 0.1.2-rc.1 bundle 只导出 apply/inject
grep -o 'exports\.[A-Za-z0-9_]* =' node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js
#   exports.apply =  exports.inject =

# 3) 新旧 store persist key 不同
grep -o 'persist: "[^"]*"' src/vendor/workspace-browser/client.cjs          # dsh.workspace.view.v6
grep -o "persist: '[^']*'" src/vendor/official-ui-workspace/stores.ts       # dsh.workspace.view.v5

# 4) 旧 CJS 缺新 props/字段
grep -c 'useHostInfo\|useSessionPendingInteraction' src/vendor/workspace-browser/client.cjs   # 0
grep -c 'useHostInfo\|useSessionPendingInteraction' src/vendor/official-ui-workspace/rows/WorkspaceBrowser.tsx  # 2
```

---

## 7. 待验证 / 需在实现时确认的开放项

1. `ctx.sessions`（ClientSessions）在 0.1.2-rc.1 是否还有 `refresh()` / 等价重载方法；若无，`refreshSidebar` 的替代 API（官方流式模型 + `ctx.workspaces.list` 可观察源通常自动收敛）。
2. `@deepseek-ai/dsh-client-ui-settings` 0.1.2-rc.1 渲染 `settings.section` 时是否对 `label` thunk 每次求值（`resolveSlotLabel` 已支持；建议用官方 `slots.entries` 面板实测）。
3. `@deepseek-ai/dsh-util-workspace-path` 是否也可作为 external（若官方运行时已提供）；默认按官方 bundle 行为内联。
4. `settings.plugin.item` 的 `ui-settings-plugins` 包是否随官方发布（我们的 node_modules 未安装；若部署目标包含它，可作为“设置页 tab 化”的备选，但非本方案依赖）。
5. 旧 `v6` 持久化数据迁移：新 store 直接沿用 `v6` key，无需迁移；但要确认 `groupExpansion`/`sessionOrderByAccount` 等字段名在新旧之间未变（已确认一致）。

---

## 8. 参考文档（官方 0.1.2-rc.1）

| 文档 | 用途 |
|------|------|
| `docs/subsystems/web-client.md` | 客户端架构、服务面（ctx.sessions/ctx.workspaces/ctx.remote）、数据路径 |
| `docs/subsystems/slots.md` | 槽位注册/生命周期、标准 props、层级、扩展规则 |
| `docs/subsystems/client-modules.md` | `dsh.client` 声明、inject/external、bundle 路由 |
| `docs/subsystems/settings.md` | Host 设置 seam（namespace/scope/revision） |
| `docs/cookbook/adding-a-settings-card.md` | `settings.plugin.item` + `ctx.settingsScope` 配置卡模式 |
| `docs/cookbook/adding-a-vendored-package.md` | vendored 源码的 tsconfig/package.json 规范 |
| `docs/web-styling.md` | CSS Modules + `--dsw-alias-*` token 规范 |
| `docs/subsystems/workspace.md` | Host workspace registry / `ctx.workspaceController` Remote 面 |
| `node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js` | 官方 0.1.2-rc.1 编译产物（事实基准） |
| `node_modules/@deepseek-ai/dsh-client-store/lib/types/index.d.ts` | `defineStore`/`EngineStoreHandle`/`StoreSpec` 契约 |
| `node_modules/@deepseek-ai/dsh-client-ui-settings/lib/types/client/contract/slots.d.ts` | `settings.section` 等设置槽契约 |
