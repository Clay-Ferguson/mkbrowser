# Refactor Step 5 of 6 — Add a `useEntry` aggregator hook

> One of six independent refactoring steps for the "entry" components. Do them in numbered
> order. This removes the repeated hook-wiring boilerplate. It pairs with Step 4
> (`<EntryShell>`) and is easiest once that step has clarified what each component still needs,
> so do it after step 4.

## Project context you need

Electron + React + TypeScript file/folder browser. Entry components in
`src/components/entries/`: `GenericEntry.tsx`, `FolderEntry.tsx`, `ImageEntry.tsx`,
`TextEntry.tsx`, `MarkdownEntry.tsx`. Shared code in `src/components/entries/common/`
(barrel `common/index.ts`); hook return types in `common/types.ts`.

The existing common hooks:

- `useEntryCore({ path, name, defaultExpanded? }) -> { isRenaming, isExpanded, isSelected, isHighlighted, isBookmarked }`
- `useRename({ path, name, isRenaming, onRename, onSaveSettings, selectFullName? }) -> RenameState`
- `useDelete({ path, onDelete }) -> DeleteState`
- `useContentLoader({ path, modifiedTime, isExpanded, errorMessage? }) -> { loading, content }`
- `useEditMode({ path, content }) -> EditModeState`

`BaseEntryProps` (in `common/types.ts`) provides `entry`, `onRename`, `onDelete`,
`onSaveSettings`, `onMove*`, `isAttachment?`, `documentMode?`.

## The problem — repeated wiring

Every component repeats the same chain with identical argument shapes derived from props:

```ts
const { isRenaming, isExpanded, isSelected, isHighlighted, isBookmarked } =
  useEntryCore({ path: entry.path, name: entry.name, defaultExpanded: <true|false> });

const rename = useRename({ path: entry.path, name: entry.name, isRenaming,
  onRename, onSaveSettings, selectFullName: <folders only> });

const del = useDelete({ path: entry.path, onDelete });
```

See `GenericEntry.tsx:21-42`, `ImageEntry.tsx:30-51`, `TextEntry.tsx:63-85`,
`MarkdownEntry.tsx:79-102`, `FolderEntry.tsx:42-65`. Text/Markdown additionally add
`useContentLoader` + `useEditMode` (`TextEntry.tsx:87-97`, `MarkdownEntry.tsx:104-114`).

The only real differences are `defaultExpanded` (Text/Markdown/Image = true; Generic/Folder =
false) and `selectFullName` (folders = true).

## The change — create `common/useEntry.ts`

Add an aggregator hook that takes the base props plus a small options object and runs the core
trio, returning the grouped results:

```ts
interface UseEntryOptions {
  defaultExpanded?: boolean;
  selectFullName?: boolean;
}

interface UseEntryResult {
  core: EntryCoreState;     // spread of useEntryCore
  rename: RenameState;
  del: DeleteState;
}

export function useEntry(props: BaseEntryProps, options?: UseEntryOptions): UseEntryResult;
```

Internally it derives `path`/`name` from `props.entry`, calls `useEntryCore`, `useRename`
(wiring `props.onRename`/`props.onSaveSettings` and `core.isRenaming`), and `useDelete`
(wiring `props.onDelete`).

Then add a second hook for the editable file types so Text/Markdown also drop their
content/edit wiring:

```ts
interface UseEditableEntryResult extends UseEntryResult {
  content: string;
  loading: boolean;
  edit: EditModeState;
}

export function useEditableEntry(
  props: BaseEntryProps,
  options: UseEntryOptions & { errorMessage?: string }
): UseEditableEntryResult;
```

This composes `useEntry` + `useContentLoader({ modifiedTime: props.entry.modifiedTime, isExpanded: core.isExpanded, errorMessage })` + `useEditMode({ content })`.

Refactor each component to call `useEntry(...)` / `useEditableEntry(...)`:

- `GenericEntry`: `useEntry(props)` (defaultExpanded false)
- `ImageEntry`: `useEntry(props, { defaultExpanded: true })`
- `FolderEntry`: `useEntry(props, { selectFullName: true })` — note Folder doesn't use
  `isExpanded`; that's fine, just ignore it
- `TextEntry`: `useEditableEntry(props, { defaultExpanded: true, errorMessage: 'Error reading file' })`
- `MarkdownEntry`: `useEditableEntry(props, { defaultExpanded: true, errorMessage: '*Error reading file*' })`

Components then read `core.isExpanded`, `rename.*`, `del.*`, `content`, `edit.*`, etc. If
step 4's `<EntryShell>` is in place, pass these grouped results straight into it.

## Constraints

- Behavior identical — pure wiring consolidation. Keep `defaultExpanded` and `selectFullName`
  exactly as each component currently sets them (verify against the current source per the line
  refs above before changing).
- Watch hook ordering / Rules of Hooks: the aggregator must call the underlying hooks
  unconditionally, in stable order.
- `FolderEntry` does not need content/edit — use `useEntry`, not `useEditableEntry`.
- Export both hooks from `common/index.ts`. Keep the individual hooks exported too (the
  aggregators are built on them and tests may use them directly).

## Verification

- Typecheck/lint passes.
- All five entry types behave exactly as before: expand default state correct (Text/Markdown/
  Image expanded, Generic/Folder collapsed), folder rename selects the full name while file
  rename selects the stem, delete/rename/content-load all work.
- Text/Markdown editing still loads content, edits, saves, and cancels correctly.
- Run existing entry tests.
