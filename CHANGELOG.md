# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
