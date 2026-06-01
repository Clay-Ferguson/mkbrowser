# Refactor Step 4 of 6 — Extract a shared `<EntryShell>` presentational component

> One of six independent refactoring steps for the "entry" components. Do them in numbered
> order. This is the largest, highest-payoff step: it removes the duplicated header-row markup
> that is currently copy-pasted across the file-type entry components. Do steps 1–3 first.

## Project context you need

Electron + React + TypeScript file/folder browser. File/folder rows are rendered by entry
components in `src/components/entries/`:

- `GenericEntry.tsx` (~115 lines) — minimal, non-expandable file row
- `ImageEntry.tsx` (~430 lines) — image preview + fullscreen
- `TextEntry.tsx` (~290 lines) — code/text with CodeMirror edit/view
- `MarkdownEntry.tsx` (~640 lines) — rendered markdown with edit/view + many extras
- `FolderEntry.tsx` — structurally different (navigation row, no expand body); **out of scope**

Shared logic already lives in `src/components/entries/common/` and is re-exported from
`common/index.ts`:

- Hooks: `useEntryCore`, `useRename`, `useDelete`, `useContentLoader`, `useEditMode`,
  `useToggleExpanded`
- Components: `EntryActionBar`, `RenameInput`, `SelectionCheckbox`
- Types: `BaseEntryProps`, and the hook return types in `common/types.ts`

Shared CSS class constants are in `src/utils/styles.ts` (e.g. `ENTRY_OUTER`,
`ENTRY_HIGHLIGHTED`, `ENTRY_HEADER_ROW`, `ENTRY_HEADER_EXPANDED`, `ENTRY_NAME_SPAN`,
`ENTRY_CONTENT_AREA`, `ENTRY_LOADING`). Helpers: `buildEntryHeaderId` (`utils/entryDom`),
`makeEntryDragStartHandler` (`utils/dragAndDrop`), `formatFlyoverInfo` (`utils/fileUtil`).

## The problem — duplicated header-row skeleton

`GenericEntry`, `ImageEntry`, `TextEntry`, and `MarkdownEntry` each repeat essentially the same
outer structure (only the icon, icon color, and a few details differ):

```tsx
<div className={`${ENTRY_OUTER} ${isHighlighted ? ENTRY_HIGHLIGHTED : ''}`}>
  <div className={`${ENTRY_HEADER_ROW} ${isExpanded ? ENTRY_HEADER_EXPANDED : ''}`}
       onContextMenu={(e) => { e.preventDefault(); if (!isRenaming) rename.handleRenameClick(e); }}>
    {!isAttachment && (
      <SelectionCheckbox path={entry.path} name={entry.name} isSelected={isSelected} />
    )}
    <span className="flex-shrink-0 cursor-grab" draggable
          onDragStart={makeEntryDragStartHandler({ path: entry.path, name: entry.name, isDirectory: false })}>
      <SomeIcon className="w-5 h-5 text-<color>" />
    </span>
    {isRenaming ? (
      <RenameInput ref={rename.inputRef} path={entry.path} name={entry.name}
        value={rename.newName} onChange={rename.setNewName} onKeyDown={rename.handleKeyDown}
        onBlur={rename.handleSave} disabled={rename.saving} className="font-medium" />
    ) : (
      <span id={buildEntryHeaderId(entry.path)} onClick={handleToggleExpanded}
            className={ENTRY_NAME_SPAN} title={formatFlyoverInfo(entry)}>
        {entry.name}
      </span>
    )}
    {/* header-right area: either edit toolbar OR <EntryActionBar/> + extras */}
    {edit?.isEditing ? (<editor toolbar/>) : !isRenaming && (<EntryActionBar .../> + extras)}
  </div>
  {isExpanded && (<content area/>)}
  {del.showDeleteConfirm && (<ConfirmDialog message={`Move "${entry.name}" to trash?`} .../>)}
</div>
```

Compare the near-identical blocks at:
- `GenericEntry.tsx:48-110`
- `TextEntry.tsx:130-281` (header portion `130-227`)
- `MarkdownEntry.tsx:304-477` (header portion)
- `ImageEntry.tsx:217-273` (header portion)

This ~30-40 line skeleton is duplicated 4x with only cosmetic differences, plus the trailing
delete `ConfirmDialog` (from `../dialogs/ConfirmDialog`) repeated in every file.

## The change — create `common/EntryShell.tsx`

Create a presentational wrapper that owns the shared skeleton. The variable parts become props
and slots. Proposed API (adjust names to match house style as you see fit):

```tsx
interface EntryShellProps {
  entry: FileEntry;                 // for path/name/drag/flyover
  icon: React.ReactNode;            // the colored icon element
  isAttachment?: boolean;           // hides the checkbox
  isDirectory?: boolean;            // for makeEntryDragStartHandler (default false)

  // state (from the existing hooks the component already calls)
  isHighlighted: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  rename: RenameState;              // from useRename
  del: DeleteState;                 // from useDelete

  onToggleExpanded: () => void;     // useToggleExpanded(entry.path)

  // slots
  nameContent?: React.ReactNode;    // override the default name span (e.g. Markdown's timestamp-hiding logic)
  headerRight: React.ReactNode;     // action bar / edit toolbar / extras — fully owned by caller
  children?: React.ReactNode;       // expanded body, rendered only when isExpanded
  deleteMessage?: string;           // default: `Move "${entry.name}" to trash?`
  className?: string;               // extra classes on the outer wrapper
  contentClassName?: string;        // class for the content area (Image uses a custom one)
  expandedAffectsHeader?: boolean;  // whether to apply ENTRY_HEADER_EXPANDED (Generic does not expand)
}
```

`EntryShell` renders: outer wrapper, header row (with the shared `onContextMenu` rename
trigger), `SelectionCheckbox`, draggable icon span, the rename-input/name-span swap, the
`headerRight` slot, the `isExpanded && children` body, and the delete `ConfirmDialog`.

Then refactor the four file-type components to call it, passing their icon, hook results, and a
`headerRight` slot built from `<EntryActionBar/>` (+ the per-component extras like Markdown's
paste/thread/reply buttons or the editor toolbar). The components keep all their own hooks,
handlers, and expanded-body JSX — only the shared skeleton moves into the shell.

### Important variations to preserve

- **GenericEntry** does not expand and has no content body / no `ENTRY_HEADER_EXPANDED`. Support
  this via `expandedAffectsHeader={false}` and no `children`.
- **ImageEntry** uses a custom name span class (`text-green-400 truncate flex-1 cursor-pointer
  no-underline`) and a custom content wrapper (`px-4 pb-4`), and renders extra dialogs
  (fullscreen overlay, EXIF, end/beginning alerts, its own fullscreen delete confirm) — those
  extra dialogs stay in `ImageEntry` (outside the shell or as additional siblings). Use the
  `nameContent` / `contentClassName` slots.
- **MarkdownEntry** hides the name for timestamp-style filenames when expanded
  (`TIMESTAMP_FILENAME_RE`, see `MarkdownEntry.tsx:341`) — pass that via `nameContent`.
- **TextEntry / MarkdownEntry** swap the header-right between an **edit toolbar** (when
  `edit.isEditing`) and the **action bar** — the caller composes that into the single
  `headerRight` slot, so the shell stays agnostic.
- Keep `data-testid` attributes intact (e.g. MarkdownEntry's outer
  `data-testid="browser-entry-markdown"`, and `entry-action-bar`, `entry-delete-button`, etc.
  that live inside `EntryActionBar`). Allow a `data-testid` passthrough on the wrapper if needed.

## Constraints

- `FolderEntry` is **out of scope** (different wrapper bg, navigation onClick, drag-drop target,
  aiHint). Leave it alone.
- No behavior or visual change — this is a structural extraction. Same classes, same testids,
  same handlers.
- Do not move component-specific state/handlers into the shell; only the shared skeleton.
- Export `EntryShell` from `common/index.ts`.

## Verification

- Typecheck/lint passes.
- Run the app and verify all four entry types render identically to before: highlight,
  expand/collapse, right-click rename (+ Enter/Escape/blur), delete confirm, bookmark, move
  up/down (incl. Ctrl=top/bottom), drag handle, and attachment mode (`isAttachment` hides the
  checkbox).
- Image: fullscreen overlay, EXIF, size toggle, and arrow-key navigation still work.
- Markdown/Text: edit toolbar still appears in place of the action bar while editing.
- Run any existing entry tests: `grep -rl "entry-" src --include=*.test.* ; grep -rl "browser-entry" src --include=*.test.*`
  and execute the test runner.
