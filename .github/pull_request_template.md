## Summary

Describe the key changes and motivations of this PR.

## Verification Checklist

- [ ] `npm run typecheck` passes with zero errors (Host + Client)
- [ ] `npm run build` completes cleanly
- [ ] `npm test` passes 100% (44/44 tests including stress & security)
- [ ] Core invariants respected (no direct recursion, `WorkspacePickFlow` in DOM, slot preserved)
