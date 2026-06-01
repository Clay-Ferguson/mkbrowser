# Refactor Step 2 of 6 — Adopt (or retire) `useToggleExpanded`

> One of six independent refactoring steps for the "entry" components. Do them in numbered
> order. This is a small, low-risk cleanup that removes a dead export.

## Project context you need

Electron + React + TypeScript file/folder browser. File/folder rows are rendered by entry
components in `src/components/entries/`: `GenericEntry.tsx`, `FolderEntry.tsx`, `ImageEntry.tsx`,
`TextEntry.tsx`, `MarkdownEntry.tsx`. Shared code is in `src/components/entries/common/`,
re-exported from `common/index.ts`. The store (`src/store`) exposes `toggleItemExpanded(path)`.

## The problem

`src/components/entries/common/EntryActionBar.tsx` exports a helper at the bottom:

```ts
export function useToggleExpanded(path: string) {
  return () => toggleItemExpanded(path);
}
```

It is re-exported from `common/index.ts:19` but **never imported anywhere** — it is dead.
Meanwhile four components hand-roll the exact same thing:

- `GenericEntry.tsx:44`, `ImageEntry.tsx:194`, `MarkdownEntry.tsx:124`, `TextEntry.tsx:105`

each define:

```ts
const handleToggleExpanded = () => {
  toggleItemExpanded(entry.path);
};
```

(`FolderEntry` does **not** toggle expansion — its row navigates instead — so it is out of scope.)

## The change

In each of the four components above:

1. Replace the inline `handleToggleExpanded` definition with:
   `const handleToggleExpanded = useToggleExpanded(entry.path);`
2. Add `useToggleExpanded` to the existing import from `./common`.
3. Remove `toggleItemExpanded` from the `from '../../store'` import **only if** it is no longer
   referenced elsewhere in that file (grep the file first — some files may still use it for
   other handlers; if so, leave it).

The call sites (`onClick={handleToggleExpanded}` on the name span) stay unchanged.

## Constraints

- Behaviorally identical — this is a pure dedupe.
- Per-file, verify whether `toggleItemExpanded` is still needed before removing its import.
- Do not change `FolderEntry`.

## Note on later steps

Step 4 introduces a shared `<EntryShell>` that may absorb the expand-toggle entirely. Adopting
`useToggleExpanded` now is still the right move: it retires the dead export and keeps the four
files consistent in the meantime.

## Verification

- `grep -rn "useToggleExpanded" src/` shows it now imported/used in the four components (not just
  defined + barrel-exported).
- No remaining inline `const handleToggleExpanded = () => { toggleItemExpanded(` in those files.
- Typecheck/lint passes; clicking a file/image entry's name still toggles expand/collapse.
