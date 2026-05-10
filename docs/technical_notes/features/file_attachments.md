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

The suffix string `.attach` is defined as the module-level constant `ATTACH_SUFFIX = '.attach'` in `src/components/views/BrowseView.tsx` and is checked via `entry.name.endsWith(ATTACH_SUFFIX)` throughout the rendering code. Any directory whose name ends with `.attach` is treated as an attachment folder; there is no further validation.

---

## Data Model

### `FileEntry` interface (`src/global.d.ts`)

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

## Backend: File-System Scanning (`src/utils/fileUtils.ts`)

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

The `onPasteAsAttachment` handler lives in `BrowseView.tsx` (`doPasteAsAttachment`). It:

1. Derives the attach folder path as `${filePath}${ATTACH_SUFFIX}`.
2. Calls `window.electronAPI.pathExists(attachFolderPath)` to check existence.
3. If the folder does not exist, calls `window.electronAPI.createFolder(attachFolderPath)`. In Document Mode it also calls `window.electronAPI.insertIntoIndexYaml(currentPath, attachFolderName, fileName)` to insert the new folder into the index immediately after its parent file.
4. Calls the shared `pasteIntoFolder(attachFolderPath, items, ...)` utility to move the cut items.

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
| `src/global.d.ts` | `FileEntry.attachments` and `FileEntry.hasAttachFolder` fields |
| `src/utils/fileUtils.ts` | Pre-loads attach folder contents and sets `hasAttachFolder` during directory scan |
| `src/components/views/BrowseView.tsx` | Renders attach folders inline; `ATTACH_SUFFIX` constant; `doPasteAsAttachment` handler |
| `src/components/entries/MarkdownEntry.tsx` | Paperclip button (`PaperClipIcon`) shown when cut items exist and no attach folder yet |
| `src/components/entries/FolderEntry.tsx` | `isAttachFolder` prop; hides name text on hover, hides move buttons, hides row in read-only Document Mode |
| `src/utils/indexUtil.ts` | `validateAttachFolderLocation` and `reorderAttachFolders` — keeps `.INDEX.yaml` ordering correct after moves |
| `src/main.ts` | IPC `renameFile` handler automatically renames the sibling `.attach` folder |
