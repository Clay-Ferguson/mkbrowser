# File Attachments — Technical Notes

## Overview

The file attachments feature lets any file in MkBrowser have an associated set of files (images, PDFs, spreadsheets, etc.) by storing them in a sibling folder whose name is `<filename>.attach`. For example, `notes.md` may have an attachment folder named `notes.md.attach`. The full folder name, including the `.md` extension, becomes part of the attachment folder name; the `.attach` suffix is always appended to the complete filename.

This convention was chosen because it requires no database, no sidecar metadata file, and works naturally with any external tool (file manager, git, rsync) while remaining unambiguous in a directory listing.

---

## Naming Convention

| File | Attachment folder |
|------|------------------|
| `notes.md` | `notes.md.attach` |
| `report.txt` | `report.txt.attach` |
| `chapter-1.md` | `chapter-1.md.attach` |

The suffix string `.attach` is defined as the constant `ATTACH_SUFFIX = '.attach'` in `src/shared/specialFiles.ts` (that module has no imports, so both the main process and the renderer can use it) and is checked via `entry.name.endsWith(ATTACH_SUFFIX)` throughout the rendering code. Any directory whose name ends with `.attach` is treated as an attachment folder; there is no further validation.

---

## Data Model

### `FileEntry` interface (`src/shared/shared.ts`)

Two optional fields were added to the existing `FileEntry` interface to support attachments:

```ts
/** Contents of an associated .attach folder, pre-loaded by readDirectory */
attachments?: FileEntry[];

/** True when a sibling .attach folder exists for this file */
hasAttachFolder?: boolean;
```

`attachments` is populated on the `FileEntry` that represents the `.attach` **folder itself** (not on the parent Markdown file). This keeps the data model consistent: every `FileEntry` for a folder may optionally carry a pre-loaded snapshot of its children.

`hasAttachFolder` is set on the **owning file's** entry (any file type) so that the renderer can quickly decide whether to show the paperclip paste button without any extra I/O.

---

## Backend: File-System Scanning (`src/main/fileUtil.ts`)

The `readDirectory` function builds the `FileEntry[]` array used by the entire application. Two passes handle attachments:

**Pass 1 — pre-load attach folder contents**

When iterating directory entries, any folder whose name ends with `.attach` has its children eagerly loaded:

```ts
if (isDirectory && entry.name.endsWith('.attach')) {
  fileEntry.attachments = await readDirectory(fullPath, aiEnabled);
}
```

This means the renderer never needs to make a second IPC call to read attachment contents; the data arrives fully assembled in the initial directory load.

**Pass 2 — mark files that already have an attach folder**

After building the full `fileEntries` array, a second scan marks files that have a sibling `.attach` folder:

```ts
const attachNames = new Set(
  fileEntries.filter(e => e.isDirectory && e.name.endsWith('.attach')).map(e => e.name)
);
for (const entry of fileEntries) {
  if (!entry.isDirectory && attachNames.has(`${entry.name}.attach`)) {
    entry.hasAttachFolder = true;
  }
}
```

This is O(n) and requires no filesystem access beyond what was already done.

---

## Frontend: Rendering (`src/components/views/BrowseView.tsx`)

BrowseView has two rendering paths: Document Mode (`.INDEX.yaml`-ordered) and normal mode. Both follow the same pattern for attachments.

**Attach folder rendering** — when the current entry is an attach folder (`entry.name.endsWith(ATTACH_SUFFIX)`):

- The `FolderEntry` receives `isAttachFolder={true}`, which triggers:
  - The folder **name text** fades in/out on hover (same animation as `EntryActionBar`) in Document Mode, keeping the view clean.
  - **Move Up / Move Down** buttons are always hidden.
  - In Document Mode with edit mode off, the entire `FolderEntry` row is suppressed — only its contents are shown.
- The folder row is wrapped in a `paddingLeft: '32px'` container to visually indent it below its parent file.
- Immediately after the `FolderEntry`, the `entry.attachments` array is rendered as a nested list using the same `AttachmentList` sub-component (also inside `BrowseView`), which itself calls the same entry rendering logic recursively, passing `level + 1` for deeper nesting if attach folders are themselves nested.

**Insert bars (Document Mode)** — the `IndexInsertBar` that appears between entries to let users insert new files or folders is suppressed immediately before any attach folder:

```ts
{editMode && !expandedEditor && !visibleEntries[idx + 1]?.name.endsWith(ATTACH_SUFFIX) && (
  <IndexInsertBar ... />
)}
```

This prevents the user from inserting items between a file and its attachment folder.

**Shared renderer** — `AttachFolderContents` lives in its own file, `src/components/views/AttachFolderContents.tsx`, because both right-hand panes render attachments with it (see the next section).

---

## Single-File Mode (`src/components/views/BrowseFile.tsx`)

Clicking a file in the index tree replaces the folder listing with `BrowseFile`, which shows just that one file (see `single_file_browsing.md`). Without special handling the file's attachments would be invisible there, since the `.attach` folder is a separate listing entry rather than part of the file's own entry.

So when the browsed entry has `hasAttachFolder`, `BrowseFile` finds the sibling `<name>.attach` entry in the already-loaded listing and renders it below the file exactly as `BrowseView` does: a `FolderEntry` with `isAttachFolder` and `indentFolder` (the italic `*.attach` row), followed by `AttachFolderContents` at `level={1}`. No extra IPC is needed, because `readDirectory` has already pre-loaded the folder's `attachments`.

- **Hidden while editing**, since the maximized editor owns the whole pane then. Also hidden while the attach folder itself is cut, matching `BrowseView`'s filtering of cut rows.
- **Text/PDF files** fill the pane even in view mode. For those, the attachments block is capped at 40% of the height and scrolls on its own, so the entry keeps most of the pane.
- **Handlers**: rename/delete use `BrowseFile`'s reconcile-then-refresh handler. Clicking the folder row navigates into it (`setCurrentPath`, which also leaves single-file mode). Paste goes through `pasteIntoFolder`.
- The file entry itself still gets none of the attach-creation callbacks (`onPasteAsAttachment`, etc.); those remain listing-only.

---

## Paperclip Button (`src/components/entries/MarkdownEntry.tsx`)

The `PaperClipIcon` button appears on a `MarkdownEntry` row only when:

1. There are currently cut items waiting to be pasted (`hasCutItems` is true in the global store).
2. The `onPasteAsAttachment` callback prop is provided.
3. `entry.hasAttachFolder` is `false` (or absent) — once an attach folder exists the user can use the normal Paste button on the `FolderEntry` directly.

```tsx
{hasCutItems && onPasteAsAttachment && !entry.hasAttachFolder && (
  <button onClick={() => onPasteAsAttachment(entry)} title="Paste cut items as attachments to this file">
    <PaperClipIcon className="w-4 h-4 text-white" />
  </button>
)}
```

The `onPasteAsAttachment` handler lives in `BrowseView.tsx` (`doPasteAsAttachment`). It calls `ensureAttachFolder(filePath)` (below) and then the shared `pasteIntoFolder(attachFolderPath, items, ...)` utility to move the cut items.

---

## Entry Menu: the Three "Attach:" Items (`src/components/menus/EntryPopupMenu.tsx`)

The hamburger menu on **any file entry's** row — Markdown, image, text, PDF or generic — ends with three attach items, separated from the other items by a divider. All three create the attach folder on demand via `ensureAttachFolder`:

- **Attach: Clipboard** — `doPasteClipboardAsAttachment` in `BrowseView.tsx` calls `pasteFromClipboardOp(attachFolderPath, …)`, which writes the clipboard image/text as a timestamp-named file.
- **Attach: Existing File** — `doAttachFromFile` in `BrowseView.tsx` shows the OS file picker (`api.selectFile` → IPC `select-file`) **before** anything touches the disk, so cancelling leaves no empty attach folder behind. The chosen file is then **moved** (not copied) into the attach folder through the same path as a drag-and-drop attach: `canDropAsAttachment` validates it and `dropAsAttachment` (`src/renderer/dragAndDrop.ts`) creates the folder and performs the move with `completeEntryDrop`. That shares the drop's name-collision refusal, index reconciliation, store pruning, and view refresh, so a file picked from the folder being browsed disappears from its old spot. On success the moved file is scrolled to and expanded. Because the move is a rename, it fails for a file on a different filesystem than the attach folder.
- **Attach: New Markdown** — `doCreateAttachment` in `BrowseView.tsx` calls `createAttachmentFileOp` (`src/renderer/fileOpsUtil.ts`), which makes the attach folder, writes an **empty** `.md` file into it named by `generateTimestampFileName()` (the same convention as a new file inserted into a document, so no naming dialog is needed), and then queues `setPendingScrollToFile` + `setPendingEditFile` for it. The user lands directly in the editor for a brand-new attachment and can rename it later. This is the only attach item that creates content rather than moving something that already exists.

All three end by reconciling the attach folder's index and refreshing the view.

### One set of handlers, every file type

Nothing about attachments is Markdown-specific — `<file>.attach` is keyed off the whole filename — so the three callbacks are declared once as **`AttachMenuProps`** (`src/components/entries/common/types.ts`) and mixed into every file entry's prop type (`MarkdownEntry`, `ImageEntry`, `TextEntry`, `PDFEntry`, `GenericEntry`). `FolderEntry` deliberately does not take them: a folder is already an attachment destination through its own Paste button.

Each callback takes the owning file's path, because the handlers live in `BrowseView` and one set serves the whole listing; `BrowseView` groups them into a single `attachMenuHandlers` object and spreads it into every file entry, so the listing can't drift into offering the items on some row types but not others. Each entry then spreads **`bindAttachMenu(entry.path, props)`** (`common/EntryActionBar.tsx`) into its `EntryActionBar`, which converts the path-taking props into the zero-argument form the menu wants and leaves an omitted handler `undefined` (which hides that item). It's a plain module-level function, not a hook, so the React Compiler leaves it alone.

The **paperclip** button is the one attach affordance that is still Markdown-only (see above) — it is a `MarkdownEntry`-local button rather than a menu item.

### The pending-edit request has to survive an attachment path

`setPendingEditFile` is consumed by the settle effect in `BrowseView`, which waits for the new file to appear in the item store and otherwise **drops** the request once its folder can no longer show up in this listing. That test is `affectsBrowseListing(getParentPath(editFile), currentPath)` — not folder equality — precisely because of this feature: a new attachment's parent is the `.attach` folder, one level *below* `currentPath`, yet it is rendered as a row here. With a plain `isSamePath` check, a refresh that took longer than the 100ms settle timer would silently drop the edit and leave the user staring at an unopened empty file.

---

## Creating the Folder: `ensureAttachFolder` (`src/renderer/fileOpsUtil.ts`)

The single place an attach folder comes into existence. Given a file path it:

1. Derives the attach folder path as `${filePath}${ATTACH_SUFFIX}`.
2. Returns it immediately if `api.pathExists` says it is already there.
3. Otherwise calls `api.createFolder`; on failure it reports via `setAppError` and returns `null`.
4. If the file lives in the folder currently being browsed **and** that folder is in Document Mode, calls `api.insertIntoIndexYaml(parentFolder, attachFolderName, fileName)` so the new folder lands immediately after its parent file rather than being appended to the end of the document by the next reconcile. The check is on the file's own parent folder, so a file nested inside another `.attach` folder does not wrongly consult the browsed folder's `hasIndexFile`.

Both the paperclip paste and the drag-and-drop path (below) go through it.

---

## Drag-and-Drop: Dropping onto a File (`src/renderer/dragAndDrop.ts`)

Dragging any entry (by its icon handle, which is the `draggable` element) and dropping it **onto a file row** attaches it to that file — the folder is created on demand, so no prior cut is needed.

The drop target lives in **`EntryShell.tsx`**, the shared skeleton behind every file-type entry, so Markdown, Text, Image, PDF and Generic rows all accept attachment drops from one wiring. It uses the `useDropTarget` hook (`src/components/entries/common/useDropTarget.ts`), which owns the drag-over highlight (`ENTRY_DROP_TARGET`) and reads the `DataTransfer` synchronously — the payload must be parsed before any `await`, since the `DataTransfer` only lives for the duration of the event dispatch.

Two functions do the work:

- **`canDropAsAttachment(payload, filePath)`** — validation. Only the "file dropped onto itself" case is attachment-specific (without it, dragging a file onto its own row would create `<file>.attach` and move the file inside). Everything else is delegated to the existing `canDropInto(payload, filePath + ATTACH_SUFFIX)`, which already rejects a drop onto the payload itself (so `X.md.attach` cannot be dropped back onto `X.md`), a drop into the payload's current parent (so an item already attached to the file is refused), and a folder dropped into its own descendant.
- **`dropAsAttachment(payload, filePath)`** — calls `ensureAttachFolder`, then `completeEntryDrop`.

**`completeEntryDrop(payload, destFolder, onRefreshDirectory?)`** is the routine shared by all four drop targets (browse-view folders, browse-view files, index-tree folders, breadcrumb segments), which therefore differ only in how they compute the destination folder. It performs the move via `moveEntryIntoFolder` → `pasteCutItems` (the same primitive as cut/paste, so the name-collision check and index reconciliation are not duplicated), reports any failure through `setAppError`, prunes the moved path from the item store, reloads both affected folders in the index tree, and refreshes the browse view when it is showing an affected folder.

"Showing an affected folder" is decided by **`affectsBrowseListing(folder, currentPath)`**, and attachments are exactly why it is not a simple `folder === currentPath`. Because `readDirectory` pre-loads `.attach` contents into the listing, attachment files are on screen as rows while living in a subfolder — so a folder below `currentPath` is visible precisely when every path segment between the two is itself an attachment folder (an ordinary subfolder's contents are not rendered). Getting this wrong is a stale-row bug in both directions: dragging an attachment *out* to an index-tree folder leaves the row behind, and a newly created `.attach` folder (which is neither the source nor the destination of the move) never appears.

Note the folder is created before the move is attempted. A name collision is impossible in a folder that was just created, so the only way this leaves an empty `.attach` behind is a genuine filesystem error during the rename.

---

## The Index Tree Never Shows Attach Folders

`IndexTreeView` is a navigation tree, so a `<file>.attach` folder is noise there — it is
filtered out of every set of tree children by **`isTreeVisibleEntry`** (`src/renderer/dragAndDrop.ts`),
the one predicate all tree-building paths share:

- `makeTreeNodes` / `mergeTreeNodes` — the lazy expand, the reveal walk, and `reloadExpandedTreeFolder`
- `refreshExpandedNodes` (`src/App.tsx`) — the full rebuild of every expanded node that
  `refreshDirectory` runs

The second one is easy to miss because it builds its child nodes itself (it carries `indexOrder`
over and re-sorts) rather than calling `makeTreeNodes`. When it skipped the filter, renaming an item
from the tree's context menu made the attach folder of the browsed folder pop into the tree — the
rename handler calls `onRefreshDirectory` for the browsed folder, and that rebuild re-added the row
that every other refresh path drops. It stayed until some other action rebuilt the tree through a
filtered path.

Because the tree hides them, a cut of a file that owns attachments would silently strand the
folder; `IndexTreeView` therefore confirms that case first (`cutOrphanAttachTarget`).

---

## Rename Synchronization (`src/main.ts`)

When the user renames a file via the rename input in `EntryActionBar`, the IPC handler for `renameFile` in `src/main.ts` automatically renames the sibling attach folder if one exists:

```ts
const oldAttachName = `${oldName}.attach`;
const newAttachName = `${newName}.attach`;
try {
  await fs.promises.access(path.join(dirPath, oldAttachName));
  await fs.promises.rename(
    path.join(dirPath, oldAttachName),
    path.join(dirPath, newAttachName)
  );
  await renameInIndexYaml(dirPath, oldAttachName, newAttachName);
} catch {
  // No attach folder — nothing to do
}
```

This is done unconditionally in the main process so that the rename always stays atomic: the file and its attach folder are renamed together in one IPC round-trip. The index YAML entry for the attach folder is also updated via `renameInIndexYaml`.

---

## Document Mode Ordering (`src/main/indexUtil.ts`)

When entries are reordered via Move Up / Move Down in Document Mode, an attach folder can end up in the wrong position in `.INDEX.yaml`. The invariant — every `<file>.attach` entry sits immediately after `<file>` — is restored by `reorderAttachFolders`, which `moveInIndexYaml` and `moveToEdgeInIndexYaml` each fold into their own single write.

**`reorderAttachFolders(files: IndexEntry[]): IndexEntry[]`** (private helper):

1. Partitions the `IndexEntry[]` into a `Map<string, IndexEntry>` of attach entries (`attMap`) and a plain array of non-attach entries (`nonAttach`).
2. Rebuilds the list by emitting each non-attach entry followed by its attach sibling (looked up from `attMap`) if one exists.
3. Appends any orphaned attach entries (attach folders with no matching parent — edge case) at the end.
4. Detects whether any change occurred by comparing names position-by-position; returns the original array reference unchanged if nothing moved, so the caller can skip the file write.

It is deliberately *not* a separate exported pass. An earlier `validateAttachFolderLocation(dirPath)` did the reorder as a follow-up read-modify-write, but since it also took the per-directory index lock, calling it from an already-locked move would deadlock (see `document_mode.md` § Atomic, Serialized Index Updates). Folding the reorder into the move's existing write removes both the deadlock and a gratuitous second disk write.

---

## Global Store Interaction (`src/App.tsx`)

When the global file list is flattened for store-level operations (e.g., building the search index or the cut/paste item list), attachment contents are expanded inline:

```ts
if (file.attachments) {
  const attachItems = file.attachments.map((a) => ({ ... }));
  return [...base, ...attachItems];
}
```

This means attachment files participate in search, bulk selection, and other global operations without any special-casing in those subsystems.

---

## Key Files Summary

| File | Role |
|------|------|
| `src/shared/specialFiles.ts` | The `ATTACH_SUFFIX` constant, shared by the main process and the renderer |
| `src/shared/shared.ts` | `FileEntry.attachments` and `FileEntry.hasAttachFolder` fields |
| `src/main/fileUtil.ts` | Pre-loads attach folder contents and sets `hasAttachFolder` during directory scan |
| `src/components/views/BrowseView.tsx` | Renders attach folders inline; `doPasteAsAttachment` handler |
| `src/components/views/AttachFolderContents.tsx` | Recursive renderer for an attach folder's contents, shared by both panes |
| `src/components/views/BrowseFile.tsx` | Shows the browsed file's attach folder and contents in single-file mode |
| `src/renderer/fileOpsUtil.ts` | `ensureAttachFolder` — the one place an `.attach` folder is created; `createAttachmentFileOp` — creates a new empty Markdown attachment and queues the edit |
| `src/renderer/dragAndDrop.ts` | `canDropAsAttachment`, `dropAsAttachment`, and the shared `completeEntryDrop` |
| `src/components/entries/common/EntryShell.tsx` | Makes every file-type entry a drop target for attachments |
| `src/components/entries/common/useDropTarget.ts` | Drag-over highlight state + drop handlers for a single row |
| `src/components/entries/MarkdownEntry.tsx` | Paperclip button (`PaperClipIcon`) shown when cut items exist and no attach folder yet |
| `src/components/entries/common/types.ts` | `AttachMenuProps` — the three attach callbacks every file entry accepts |
| `src/components/entries/common/EntryActionBar.tsx` | `bindAttachMenu` — binds those callbacks to the entry's path for the popup menu |
| `src/components/entries/FolderEntry.tsx` | `isAttachFolder` prop; hides name text on hover, hides move buttons, hides row in read-only Document Mode |
| `src/main/indexUtil.ts` | `reorderAttachFolders` — keeps `.INDEX.yaml` ordering correct after moves |
| `src/main.ts` | IPC `renameFile` handler automatically renames the sibling `.attach` folder |
| `src/renderer/dragAndDrop.ts` | `isTreeVisibleEntry` — keeps `.attach` folders out of the index tree |
| `src/App.tsx` | `refreshExpandedNodes` — rebuilds expanded tree nodes through that same filter |
