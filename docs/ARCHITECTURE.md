# dsh-branch-workspace-folders 架构与核心机制技术白皮书

本文档面向核心维护者与架构审查员，系统阐述 `dsh-branch-workspace-folders`（版本: v0.1.15）在 DeepSeek Harness (DSH) 官方生态下的内部系统拓扑、事务机制与算法契约。

---

## 目录
1. [系统总体拓扑 (System Topology)](#1-系统总体拓扑)
2. [Client 端：插槽就地代理与渲染管线](#2-client-端插槽就地代理与渲染管线)
3. [会话拓扑与排序引擎：非递归显式栈算法](#3-会话拓扑与排序引擎非递归显式栈算法)
4. [视觉层次与双轨缩进解耦系统](#4-视觉层次与双轨缩进解耦系统)
5. [折叠状态通道冒泡与优先级仲裁器](#5-折叠状态通道冒泡与优先级仲裁器)
6. [三态过滤与祖先反向视觉寻路](#6-三态过滤与祖先反向视觉寻路)
7. [Host 端：会话级联物理永久删除 (Purge) 事务引擎](#7-host-端会话级联物理永久删除-purge-事务引擎)
8. [安全防线与网络隔离审计](#8-安全防线与网络隔离审计)
9. [核心设计不变量与陷阱防护](#9-核心设计不变量与陷阱防护)

---

## 1. 系统总体拓扑

本项目采用 **Cordis 架构下的双端插件（Dual-Stack Plugin）** 模式构建，宿主与客户端协同工作：

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DeepSeek Harness Runtime                        │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                      Client Web 前端 (Browser)                  │   │
│   │                                                                │   │
│   │  [In-Place Shadowing]                                          │   │
│   │   └─ SafeWorkspaceBrowser (ErrorBoundary 保护代理)             │   │
│   │       ├─ WorkspaceBrowser (通用工作区/会话导航主入口)           │   │
│   │       │   ├─ branch.ts (非递归防爆栈会话树构建/展开/状态聚合)   │   │
│   │       │   ├─ tree.ts (placeFork 排序 / 归档过滤 / 手动排序对齐) │   │
│   │       │   └─ Rows.tsx (L型树导轨 / 500字阶 / 状态冒泡呈现)      │   │
│   │       └─ ArchivedSettings (设置页物理删除治理面板)             │   │
│   └────────────────────────────────┬───────────────────────────────┘   │
│                                    │ HTTP REST API                     │
│                                    │ Loopback Only + Sec-Fetch 校验    │
│   ┌────────────────────────────────▼───────────────────────────────┐   │
│   │                      Host 端 Node.js (Backend)                 │   │
│   │                                                                │   │
│   │  [Host HTTP Router: /branch-workspace/api/*]                   │   │
│   │   ├─ GET  /health          (服务就绪健康自检探针)              │   │
│   │   ├─ GET  /archives        (树形已归档会话检索)                │   │
│   │   ├─ POST /purge           (单家族会话级联物理永久删除)        │   │
│   │   ├─ POST /purge-batch     (多会话批量物理级联删除)            │   │
│   │   ├─ POST /restore         (单会话取消归档激活)                │   │
│   │   ├─ POST /restore-batch   (多会话批量取消归档)                │   │
│   │   └─ POST /restore-branch  (分支拓扑级联取消归档)              │   │
│   │       ├─ lineage.ts (拓扑溯源 collectFamilyIds，防环/孤儿感知) │   │
│   │       ├─ zstd.ts (scanZstdFramesWithTorn，尾部截断容错流切分)  │   │
│   │       └─ 事务控制器 (.trash-sessions 隔离 -> 逆序回滚保障)     │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

> **历史端点下线说明**：早期版本曾提供 `GET /clusters` 端点用于全量解压所有历史会话日志构建集群，导致严重的磁盘 IO 争抢。0.1.15 版本已彻底下线该端点，改由前端轻量级非递归内存构建。

---

## 2. Client 端：插槽就地代理与渲染管线

### 2.1 In-Place Shadowing (就地代理)
官方 `sidebar.workspaces` 条目绑定了私有生命周期与内部路由，直接卸载或重新注册会导致侧边栏状态撕裂。
本项目在 `src/client/index.tsx` 中采用就地替换机制：
1. 在 `client.entries()` 账本中查找到官方的 `sidebar.workspaces`；
2. 提取官方原始组件作为安全兜底源；
3. 将该条目的 `component` 属性动态覆写为 `SafeWorkspaceBrowser`；
4. `SafeWorkspaceBrowser` 内嵌 React `ErrorBoundary`：一旦由于极端异常或数据冲突触发 UI 崩溃，组件会自动降级回退至官方原生渲染器，同时在控制台记录故障上下文，绝不导致整个应用白屏。

### 2.2 视图模式全覆盖 (Universal Grouping Modes)
侧边栏支持由官方定义的全部三种模式，并深度整合分支分叉树（Fork Tree）：
- **`workspace` (标准工作区分组)**：工作区以扁平卡片折叠呈现，内部会话按分支家族聚合。
- **`workspace-tree` (工作区层级树)**：工作区按照物理磁盘目录树嵌套呈现，每个目录节点下的会话同样按分支家族聚合。
- **`flat` (全量平铺列表)**：消除工作区边界，跨工作区按根会话分支树统一投影。

### 2.3 全局面板激活时抑制侧栏高亮 (`usePanelInfo`)
当用户切换至系统设置（`settings`）、文件面板或全局工具时，侧边栏通过 `usePanelInfo` 自动抑制会话的选中（`selected`）高亮底色，消除双焦点视觉冲突。

---

## 3. 会话拓扑与排序引擎：非递归显式栈算法

### 3.1 堆内显式栈迭代 (Heap-Allocated Explicit Stack)
在 JavaScript 引擎中，深度调用栈（Call Stack）上限通常在 10,000 层左右。长链连续分叉会话（Fork Chains）会造成深层递归 `Maximum call stack size exceeded`。
本项目在 [`src/vendor/official-ui-workspace/branch.ts`](src/vendor/official-ui-workspace/branch.ts) 中重构了全部算法为**堆内显式栈（Heap-Allocated Explicit Stack）迭代**，经实测可承受 20,000+ 层深度的单链运算。

| 函数名 | 算法结构 | 防爆栈深度 | 防环死锁机制 | 功能说明 |
|---|---|---|---|---|
| `buildSessionTree` | 广度优先标记可达性 + DFS 栈遍历 | 20,000+ 层通过 | `reachable Set` 识别闭环并标记 `node.cycle = true` | 将扁平会话映射为多叉树，父会话缺失时提升为独立根节点并标记 `orphan = true` |
| `flattenSessionTree` | 显式后序遍历入栈，LIFO 出栈 | 20,000+ 层通过 | `seen Set` 访问标记 | 将树展开为带精确 `depth` 属性的行渲染队列，折叠节点直接剪枝 |
| `findSessionAncestors` | 反向指针链表（`AncestorLink`）+ 显式栈 | 20,000+ 层通过 | `seen Set` 访问标记 | O(N) 极速查找目标会话的所有父系祖先路径 |
| `aggregateDescendantStatus` | 自顶向下显式栈遍历 | 20,000+ 层通过 | `seen Set` 闭环跳过 | 快速仲裁并冒泡后代节点中的最高优先级状态 |
| `sortTreeByUpdatedAt` | 自底向上非递归后序克隆排序 | 15,000+ 层通过 | `seen Set` 访问标记 | 递归安全地按更新时间重排树节点结构 |

### 3.2 `placeFork` 智能分叉排序聚类
在 [`src/vendor/official-ui-workspace/tree.ts`](src/vendor/official-ui-workspace/tree.ts) 中，重构了 `reconcileManualOrder` 算法：
- 当用户从任意会话发起 Fork 时，如果采用默认逻辑，新会话容易被置于整个列表顶部或底部；
- 本项目实现了 `placeFork` 聚类算法：通过反向回溯 `parentId` 链路，将新派生的子会话**自动插入并紧靠在其父会话的正上方**，保障家族派生关系与视觉时序的一致性。

---

## 4. 视觉层次与双轨缩进解耦系统

### 4.1 几何错位根因与双轨变量解耦
- **原生冲突**：在 `workspace-tree` 模式下，工作区目录嵌套使用了 `--dsh-workspace-indent: ${depth * 12}px`。原先子会话也写入该变量，导致子会话缩进抹平了父工作区缩进，发生严重的负缩进错位。
- **解耦公式**：
  在 [`Rows.module.css`](src/vendor/official-ui-workspace/rows/Rows.module.css) 中声明两个独立的 CSS 变量：
  ```css
  padding-inline-start: calc(8px + var(--dsh-workspace-indent, 0px) + var(--dsh-branch-indent, 0px));
  ```
  - `--dsh-workspace-indent`：专属工作区目录层级（步进模数: 12px）；
  - `--dsh-branch-indent`：专属于分支会话层级（步进模数: 16px）。

### 4.2 排版字阶分层与导轨设计
- **字重锚点**：`.branchRoot .title` 与 `.branchParent .title` 设置为 `font-weight: 500`（Medium），确立家族视觉核心。
- **字色对比**：`.branchChild:not(.branchParent) .title` 设为次级文本色 `var(--dsw-alias-label-secondary)`，在 `:hover` 与 `.selected` 状态下无缝提亮为 `var(--dsw-alias-label-primary)`。
- **L 型物理拐角**：子会话左侧引入官方原生 `IconTreeCornerRegular`（SVG 矢量拐角导轨），统一在 18px 宽度的 `.branchGuideSlot` 居中，与父节点的折叠按钮物理中轴线 100% 垂直共线。
- **多级垂直导轨网格（`.deepBranch`）**：
  对于 `depth >= 2` 的深度分叉，采用纯 CSS `repeating-linear-gradient` 在背景绘制 16px 间隔的极细导轨线（`var(--dsw-alias-border-l4)`），0 额外 DOM 开销，直观展现多级继承关系。
- **WCAG AA 归档对比度保全**：
  在归档行（`opacity: 0.48`）中，分支子会话的标题颜色强制覆盖为 Primary，防止次级色叠加透明度后发生低对比度辨识障碍。

---

## 5. 折叠状态通道冒泡与优先级仲裁器

当用户将一个正在运行任务的分支折叠收起时，通过状态通道冒泡（Status Bubbling）机制，确保根节点能够代理呈现后代的活跃状况。

### 5.1 状态优先级有限状态机 (Priority FSM)

```
        ┌───────────────────────────────────────────────────┐
        │ 检查根节点本体自身状态 (Own Status)                │
        │ 若 ownActive === true，直接展示自身，不冒泡       │
        └─────────────────────────┬─────────────────────────┘
                                  │ ownActive === false (自身处于 Idle)
                                  ▼
        ┌───────────────────────────────────────────────────┐
        │ 执行 aggregateDescendantStatus 遍历折叠子树        │
        └─────────────────────────┬─────────────────────────┘
                                  │
          ┌───────────────────────┼────────────────────────┐
          │ (优先级 1)             │ (优先级 2)              │ (优先级 3)
          ▼                       ▼                        ▼
[存在 pendingInteraction]    [存在 running / subagents]    [存在 completed]
  - 渲染 Warning 琥珀圆点      - 渲染 Ongoing 旋转动画        - 渲染 Done 绿色圆点
  - 尾部文字替换为具体动作:      - 保持默认相对时间戳          - 保持默认相对时间戳
    "待审批" / "计划待审"
```

### 5.2 性能保证与依赖项净化
在 [`Rows.tsx`](src/vendor/official-ui-workspace/rows/Rows.tsx) 中：
- `sessionStatuses` 与 `ownActive` 计算内聚于 `useMemo` 内部；
- 依赖项仅监听纯值与稳定引用：`[collapsed, branchChildren.length, node, t]`；
- 杜绝因 hover、focus 或局部状态抖动造成的缓存穿透与无谓树遍历。

---

## 6. 三态过滤与祖先反向视觉寻路

### 6.1 `archivedFilter` 视图过滤
在 `ViewOptionsMenu` 中提供三态切换：
- `all`：包含活跃与已归档全部会话；
- `hide-archived`：默认状态，完全隐藏归档会话；
- `only-archived`：仅显示归档会话。
归档行沉降至列表末尾，搜索结果中提供快捷恢复按钮（`IconUnarchiveOutlineRegular`）。

### 6.2 折叠祖先反向视觉寻路 (`isCurrentCollapsedAncestor`)
当激活会话隐藏在已折叠的祖先分支下时：
- 通过 `findSessionAncestors` 反向定位折叠祖先；
- 祖先节点的折叠箭头与分支 Badge 激活为 DSH 业务主色（`var(--dsw-alias-state-business-primary)`）；
- 赋予无障碍说明：`当前工作区 · 当前折叠会话`，指引用户快速展开定位。

---

## 7. Host 端：会话级联物理永久删除 (Purge) 事务引擎

### 7.1 事务执行流时序

```
Client (POST /purge)
  │
  ├── 1. 安全前置检查 (isLoopback + Sec-Fetch Anti-CSRF)
  │
  ├── 2. 拓扑级联溯源 (lineage.ts: collectFamilyIds)
  │      提取目标根会话及其所有历史分叉子孙 (包含已归档但未物理清除的孤儿)
  │
  ├── 3. 物理文件事务暂存 (.trash-sessions)
  │      原子将对应会话的 session.v3.jsonl.zstd (或历史版本) 重命名移动到暂存区
  │
  ├── 4. 工作区注册表清理 (Workspace Registry Detach)
  │      原子更新 workspace.json:
  │      - 从 sessionOrder 中移除
  │      - 从 archivedSessionIds 中清理
  │      - 从 pinnedSessionIds 中清理 (杜绝悬空索引)
  │
  ├── 5. 提交物理清空 (Commit Purge)
  │      完全删除 .trash-sessions 内的文件
  │      [发生异常时]: 自动执行逆序回滚 (Reverse Rollback)，将暂存文件原样移回
  │
  └── 6. 响应 Client 刷新信号
```

### 7.2 流式 Zstd 日志容错解包器 (`zstd.ts`)
DSH 的底层日志为追加写（append-only）的 Zstd 压缩流。如果程序在写入中途异常中断，文件尾部会出现残缺帧（torn tail）。
本项目纯手工实现了 `scanZstdFramesWithTorn`：
- 自行解析 Zstd 帧魔数（`0xFD2FB528`）；
- 切分出每一个完整的压缩帧分别送入 `zstdDecompress`；
- 能够宽容并丢弃尾部的 torn 截断残帧，保障极端宕机恢复后的数据依然可完整溯源。

---

## 8. 安全防线与网络隔离审计

1. **严格回环绑定限制（Loopback Only）**：
   - 内部 API 端点仅接受回环 IP（`127.0.0.1`、`::1`、`::ffff:127.0.0.1`）。外部网络流量直接返回 `403 Forbidden`。
2. **跨站请求伪造防御（Sec-Fetch Anti-CSRF）**：
   - 针对浏览器发起的请求，校验 `Sec-Fetch-Site` 必须为 `same-origin` 或 `none`；
   - 校验请求 `Host` 头必须为有效回环权威域，防范基于 DNS Rebinding 的跨域攻击。
3. **路径遍历防御（Path Traversal Guard）**：
   - 会话 ID 输入严格校验 `isValidSessionId` 正则：`^[a-zA-Z0-9_\-\.]{1,128}$`，拦截任何带有 `..` 或斜杠的非法载荷。

---

## 9. 核心设计不变量与陷阱防护

在后续开发中，严禁破坏以下四条核心防线：

1. **`WorkspacePickFlow` 绝不能使用条件渲染**：
   `WorkspaceBrowser.tsx` 中的 `<WorkspacePickFlow>` 必须常驻 DOM 树，仅通过 `open={wsPickerOpen}` prop 控制气泡显隐。使用 `{wsPickerOpen && <WorkspacePickFlow />}` 会导致弹窗被组件内部分支的 `onClose` 整机卸载，引发“添加工作区按钮失效”。
2. **分支折叠状态双轨驱动**：
   Store 初始状态可能为空对象 `{}`（在 JS 中 `{}` 为真值，会导致 `??` 逻辑短路）。必须由 `dsh.branch.collapsed.v1` 本地持久化与 local state 进行主驱动并由 `useMemo` 合并。
3. **保持行操作 Slot 化**：
   严禁在 `Rows.tsx` 中硬编码行操作菜单。必须使用 `renderSlot('sidebar.workspaces.session.menu.item')`，否则会阻断官方 Pin 及其他插件的插槽扩展。
4. **子智能体（Subagent）隔离**：
   构建树时必须过滤 `origin === 'subagent'` 的瞬态会话，防止海量子智能体会话污染侧边栏。
