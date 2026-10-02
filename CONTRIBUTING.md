# Contributing to dsh-branch-workspace-folders

Thank you for your interest in contributing to `dsh-branch-workspace-folders`!

This project adheres to the **Grounded Verification Gate** and core architectural invariants to ensure utmost stability in the DeepSeek Harness ecosystem.

---

## 🛠 Local Development Setup

### Prerequisites
- Node.js >= 20.0.0
- npm >= 9.0.0 (or pnpm >= 8.0.0)
- Git

### Getting Started
```bash
# 1. Clone repository
git clone https://github.com/The-latest-one/dsh-branch-workspace-folders.git
cd dsh-branch-workspace-folders

# 2. Install dependencies
npm install

# 3. Run dual-stack TypeScript typechecking
npm run typecheck

# 4. Build Host types and bundle Client via tsdown
npm run build

# 5. Run the complete test suite (must pass 44/44 tests)
npm test
```

---

## 🛡 Architectural Invariants (Non-Negotiable)

When contributing code, you must strictly follow these core invariants:

1. **Stack-Safe Algorithms**:
   - Never introduce direct recursion for tree traversal, path finding, or sorting.
   - All hierarchical operations must use **heap-allocated explicit stack iterations** to tolerate deep fork chains (tested up to 20,000 levels).
2. **Permanent In-DOM Presence for `WorkspacePickFlow`**:
   - In `src/vendor/official-ui-workspace/rows/WorkspaceBrowser.tsx`, `<WorkspacePickFlow>` must **never** be rendered conditionally (`{open && <...>}`). It must remain in the DOM tree governed solely by the `open` prop.
3. **Slot Preservation**:
   - In `src/vendor/official-ui-workspace/rows/Rows.tsx`, always use `renderSlot('sidebar.workspaces.session.menu.item')` and `renderSlot('sidebar.workspaces.session.row.action')`. Never hardcode session actions.
4. **Clean Rollbacks on Host File Operations**:
   - Any Host filesystem mutations (such as session purge or restore) must execute within isolated quarantine directories (`.trash-sessions`) and support complete reverse-order rollbacks upon failure.
5. **Subagent Session Filtering**:
   - Always filter sessions with `origin === 'subagent'` to avoid polluting the user workspace sidebar.

---

## 🧪 Pull Request Guidelines

Before opening a Pull Request:
1. Ensure `npm run typecheck` reports **0 errors** across both Host and Client `tsconfig`s.
2. Ensure `npm run build` succeeds cleanly and inlines all module styles into `lib/client.js`.
3. Ensure `npm test` passes **100%** of all unit, stress, and security tests.
4. Keep commit messages clear, concise, and structured according to Conventional Commits (e.g. `feat:`, `fix:`, `docs:`, `test:`).