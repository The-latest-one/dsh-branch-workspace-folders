# dsh-branch-workspace-folders

🌐 **English** | [中文](README.zh.md)

[![Version](https://img.shields.io/badge/version-v0.2.0-blue.svg)](package.json)
[![DSH Compatibility](https://img.shields.io/badge/DSH-v0.2.0--rc.2-success.svg)](package.json)
[![CI](https://github.com/JIaDE-YX/dsh-branch-workspace-folders/actions/workflows/ci.yml/badge.svg)](https://github.com/JIaDE-YX/dsh-branch-workspace-folders/actions)
[![GitHub Release](https://img.shields.io/github/v/release/JIaDE-YX/dsh-branch-workspace-folders)](https://github.com/JIaDE-YX/dsh-branch-workspace-folders/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-45%2F45%20passing-brightgreen.svg)](tests/)

> DeepSeek Harness (DSH) full-featured ecosystem extension: strictly aligned with official UI/UX design contracts to deeply rearchitect the sidebar workspace and session tree. Delivers **heap-allocated non-recursive stack-safe session trees**, **`placeFork` intelligent fork clustering**, **two-track indentation decoupling**, **constant-speed title marquee with fade masking**, **official leading & hover slot compatibility**, **collapsed status bubbling**, **archived tri-state filtering**, and a **physical cascading purge transaction engine**.

---

## 🌟 Key Features & Problems Solved

### 1. Universal Fork Tree & Visual Hierarchy
- **Universal Grouping Coverage**: In `workspace` (grouped), `workspace-tree` (physical directory tree), or `flat` (single list) mode, all forked sessions cluster under their designated root session based on durable lineage.
- **Two-Track Indentation Decoupling**: Independently allocates `--dsh-branch-indent: calc(depth * 16px)` and `--dsh-workspace-indent`, completely resolving negative indentation and layout displacement under nested directory tree modes.
- **Official Slot Ecosystem Integration (Leading & Hover Slots)**: Fully supports DSH v0.2.0-rc.2 two-tier session row contracts:
  - **Leading 16px Cell Arbitration**: Prioritizes warning/running state dots; when idle, unarchived, and non-blank, delegates to `sidebar.session.row.leading` for native automation indicator anchors (e.g. `dsh-schedule` task clock icon);
  - **Hover Card Injection**: Mounts `sidebar.session.row.hover` in `SessionHoverContent` for external task inspection.
- **Smooth Title Marquee (`useTitleMarquee`)**: Replicates official 0.03px/ms constant-speed crawling with 12px double-edge linear gradient fade masks (`[data-scrolled]` & `[data-clipped]`), dynamic ellipsis cut-off (`text-overflow: clip`), and full `prefers-reduced-motion` compliance.
- **AnimatedRows Layout Contract**: Injects semantic `data-row-key` attributes across sessions and workspaces to seamlessly integrate with official FLIP layout animations.
- **Typography Hierarchy**:
  - **Root / Parent Sessions**: Highlighted with `font-weight: 500` (Medium) and primary text color;
  - **Branch Child Sessions**: Subdued to secondary text color (`var(--dsw-alias-label-secondary)`), brightening dynamically on hover/selection;
  - **L-shaped Guide Rails**: Native `IconTreeCornerRegular` coupled with zero-DOM CSS background multi-level guide rails (`.deepBranch` for `depth >= 2`).

### 2. Sorting Engine & View Controls
- **`placeFork` Native Clustering**: Re-orders forked sessions immediately adjacent to and above their parent session rather than dumping them at arbitrary list ends.
- **Strict View Order By**: Strictly limits ordering to officially supported modes: `manual` (drag-and-drop reordering) and `updated` (recency sort).
- **Tri-State Archive Filtering**: Supports `all` (show all), `hide-archived` (default), and `only-archived` (inspect archive history directly in the sidebar).
- **Collapsed Ancestor Pathfinding (`isCurrentCollapsedAncestor`)**: When the active session is hidden beneath a folded branch, ancestor chevrons and badges highlight in business primary color (`var(--dsw-alias-state-business-primary)`).
- **Panel Activation Dimming (`usePanelInfo`)**: Suppresses session selection backgrounds when full-screen settings or file panels are active to prevent dual-focus visual conflict.

### 3. Collapsed Status Bubbling
- **Blindspot Self-Healing**: When a session family with active runs is collapsed, descendant statuses bubble up to the visible root node.
- **Strict Priority State Machine**:
  1. `Warning` (Highest): Bubble amber dot and replace trailing timestamp with explicit action label (e.g., "Waiting Approval", "Plan Review", "Waiting Answer");
  2. `Ongoing` (Secondary): Displays spinning loading indicator when descendant or subagents are running;
  3. `Done` (Silent reminder): Green dot when child work completes;
  4. `Idle`: Clean state when all family members are idle.

### 4. Physical Cascade Purge Transaction Engine
- **True Physical Deletion**: Complements official soft-archiving by providing genuine on-disk cascading physical deletion of `.jsonl.zstd` logs and workspace registry cleanup.
- **`.trash-sessions` Isolation & Rollback**: Quarantine directory isolation -> atomic workspace state mutation (cleaning `sessionOrder`, `archivedSessionIds`, `pinnedSessionIds`) -> permanent commit. Automatically rolls back in reverse order upon filesystem errors.
- **Complete Host REST API**:
  - `GET  /branch-workspace/api/health`: Service health probe;
  - `GET  /branch-workspace/api/archives`: Tree-structured archived session catalog;
  - `POST /branch-workspace/api/purge`: Single root family physical cascade purge;
  - `POST /branch-workspace/api/purge-batch`: Batch root family physical cascade purge;
  - `POST /branch-workspace/api/restore`: Single session activation;
  - `POST /branch-workspace/api/restore-batch`: Batch session unarchival;
  - `POST /branch-workspace/api/restore-branch`: Full branch topological restoration.

### 5. Engine Reliability & Security
- **Heap-Allocated Explicit Stack Algorithms**: `buildSessionTree`, `flattenSessionTree`, `findSessionAncestors`, `aggregateDescendantStatus`, `sortTreeByUpdatedAt` all execute via heap-allocated stacks, proven safe against **20,000-level recursion depth**.
- **In-Place Shadowing & ErrorBoundary**: In-place replacement of `sidebar.workspaces` wrapped in a React `ErrorBoundary`. Crashes fall back to official vanilla renderers without white-screening the app.
- **Native V4 Zstandard Compatibility**: Automatically prioritizes and parses `session.v4.jsonl.zstd`, tolerating torn-tail frames.
- **Security & Network Isolation**: Loopback authority verification (`isLoopbackHost`), DNS rebinding defense, and browser `Sec-Fetch` CSRF prevention.

---

## 🏗 Technical Architecture

For detailed topological maps, complexity bounds, sequence diagrams, and formal invariants, see:
👉 [Architecture & Core Mechanisms Whitepaper (docs/ARCHITECTURE.md)](docs/ARCHITECTURE.md)

---

## 📦 Installation & Integration

### Method 1: DSH Plugin CLI (Recommended)

```bash
# Install directly from GitHub
dsh plugin --profile web add github:JIaDE-YX/dsh-branch-workspace-folders

# Or pin a specific released tag
dsh plugin --profile web add github:JIaDE-YX/dsh-branch-workspace-folders#v0.2.0

# Or via npm registry (once published)
dsh plugin --profile web add dsh-branch-workspace-folders
```

### Method 2: Pre-built Offline Tarball (No Compile Rights Required)

Download `dsh-branch-workspace-folders-0.2.0.tgz` from the [GitHub Releases](https://github.com/JIaDE-YX/dsh-branch-workspace-folders/releases) page:

```bash
# Install pre-built asset without compile authorization
dsh plugin --profile web add ./dsh-branch-workspace-folders-0.2.0.tgz
```

### Method 3: Local Profile Installation via Super-Injector

If your environment has `dsh-super-injector` installed:

```bash
# Formal installation into web profile (mounts without restart):
dev_install_package {"dir": "/path/to/dsh-branch-workspace-folders"}
```

### Method 4: Runtime Hot Injection (Development Mode)

```bash
# 1. Hot inject into runtime memory (zero config pollution):
dev_inject_plugin {"dir": "/path/to/dsh-branch-workspace-folders"}

# 2. Deterministic hot reload after code edits:
dev_reload_package {"packageName": "dsh-branch-workspace-folders"}
```

### Method 5: Manual Profile Configuration

In your profile's `package.json` (`~/.dsh/profiles/web/package.json`):

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

Run `pnpm install` inside the profile directory and restart DSH.

---

## 🛠 Development & Verification Workflow

This project enforces the **Grounded Verification Gate**. All changes must pass the following sequence:

```bash
# 1. Dual-stack TypeScript typecheck (Host + Client)
npm run typecheck

# 2. Compile Host types and bundle Client bundle via tsdown with inline CSS
npm run build

# 3. Execute automated test suite (must pass 45/45 tests including 20k-depth stress tests)
npm test

# 4. Trigger hot-reload in live DSH environment
dev_reload_package {"packageName": "dsh-branch-workspace-folders"}
```

---

## 🛡 Invariants & Guardrails

When contributing to this repository, the following core invariants must never be violated:

1. **`WorkspacePickFlow` Must Never Be Conditionally Rendered**:
   In [`WorkspaceBrowser.tsx`](src/vendor/official-ui-workspace/rows/WorkspaceBrowser.tsx), `<WorkspacePickFlow>` must reside permanently in the DOM tree, governed solely by `open={wsPickerOpen}`. Unmounting on `wsPickerOpen === false` breaks picker callbacks and disables workspace creation.
2. **Dual-Track Collapse State Synchronization**:
   Store initial state might be an empty object `{}` (truthy in JS, short-circuiting nullish coalescing). Branch collapse state must be merged between local storage (`dsh.branch.collapsed.v1`) and local state via `useMemo`.
3. **Slot-Rendered Row Actions**:
   Never hardcode action menus in [`Rows.tsx`](src/vendor/official-ui-workspace/rows/Rows.tsx). Always use `renderSlot('sidebar.workspaces.session.menu.item')` and `renderSlot('sidebar.workspaces.session.row.action')` to preserve third-party extensibility and official pin actions.
4. **Subagent Session Isolation**:
   Always filter `origin === 'subagent'` transient child sessions from the sidebar tree to prevent clutter.

---

## 📄 License & Contributing

- Distributed under the [MIT License](LICENSE).
- Contribution guidelines and pull request instructions are detailed in [CONTRIBUTING.md](CONTRIBUTING.md).
- Version history is documented in [CHANGELOG.md](CHANGELOG.md).