# dsh-branch-workspace-folders

[![Version](https://img.shields.io/badge/version-v0.1.15-blue.svg)](package.json)
[![DSH Compatibility](https://img.shields.io/badge/DSH-v0.1.7--rc.1-success.svg)](package.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-33%2F33%20passing-brightgreen.svg)](tests/)

> DeepSeek Harness (DSH) 官方生态全功能增强插件：严格基于官方原生 UI/UX 设计契约，深度重构侧边栏工作区与会话树。提供**全量非递归防爆栈会话树**、**`placeFork` 智能分叉排序聚类**、**原生 L 型树导轨与字阶分层**、**折叠场景状态通道冒泡**、**已归档三态过滤**以及**会话级联物理永久删除（Purge）安全事务引擎**。

---

## 🌟 核心特性与解决的痛点

### 1. 树状层级呈现与视觉重构 (Universal Fork Tree & Visual Hierarchy)
- **多分组模式通用覆盖**：无论用户选择 `workspace`（工作区分组）、`workspace-tree`（物理目录树）还是 `flat`（全局平铺），所有分叉会话均基于 `parentId` 聚合归入对应的根会话之下。
- **双轨缩进解耦系统**：独立分配 `--dsh-branch-indent: calc(depth * 16px)` 与 `--dsh-workspace-indent`，彻底解决在 `workspace-tree` 模式下目录缩进被子会话覆盖所导致的负缩进视觉错位。
- **排版字阶分层 (Typography Hierarchy)**：
  - **根会话 / 父会话**：启用 `font-weight: 500`（Medium）并保持最高对比度的文本主色，形成清晰的视觉锚点；
  - **分支子会话**：字色降低至次级文本色（`var(--dsw-alias-label-secondary)`），悬停（hover）或选中（selected）时自适应提亮；
  - **L 型物理拐角与网格导轨**：引入 DSH 原生 `IconTreeCornerRegular` 矢量导轨，对于 `depth >= 2` 的深层嵌套自动启用纯 CSS 背景多级辅助线（`.deepBranch`），0 额外 DOM 开销；
  - **WCAG AA 对比度保全**：归档会话（`opacity: 0.48`）下的子会话标题自动强制提升为 Primary 颜色，防止次级色与半透明叠加导致对比度低于 4.5:1 的无障碍标准。

### 2. 排序引擎与视图控制 (Sorting & View Options)
- **`placeFork` 原生智能排序聚类**：
  - 深度对齐 DSH 官方 0.1.7-rc.1 排序规范。新派生出来的 Fork 会话通过 `placeFork` 算法**自动定位并紧贴在父会话正上方**，拒绝将新分支随意抛到列表最前端或末尾，保持家族会话时序一致性。
- **严格视图排序选项 (Order By)**：
  - 仅提供官方原生支持的两种排序模式：`manual`（用户手动拖拽自由排序）与 `updated`（按最近活跃时间倒序重排），无虚构或不稳定模式。
- **会话状态三态过滤 (Archived Filter)**：
  - 在视图菜单中内置：`all`（显示全部会话）、`hide-archived`（默认，仅显示未归档会话）、`only-archived`（仅显示已归档会话，便于侧边栏直接查阅历史）。
  - 搜索结果直接提供快捷解冻操作（`IconUnarchiveOutlineRegular`）。
- **全局分支树控制 (Branch Controls)**：
  - 在视图选项菜单中提供一键「全部展开分支」与「全部折叠分支」，状态由 `localStorage`（键名: `dsh.branch.collapsed.v1`）持久化驱动。
- **折叠祖先反向视觉寻路 (`isCurrentCollapsedAncestor`)**：
  - 若当前选中的活跃会话位于某一折叠分支下，可见的折叠祖先节点的折叠箭头与分支徽章会自动高亮为业务主色（`var(--dsw-alias-state-business-primary)`），并赋予 `title="当前工作区 · 当前折叠会话"`，助用户一键看清当前会话所属族谱。
- **面板激活抑制高亮 (`usePanelInfo`)**：
  - 用户打开系统设置、全局文件等全屏或浮层面板时，侧边栏自动抑制会话的选中高亮底色，避免视觉双焦点冲突。

### 3. 折叠状态通道冒泡 (Status Bubbling)
- **运行盲区自愈**：当用户折叠带有正在执行任务的会话家族时，子孙节点的活跃状态自动向上冒泡代理至根会话。
- **严密优先级仲裁 (Priority FSM)**：
  1. `Warning`（最高优先级）：任何后代等待交互（`approval` 待审批、`plan-review` 计划待审、`question` 待回答）时，根节点显示琥珀色警告点，且行尾时间戳替换为具体阻塞动作（如“待审批 / 计划待审 / 待回答”）；
  2. `Ongoing`（次高优先级）：任何后代处于 `running === true` 或有子智能体运行时，根节点显示与全局同相旋转的原生 14px 加载菊花；
  3. `Done`（静默提醒）：后代有新完成会话时冒泡绿色提示点；
  4. `Idle`：全体空闲时保持无点清爽状态。
- **本体优先原则**：根会话自身有活跃状态时，始终优先展示自身。

### 4. 会话级联物理永久删除事务 (Physical Cascade Purge)
- **核心价值补全**：官方原生仅支持软归档（Archive），磁盘历史 `.jsonl.zstd` 与 SQLite 索引永久留存。本项目提供真正的物理永久删除能力。
- **`.trash-sessions` 事务隔离与逆序回滚**：
  - 物理移动日志至隔离区 -> 原子更新 `workspace.json`（同步清理 `sessionOrder`、`archivedSessionIds` 与 `pinnedSessionIds`，杜绝悬空索引）-> 提交清空。
  - 遇到异常自动执行逆序回滚，保障数据零丢失。
- **全套 Host REST API**：
  - `GET  /branch-workspace/api/health`：服务就绪健康自检探针；
  - `GET  /branch-workspace/api/archives`：树形已归档会话检索；
  - `POST /branch-workspace/api/purge`：单会话家族物理级联删除；
  - `POST /branch-workspace/api/purge-batch`：多会话批量物理级联删除；
  - `POST /branch-workspace/api/restore`：单会话激活恢复；
  - `POST /branch-workspace/api/restore-batch`：多会话批量取消归档；
  - `POST /branch-workspace/api/restore-branch`：分支拓扑级联恢复（一键恢复整棵分支树下所有已归档会话）。
- **设置页已归档治理面板**：在 `settings.section`（id: `branch-workspace-archives`）提供完整的已归档会话树、级联恢复与物理清理。

### 5. 极致工程可靠性 (Engine Reliability)
- **全量非递归显式栈算法**：`buildSessionTree`、`flattenSessionTree`、`findSessionAncestors`、`aggregateDescendantStatus`、`sortTreeByUpdatedAt` 全部采用堆内显式栈迭代，经受住 20,000 层极端深度与多重环形拓扑压力测试，杜绝 `RangeError: Maximum call stack size exceeded`。
- **下线过时解压端点**：彻底移除旧版在 Host 端全量解压全部会话的 `GET /clusters` 端点，杜绝磁盘 IO 爆炸。
- **In-Place Shadowing 降级保护**：通过插槽就地代理官方 `sidebar.workspaces`，并内嵌 React `ErrorBoundary`。任何极端异常自动回退至原生组件，绝不白屏。
- **流式 Zstd 日志容错解包**：纯手工帧切分算法（`scanZstdFramesWithTorn`），容忍系统崩溃带来的追加写尾部残帧（torn tail），完美支持 V3/V2/V0 格式。
- **网络与安全隔离**：Host API 严格校验回环 IP 绑定（`isLoopback`）与浏览器 `Sec-Fetch` 跨站防御，杜绝外部网络与 CSRF 穿透。

---

## 🏗 系统架构设计

详细的系统拓扑、算法复杂度、时序图与状态机设计请参阅：
👉 [架构与核心机制技术白皮书 (docs/ARCHITECTURE.md)](docs/ARCHITECTURE.md)

---

## 📦 安装与集成

### 方式一：一键自动安装到本地 DSH Profile（推荐）

```bash
npm run install:dsh
```

脚本将自动执行：双端类型检查 -> 编译构建 -> npm 打包 -> 部署至 `${DSH_HOME:-$HOME/.dsh}/profiles/web` -> 自愈 node_modules junction 并重启 Web 服务。

### 方式二：超级模组运行时热注入（开发免重启）

如果当前 DSH 环境装有 `dsh-super-injector`（开发基建）：

```bash
# 1. 运行时直接注入（不修改 patch、不重启）：
dev_inject_plugin {"dir": "/path/to/dsh-branch-workspace-folders"}

# 2. 修改代码后执行确定性热重载：
dev_reload_package {"packageName": "dsh-branch-workspace-folders"}
```

### 方式三：手动配置

在 DSH profile 的 `package.json` 中配置：

```json
{
  "dependencies": {
    "dsh-branch-workspace-folders": "link:/path/to/dsh-branch-workspace-folders"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-branch-workspace-folders"
      ]
    }
  }
}
```

并在 profile 目录运行 `pnpm install` 后重启服务。

---

## 🛠 开发、构建与验证工作流

本项目贯彻 **Grounded Verification Gate（证据硬约束与验收门禁）**，所有交付必须按以下顺序完成全链路实测验证：

```bash
# 1. 前后端双端严格类型检查
npm run typecheck

# 2. 编译 Host 声明文件 + tsdown 打包客户端 client.js + 自动内联 CSS
npm run build

# 3. 运行自动化测试套件（必须全部 33/33 PASS）
npm test

# 4. 如当前处于 DSH 运行时，触发插件热重载生效
dev_reload_package {"packageName": "dsh-branch-workspace-folders"}
```

---

## 🛡 核心设计不变量与避坑守则

为保证长期维护的稳定性，后续开发修改严禁违反以下规范：

1. **`WorkspacePickFlow` 绝不能使用条件渲染**：
   [`WorkspaceBrowser.tsx`](src/vendor/official-ui-workspace/rows/WorkspaceBrowser.tsx) 中的 `<WorkspacePickFlow>` 必须常驻 DOM 树，仅通过 `open={wsPickerOpen}` prop 控制。若使用 `{wsPickerOpen && <WorkspacePickFlow />}`, 组件内部快速分支调用 `onClose()` 会把外层设为 false，导致弹窗被整机卸载，表现为“点击添加工作区完全没反应”。
2. **分支折叠状态双轨驱动**：
   Store 初始状态可能为空对象 `{}`（在 JS 中 `{}` 为真值，会导致 `??` 空值合并短路）。折叠状态必须由 `dsh.branch.collapsed.v1` 本地持久化与 local state 进行主驱动并由 `useMemo` 合并。
3. **保持行操作 Slot 化**：
   严禁在 [`Rows.tsx`](src/vendor/official-ui-workspace/rows/Rows.tsx) 中硬编码菜单项。必须使用 `renderSlot('sidebar.workspaces.session.menu.item')`，否则会阻断官方 0.1.7-rc.1 的 Pin（会话置顶）及其他插件扩展动作。
4. **子智能体（Subagent）隔离**：
   构建树时必须过滤 `origin === 'subagent'` 的瞬态会话，防止海量子智能体会话污染侧边栏。

---

## 📄 开源许可证

本项目基于 [MIT 许可证](LICENSE) 发布。
如需商业支持或定制开发，欢迎提交 Issue 或 Pull Request。
