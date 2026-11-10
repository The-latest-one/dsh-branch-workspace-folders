# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-11-10

### Added
- **Official DSH v0.2.2-rc.1 Full Alignment**:
  - **4-Token Layout System & Paint Inset**: Integrated `--dsh-sidebar-inline-padding: 8px`, `--dsh-sidebar-row-padding: 12px`, `--dsh-sidebar-label-gap: 6px`, and `--dsh-sidebar-paint-inset: 3px`. Rows now use `border-inline: 3px solid transparent; background-clip: padding-box;` for recessed hover/selection highlight boundaries without content displacement.
  - **Unified Two-Track Indentation**: Evolved indentation formula to `calc(var(--dsh-sidebar-row-padding, 12px) - var(--dsh-sidebar-paint-inset, 3px) + var(--dsh-workspace-indent, 0px) + var(--dsh-branch-indent, 0px))` while preserving full tree-rail alignment (`.deepBranch`).
  - **24px Touch Target Operation Buttons**: Enlarged all `.iconButton` hit targets to 24px with `-4px` margin compensation and `13px` action gaps, fully compliant with mobile/touch ergonomics without expanding 32px session row height.
  - **Trailing Decoration Slot (`sidebar.session.row.trailing`)**: Declared and rendered inline trailing slot in `.rowResting` container between timestamp and pin marker.
  - **Native Context Menu & Right-Click Integration**: Integrated `@deepseek-ai/dsh-client-ui-context-menu` (`openSessionMenu`, `openWorkspaceMenu`, `useContextMenu`, `useContextMenuTarget`), allowing users to right-click sessions or workspaces, while keeping legacy inline menu fallback.
  - **Remote Access Control**: Gated row and workspace actions with `useRemoteAccess`, `useWorkspaceAccess`, and `useSessionAccess` snapshots.
  - **High-Fidelity Offscreen Drag Preview**: Integrated `useRowDragPreview` generating theme-styled drag mirrors matching exact branch depth and typography.
  - **Workspace Dialog Decoupling**: Extracted `WorkspaceDialogs` driven by `useWorkspaceActionRequest` for rename and removal modals.
  - **Session Hover Working Directory (CWD)**: `SessionNode` now captures `cwd`, rendered in `SessionHoverContent` with `~` abbreviation.
  - **Same-Title Workspace Path Disambiguation**: Implemented `distinguishingPathSuffixes` in `WorkspacePicker.tsx` to display shortest distinctive parent suffixes for duplicate directory names.
  - **Session ID Substring Search**: `deriveSearchResults` now matches session identifiers directly in local queries.
  - **Keyboard Accessibility & Window Blur Guard**: Added `tabIndex={0}`, Enter/Space row activation, `focus-within` action surfacing, and `renameArmed` window blur protection.
  - **Mobile Coarse Pointer & Touch Support**: Added `@media (pointer: coarse) { font-size: 16px; }` to prevent mobile browser viewport zoom, and `@media (hover: none)` touch rules.
  - **Comprehensive Test Suite**: Added `tests/v022_features.test.mjs` and `tests/v021_stress.test.mjs` (65/65 tests passing).

- **Official DSH v0.2.1-rc.3 Feature Alignment**:
  - Full alignment with dynamic conversation-driven titles (`@deepseek-ai/dsh-experimental-session-titles-bundle` / `dsh-session-title-all-prompts-llm`).
  - Added localized fallback for unnamed sessions (`t('session.untitled')`) in `displayTitle` and `SearchResultItem`.
  - Implemented official watermark system (`SESSION_WATERMARK_BASE = 5`, `SESSION_WATERMARK_AUTO_MAX = 50`) with auto-raising for attention-bearing sessions, step-by-step expansion, collapse to baseline, and workspace folding reset.
  - Integrated official `AnimatedRows` FLIP transitions across `SessionTree` and `FlatList` with `resetKey` synchronization.
  - Implemented official `EmptySessions` component with dual-state glyphs (`IconQueueOutlineRegular` / `IconArchiveOutlineRegular`), dedicated empty archived copy, and quick exit action (`empty.viewOthers`).
  - Integrated global shortcuts (`useWorkspaceShortcuts`) for search (`Mod+K`) and workspace directory picker trigger.
  - Localized default workspace title via `workspaceDisplayTitle`.
  - Added test suite `tests/v021_features.test.mjs` (54/54 tests passing).

### Fixed
- Fixed session title extraction in `tree.ts` (`sessionTitle` now correctly reads dynamic `session.title` instead of static `session.displayTitle`).
- Removed duplicate hardcoded schedule clock indicator in `Rows.tsx`, fully delegating to `sidebar.session.row.leading` slot.
- Fixed `install-readonly.sh` profile path resolution when `DSH_PROFILE` is set to relative profile name.

## [0.2.1] - 2026-10-03

### Fixed
- **Transparent Ancestor Stitching for Multi-Tier Fork Trees**:
  - Implemented `resolveSurvivingParent` with cycle-safe and dirty-type defense: when intermediate parent sessions are archived (hidden in `default` filter), active child branches transparently stitch to the nearest surviving visible ancestor rather than incorrectly breaking out into top-level orphan roots.
  - Upgraded `buildSessionTree` and `collectBranchIds` to accept `lookupParent` option across complete catalog with `bypassedParents` tagging.
  - Fixed `reconcileManualOrder` `placeFork` clustering bug under production member lists containing archived sessions by introducing `activeResultSet` anchor verification, clustering active branches directly above surviving ancestors instead of dropping to the archive zone boundary.
  - Wired full workspace viewing pipelines in `FlatList`, `GroupedView` (workspace & workspace-tree modes), and `revealTargetSession`.
  - Added full test suite and 20,000-depth stress testing in `tests/ancestor_stitching.test.mjs` (51/51 tests PASS).

## [0.2.0] - 2026-09-30

### Added
- **Official DSH v0.2.0-rc.2 Slot Ecosystem Compatibility**:
  - Implemented leading 16px cell slot arbitration (`sidebar.session.row.leading`) in `Rows.tsx` for automation indicators (e.g. `dsh-schedule` task clock icon) when idle and unarchived.
  - Implemented hover section injection slot (`sidebar.session.row.hover`) in `SessionHoverContent` for external task inspection.
  - Injected `@deepseek-ai/dsh-client-shortcuts` and added shortcut awareness to workspace and session creation tooltips.
- **Official Constant-Speed Title Marquee (`useTitleMarquee`)**:
  - Replicated official 0.03px/ms constant-speed marquee crawling with 12px double-edge linear gradient fade masks (`[data-scrolled]` and `[data-clipped]`).
  - Added dynamic ellipsis suppression (`text-overflow: clip`) on hover to eliminate character-overlap glitching.
  - Full support for `prefers-reduced-motion: reduce` (instant jump instead of animation).
- **AnimatedRows Layout Contract**:
  - Injected semantic `data-row-key` attributes across sessions (`session:${id}`) and workspaces (`workspace:${key}`) for FLIP layout transition support.
- **Native V4 Zstandard Session Format Compatibility**:
  - Validated `pickLatestSessionFile` priority resolution for `session.v4.jsonl.zstd` (version 4 > 3).
  - Added full test coverage for V4 header parsing and torn tail recovery.
- **Stress & Security Test Suite**:
  - Added `tests/stress_and_security.test.mjs` testing 20,000-level recursion depth, 10,000-node wide trees, 50,000 marquee transitions, and 24 attack vectors for path traversal / DNS rebinding / CSRF. Total test count expanded to 44/44 PASS.

### Changed
- Standardized package manifest with `prepare` script for direct GitHub installation.
- Refactored documentation with bilingual English and Chinese READMEs (`README.md` & `README.zh.md`).

---

## [0.1.15] - 2026-09-12

### Added
- **Heap-Allocated Explicit Stack Non-Recursive Algorithms**:
  - Fully refactored `buildSessionTree`, `flattenSessionTree`, `findSessionAncestors`, `aggregateDescendantStatus`, and `sortTreeByUpdatedAt` to explicit stack iterations, completely eliminating `Maximum call stack size exceeded` errors.
- **placeFork Native Clustering**:
  - Forked sessions automatically cluster immediately above their parent sessions rather than appending at list boundaries.
- **Two-Track Indentation Decoupling**:
  - Separated `--dsh-workspace-indent` and `--dsh-branch-indent` to resolve negative indentation bugs in `workspace-tree` mode.
- **Collapsed Status Bubbling**:
  - Bubbles warning, running, and completed statuses to folded ancestor nodes with strict priority state machine arbitration.
- **Physical Cascade Purge Transaction Engine**:
  - Added Host REST APIs for physical cascading session deletion with `.trash-sessions` isolation and reverse-order rollback.
  - Added archived session governance view in settings (`branch-workspace-archives`).

---

## [0.1.0] - 2026-08-20

### Added
- Initial release providing basic branch session grouping under root sessions in the DSH sidebar.
- In-place shadowing of official `sidebar.workspaces` slot.
- Basic zstd decompression and fork lineage tracking.
