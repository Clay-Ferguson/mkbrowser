# Refactor Step 3 of 6 — Align `FolderEntry` props to `BaseEntryProps`

> One of six independent refactoring steps for the "entry" components. Do them in numbered
> order. This single-sources the shared prop contract before the larger structural refactors
> (steps 4–6) build on it.

## Project context you need

Electron + React + TypeScript file/folder browser. Entry components in
`src/components/entries/`: `GenericEntry.tsx`, `FolderEntry.tsx`, `ImageEntry.tsx`,
`TextEntry.tsx`, `MarkdownEntry.tsx`. Shared types/hooks/components are in
`src/components/entries/common/` (barrel: `common/index.ts`).

The shared base prop type is in `src/components/entries/common/types.ts`:

```ts
export interface BaseEntryProps {
  entry: FileEntry;
  onRename: () => void;
  onDelete: () => void;
  onSaveSettings: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveToTop?: () => void;
  onMoveToBottom?: () => void;
  isAttachment?: boolean;
  documentMode?: boolean;
}
```

`TextEntry`, `GenericEntry`, `ImageEntry`, and `MarkdownEntry` already type their props via
`BaseEntryProps` (directly or `extends BaseEntryProps`).

## The problem

`FolderEntry.tsx` declares its props inline (around line 25) and **does not** reference
`BaseEntryProps`, even though it shares most of the same contract:

```ts
interface FolderEntryProps {
  entry: FileEntry;
  onNavigate: (path: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onSaveSettings: () => void;
  onPasteIntoFolder?: (folderPath: string) => void;
  onRefreshDirectory?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveToTop?: () => void;
  onMoveToBottom?: () => void;
  isAttachFolder?: boolean;
  indentFolder?: boolean;
}
```

This duplicates `entry`, `onRename`, `onDelete`, `onSaveSettings`, and the four `onMove*`
fields verbatim, so the contract can drift.

## The change

Make `FolderEntryProps extends BaseEntryProps` and keep only the folder-specific additions:

```ts
import type { BaseEntryProps } from './common'; // adjust to existing import grouping

interface FolderEntryProps extends BaseEntryProps {
  onNavigate: (path: string) => void;
  onPasteIntoFolder?: (folderPath: string) => void;
  onRefreshDirectory?: () => void;
  isAttachFolder?: boolean;
  indentFolder?: boolean;
}
```

`BaseEntryProps` contributes `entry`, `onRename`, `onDelete`, `onSaveSettings`, the four
`onMove*` props, and the optional `isAttachment`/`documentMode`. `FolderEntry` simply won't use
the last two — that's fine; they're optional.

Confirm `BaseEntryProps` is exported from the `./common` barrel (it is, via
`common/index.ts`). Use the existing import style in the file (it currently imports several
things from `./common`).

## Constraints

- Pure type-level change — no runtime/JSX behavior change.
- Do not remove `onNavigate`, `onPasteIntoFolder`, `onRefreshDirectory`, `isAttachFolder`,
  `indentFolder` — those are genuinely folder-specific.
- Verify the call site that renders `<FolderEntry .../>` still typechecks (the caller already
  passes these props; making the type a superset of `BaseEntryProps` should not break it).

## Verification

- Typecheck passes (`npm run build` or configured typecheck).
- The folder browse view still renders folders, navigates on click, renames via right-click,
  deletes, moves up/down, and shows paste-into-folder when items are cut.
