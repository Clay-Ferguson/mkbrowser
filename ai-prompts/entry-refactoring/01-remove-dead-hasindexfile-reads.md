# Refactor Step 1 of 6 — Remove dead `hasIndexFile` reads

> This is one of six independent refactoring steps for the "entry" components.
> Do them in numbered order. This step is a trivial, zero-risk cleanup intended to
> go first so later, larger refactors start from a clean baseline.

## Project context you need

This is an Electron + React + TypeScript file/folder browser. Files and folders are
rendered by a family of "entry" components in `src/components/entries/`:

- `GenericEntry.tsx`, `FolderEntry.tsx`, `ImageEntry.tsx`, `TextEntry.tsx`, `MarkdownEntry.tsx`

Shared logic lives in `src/components/entries/common/` (hooks + small components, re-exported
from `common/index.ts`). State comes from a Zustand-style store in `src/store` exposing
selector hooks like `useItem`, `useHasIndexFile`, etc.

## The problem

`useHasIndexFile()` is called and assigned to a `hasIndexFile` const in two components where
the value is **never used** — a dead store subscription that causes needless re-renders and
misleads readers:

- `src/components/entries/GenericEntry.tsx:29` — `const hasIndexFile = useHasIndexFile();`
- `src/components/entries/ImageEntry.tsx:38` — `const hasIndexFile = useHasIndexFile();`

Note: `hasIndexFile` **is** legitimately used in `FolderEntry.tsx`, `TextEntry.tsx`, and
`MarkdownEntry.tsx` — **do not touch those.**

## The change

In `GenericEntry.tsx` and `ImageEntry.tsx` only:

1. Delete the `const hasIndexFile = useHasIndexFile();` line.
2. Remove `useHasIndexFile` from the `from '../../store'` import in that file **only if it is
   no longer referenced anywhere else in the file** (in both these files it is the sole use,
   so it should be removed from the import list — but verify by searching the file first).

## Constraints

- Change only these two files.
- Confirm `hasIndexFile` / `useHasIndexFile` has no other reference in each file before
  removing the import (grep within the file).

## Verification

- `grep -n "hasIndexFile" src/components/entries/GenericEntry.tsx src/components/entries/ImageEntry.tsx`
  returns nothing.
- TypeScript build / lint passes (no "unused import" or "undefined" errors). Run the project's
  typecheck/lint (e.g. `npm run build` or the configured lint script).
- Smoke test: a generic (non-previewable) file entry and an image entry still render, expand,
  rename, and delete correctly.
