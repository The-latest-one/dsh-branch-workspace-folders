# dsh-branch-workspace-folders

DSH Web 左侧工作区/会话栏插件：在官方 `@deepseek-ai/dsh-client-ui-workspace` WorkspaceBrowser 的基础上，根据 `parentId` / 根会话关系，把同一棵分叉树的所有会话折叠到对应根会话下，形成树形“分支文件夹”。

## 特性

- 复用官方 WorkspaceBrowser 渲染与 CSS，保持原生 DSH Web 观感。
- 按 `parentId` 将 forked sessions 折叠到根会话下：
  - 根会话显示分支数 badge；
  - 支持单分支折叠/展开；
  - 当前会话所在根/分支链自动展开。
- 保留官方能力：
  - groupBy：`workspace` / `flat`；
  - orderBy：`manual` / `updated`，并扩展 `default` / `title` / `running`；
  - 拖拽排序、新建 workspace/session、重命名/删除/fork/archive；
  - 搜索 + snippet、HoverCard、时间/状态、ARIA tree、Rail 模式。
- 额外提供：
  - 全局展开/折叠所有工作区；
  - Refresh 按钮（刷新 sessions）；
  - 溢出折叠（默认 5 条后显示 “Show more sessions”）。

## 安装到 DSH profile

在 DSH profile 的 `package.json` 中增加依赖和 bundle：

```json
{
  "dependencies": {
    "dsh-branch-workspace-folders": "file:/path/to/dsh-branch-workspace-folders-0.1.0.tgz"
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

然后在 profile 目录执行：

```bash
pnpm install --offline --no-frozen-lockfile
```

重启 DSH Web 后生效。

## 开发

```bash
npm run typecheck
npm run build
npm test
```

## 注意

- 本插件独立于 `dsh-branch-graph-sidebar`，不修改该插件。
- 只负责左侧工作区/会话栏，不影响会话正文/消息流。
