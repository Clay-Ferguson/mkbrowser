# File Attachments — Technical Notes

## Overview

The file attachments feature lets a Markdown file in MkBrowser have an associated set of files (images, PDFs, spreadsheets, etc.) by storing them in a sibling folder whose name is `<filename>.attach`. For example, `notes.md` may have an attachment folder named `notes.md.attach`. The full folder name, including the `.md` extension, becomes part of the attachment folder name; the `.attach` suffix is always appended to the complete filename.

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

`hasAttachFolder` is set on the **Markdown file** entry so that the renderer can quickly decide whether to show the paperclip paste button without any extra I/O.

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

After building the full `fileEntries` array, a second scan marks Markdown files that have a sibling `.attach` folder:

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

## Document Mode Ordering (`src/utils/indexUtil.ts`)

When entries are reordered via Move Up / Move Down in Document Mode, an attach folder can end up in the wrong position in `.INDEX.yaml`. `validateAttachFolderLocation(dirPath)` is called after every move operation to restore correct ordering.

**`reorderAttachFolders(files: IndexEntry[]): IndexEntry[]`** (private helper):

1. Partitions the `IndexEntry[]` into a `Map<string, IndexEntry>` of attach entries (`attMap`) and a plain array of non-attach entries (`nonAttach`).
2. Rebuilds the list by emitting each non-attach entry followed by its attach sibling (looked up from `attMap`) if one exists.
3. Appends any orphaned attach entries (attach folders with no matching parent — edge case) at the end.
4. Detects whether any change occurred by comparing names position-by-position; returns the original array reference unchanged if nothing moved, so the caller can skip the file write.

**`validateAttachFolderLocation(dirPath)`** (exported):

Reads `.INDEX.yaml`, calls `reorderAttachFolders`, and writes back only if the returned array is a different reference (i.e., something changed).

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
| `src/renderer/fileOpsUtil.ts` | `ensureAttachFolder` — the one place an `.attach` folder is created |
| `src/renderer/dragAndDrop.ts` | `canDropAsAttachment`, `dropAsAttachment`, and the shared `completeEntryDrop` |
| `src/components/entries/common/EntryShell.tsx` | Makes every file-type entry a drop target for attachments |
| `src/components/entries/common/useDropTarget.ts` | Drag-over highlight state + drop handlers for a single row |
| `src/components/entries/MarkdownEntry.tsx` | Paperclip button (`PaperClipIcon`) shown when cut items exist and no attach folder yet |
| `src/components/entries/FolderEntry.tsx` | `isAttachFolder` prop; hides name text on hover, hides move buttons, hides row in read-only Document Mode |
| `src/main/indexUtil.ts` | `validateAttachFolderLocation` and `reorderAttachFolders` — keeps `.INDEX.yaml` ordering correct after moves |
| `src/main.ts` | IPC `renameFile` handler automatically renames the sibling `.attach` folder |
