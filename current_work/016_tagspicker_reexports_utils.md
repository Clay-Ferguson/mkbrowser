# 016 — `TagsPicker` re-exports util functions, creating a component-as-barrel coupling

## Role / Goal
You are working in `mkbrowser`. Remove the pass-through re-export so consumers depend on the utility module directly, not on a UI component.

## Affected file
- `src/components/TagsPicker.tsx`

## Background
```tsx
import {
  fetchTags, type TagsLoadState, ...
  removeTagFromText, insertTagIntoText,
} from '../utils/tagUtil';

export { removeTagFromText, insertTagIntoText };
```

`TagsPicker` imports two pure functions from `utils/tagUtil` and immediately re-exports them. This makes the component module a partial "barrel" for tag utilities.

## Why this is a smell
- It couples non-UI consumers to a React component module: anything importing `removeTagFromText` from `TagsPicker` will pull in the whole component (and its React/store/icon imports) into its dependency graph, hurting tree-shaking and creating odd import cycles.
- It creates two public import paths for the same function (`utils/tagUtil` and `components/TagsPicker`), which is confusing and invites drift.
- Pure logic should be imported from the logic module; components should export components.

## Proposed solution
1. Find who imports `removeTagFromText` / `insertTagIntoText` from `TagsPicker`:
   ```
   grep -rn "from .*components/TagsPicker" src
   ```
2. Repoint those imports to `../utils/tagUtil` (the real source).
3. Delete the `export { removeTagFromText, insertTagIntoText };` line from `TagsPicker.tsx`.

If the re-export exists only to satisfy a test or a single legacy import, updating that import is trivial and removes the coupling entirely.

## Acceptance criteria
- `TagsPicker.tsx` exports only the component (default export).
- All consumers of `removeTagFromText` / `insertTagIntoText` import them from `utils/tagUtil`.
- Build, types, and tests pass.
