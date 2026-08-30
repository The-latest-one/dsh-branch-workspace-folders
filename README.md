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
  - 设置页「已归档会话」：在 DSH Settings 中列出已归档会话树，支持恢复（unarchive）和根分支永久删除（级联删除该根及其所有 fork 后代）。
  - Host API：`GET /branch-workspace/api/archives`、`POST /branch-workspace/api/restore`、`POST /branch-workspace/api/purge`（永久删除使用 `.trash-sessions` 暂存 + registry 更新 + 成功后物理删除，失败自动回滚）。

## 安装到 DSH profile

推荐使用一键自动安装命令：

```bash
npm run install:dsh
```

脚本会自动完成：

1. `npm run typecheck`
2. `npm run build`
3. `npm pack`
4. 将 tarball 复制到 profile 的 `vendor/` 目录
5. 在 `${DSH_HOME:-$HOME/.dsh}/profiles/web` 下执行 `pnpm install`
6. 如果 pnpm 因 profile 内其他远程依赖（如 GitHub 依赖）无法联网而失败，会自动降级为“直接同步插件文件到已安装的 node_modules”，然后重启 `dsh web`

也可以手动指定仓库、profile 和启动目录：

```bash
bash scripts/install-readonly.sh \
  /root/dsh/new/dsh-branch-workspace-folders \
  /root/.dsh/profiles/web
```

常用环境变量：

- `DSH_HOME`：DSH 数据目录，默认 `$HOME/.dsh`
- `DSH_PROFILE`：目标 profile 路径，默认 `${DSH_HOME}/profiles/web`
- `DSH_START_DIR`：重启 `dsh web` 时的工作目录，默认 `$HOME`
- `NPM_CACHE_DIR`：npm pack 使用的缓存目录，默认 `/tmp/dsh-npm-cache`
- `PNPM_STORE_DIR` / `PNPM_CACHE_DIR`：可选，传给 pnpm 的 store/cache 目录

如果手动安装，在 DSH profile 的 `package.json` 中增加依赖和 bundle：

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
