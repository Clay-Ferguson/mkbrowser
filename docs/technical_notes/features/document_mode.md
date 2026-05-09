# Document Mode

<!-- TOC -->

* [Overview](#overview)
* [The `.INDEX.yaml` File](#the-indexyaml-file)
  * [Example](#example)
* [Enabling Custom Ordering](#enabling-custom-ordering)
* [Insert Bars](#insert-bars)
* [File Attachments (Children)](#file-attachments-children)
  * [Data model](#data-model)
  * [UX flow](#ux-flow)
  * [`pasteAsChildrenInIndexYaml`](#pasteaschildreninindexmyaml)
  * [Rendering](#rendering)
* [Reconciliation](#reconciliation)
  * [Purpose](#purpose)
  * [When Reconciliation Runs](#when-reconciliation-runs)
  * [Algorithm (`reconcileIndexedFiles`)](#algorithm-reconcileindexedfiles)
  * [Tree helpers](#tree-helpers)
  * [`insertIntoIndexYaml`](#insertintoindexyaml)
* [Stable Identity via Front-Matter IDs](#stable-identity-via-front-matter-ids)
* [Code Locations](#code-locations)

<!-- /TOC -->

## Overview

This application supports something called `Document Mode` which is the ability to do "block based" document editing (in `BrowseView.tsx` component), similar idea to Jupyter Notebooks, but where we're using individual files (in a particular folder) as the "blocks", and we let the containing folder of those files represent the whole document. 

`Document Mode` is considered to be active for any given folder that contains a `.INDEX.yaml` file, which is the file that controls the ordering of files and folders, that are in the same folder with the `.INDEX.yaml`. Note that `Document Mode` is not recursive, and that the `.INDEX.yaml` file only controls ordering of files in its same folder, and not any subfolders. Subfolders will have their own `.INDEX.yaml`, or not, independently.

The user experience is Jupyter-like, but we're using individual markdown files and/or images as the document content. Any folder that contains a file named `.INDEX.yaml` is considered to be a "Document" and so when the user navigates to one of these folders, it triggers our GUI to begin displaying and editing the files and folders in a particular order, with a unique set of features that is not available to the standard file system type editing that we do for ordinary folders. The key innovation is that the YAML defines a custom ordering (ordinal positioning) for each file in the document — and, now, an optional parent-child **hierarchy** so that files can be attached to other files as dependents.

The way a user would initialize this special "Document View" for any given folder is simply by navigating to that folder and then picking, **Custom File Ordering** from the sort options menu (`SortPopupMenu.tsx`). This will automatically create the `.INDEX.yaml` file (and initialize it) and switch the user into the Document View mode. The React global state variable that indicates we're in document mode is `hasIndexFile`.

Whenever a folder is a document there will also be an additional mode flag called "Edit Mode", which can be turned on and off by a checkbox at the top right of the screen (labeled "Edit"). When the user has Edit Mode enabled there will be additional icon buttons on the screen that allow certain features (related to ordering and creating of new files) to appear on the screen which are helpful for editing a document. The React global state variable for edit mode is named `indexYaml?.options?.edit_mode`.


## The `.INDEX.yaml` File

`.INDEX.yaml` is a hidden YAML file placed directly inside the directory it controls. It has two top-level keys:

- **`files`** — an ordered list of entries. Each entry has at minimum a `name` field (the exact filename or folder name as it appears on disk). Markdown files also carry an `id` field — a 9-character uppercase hex string used as a stable identity across renames. Non-markdown files carry `create_time` and `size` fingerprint fields for rename detection. Any entry may optionally carry a **`children`** field — a nested list of entries (same structure, same fields) representing files that are logically attached to that parent.
- **`options`** _(optional)_ — a map of directory-level settings. Currently supports:
  - `edit_mode` (`boolean`) — when `true`, the directory opens in edit mode by default.

### Example

```yaml
files:
  - name: Introduction.md
    id: A1B2C3D4E
  - name: Chapter 1.md
    id: F5E6D7C8B
    children:
      - name: diagram.png
        create_time: 1715000000000
        size: 84321
      - name: notes.txt
        create_time: 1715000001000
        size: 412
  - name: Chapter 2
  - name: References.md
    id: 99AA11BB2
  - name: cover.png
    create_time: 1714900000000
    size: 204800
options:
  edit_mode: true
```

Key points:

- **All visible entries are listed** — not just markdown files. Folders, images, PDFs, and any other non-hidden file in the directory appear in the list.
- **Only markdown files have `id`** — non-markdown files have no front matter, so no stable ID can be derived from them. They are tracked by `create_time` + `size` fingerprint.
- **Order is authoritative** — the display order in the app exactly follows the sequence in this file.
- **Hidden entries are excluded** — files and folders whose names begin with `.` (including `.INDEX.yaml` itself) are never listed.
- **`children` entries are files in the same folder** — children are not subfolders; they are physically co-located in the same directory. The parent-child relationship is purely a YAML concept and does not change the filesystem layout.
- **Children can nest to any depth** — each child entry uses the same `IndexEntry` shape and may itself carry a `children` list.
- **`options` is preserved across reconciliation** — when `reconcileIndexedFiles` rewrites `.INDEX.yaml`, it reads the existing `options` block and writes it back unchanged.

## Enabling Custom Ordering

Custom ordering is enabled via the **Sort menu**, accessible from the sort button in the BrowseView toolbar. When no `.INDEX.yaml` exists in the current folder, the menu shows the standard sort options (Filename, Created Time, etc.) plus an additional item at the bottom:

> **Enable Document Mode**

Clicking this item triggers `reconcileIndexedFiles` with `createIfMissing = true`, which:

1. Assigns a front-matter `id` to every markdown file in the directory that does not already have one.
2. Creates `.INDEX.yaml` and populates it with all visible entries in filesystem order.
3. Refreshes the directory listing.

After the refresh, BrowseView detects entries with `indexOrder` values and switches into indexed mode: the sort menu is replaced by an informational message ("Files ordered by .INDEX.yaml"), and insert bars appear between every root-level entry.


## Insert Bars

When a directory is in indexed mode, two icon buttons appear between every consecutive pair of **root-level** entries and at the very top of the list:

- **Create File here** (blue document-plus icon)
- **Create Folder here** (amber folder-plus icon)

Clicking either button opens the standard create dialog. On confirmation, the new entry is written to disk and then `insertIntoIndexYaml` is called to splice it into `.INDEX.yaml` at the correct position. The position is determined by the entry immediately preceding the insert bar (`insertAfterName`); a bar at the very top passes `null` to insert at index 0.

Insert bars appear at the **root level only** — between children of a parent entry, inserts are managed via the cut-and-paste attachment flow described below.

The header-level create buttons (previously the only way to create files/folders) are hidden in indexed mode because the inline insert bars replace them.


## File Attachments (Children)

### Data model

The `IndexEntry` type carries an optional `children?: IndexEntry[]` field. Children are entries in the **same folder** that are logically grouped under a parent. The parent-child relationship is purely a YAML ordering concept — no filesystem move occurs when files are attached or detached; they continue to reside in the same directory.

A file that appears in a `children` list is excluded from the top-level `files[]` position it previously occupied. The `pasteAsChildrenInIndexYaml` function enforces this by calling `removeNamesFromTree` to strip the names from their current position in the tree before inserting them under the new parent.

### UX flow

1. The user selects one or more files via checkboxes and clicks **Cut** in the toolbar.
2. The user hovers over the entry they want to attach the cut items to.
3. A green **+** (PlusCircleIcon) button appears in that entry's `EntryActionBar`. This button is only visible when `editMode && hasCutItems`.
4. Clicking the button calls `handlePasteAsChild(parentName)` in `BrowseView`, which:
   - Collects the names of all cut items.
   - Calls `window.electronAPI.pasteAsChildrenInIndexYaml(currentPath, parentName, childNames)`.
   - Calls `clearAllCutItems()`.
   - Calls `reconcileIndexedFiles` to populate `id`/fingerprint fields on the newly added children.
   - Calls `onRefreshDirectory()`.

### `pasteAsChildrenInIndexYaml`

Located in `src/utils/indexUtil.ts`. Steps:

1. Read `.INDEX.yaml`.
2. Call `removeNamesFromTree(files, childNameSet)` — returns a new tree with the target names stripped from all levels, preventing the same entry from appearing twice.
3. Call `findEntryInTree(files, parentName)` on the cleaned tree to locate the parent entry.
4. Append `{ name }` stubs for each new child (skipping duplicates).
5. Write the updated `.INDEX.yaml`.

The bare `{ name }` stubs gain their `id` / `create_time` / `size` fields on the next `reconcileIndexedFiles` call.

### Rendering

`BrowseView` renders the hierarchy using several memos and a local `renderIndexedLevel(indexEntries, depth)` function defined inside the JSX IIFE:

| Memo | Purpose |
|---|---|
| `entryByName` | `Map<name, FileEntry>` — fast lookup of on-disk entry by name |
| `childNameSet` | `Set<name>` — all names that appear anywhere in the YAML tree as children |
| `topLevelIndexEntries` | `sortedEntries` filtered to exclude `childNameSet` members — used for insert-bar position arithmetic and passed to `createFileOp` / `createFolderOp` |
| `topLevelEntryIndexMap` | `Map<name, index>` within `topLevelIndexEntries` — maps a root entry name to its numeric insert position |

`renderIndexedLevel` recursively walks `indexYaml.files` (the full `IndexEntryData[]` tree from the store). For each entry it:
- Looks up the corresponding `FileEntry` in `entryByName`.
- Computes `moveUp` / `moveDown` / `moveToTop` / `moveToBottom` based on position within the **sibling array** (`indexEntries`), not within the global `sortedEntries`.
- Renders the appropriate entry component with those handlers and `onPasteAsChild`.
- If the entry has children, wraps the recursive call in `<div className="ml-6 border-l-2 border-slate-600">` to visually indent.
- At depth 0, appends an `IndexInsertBar` after each entry.

When `expandedEditor` is true the render falls back to a flat list of only the editing entry (hierarchy is irrelevant in full-screen edit mode).


## Reconciliation

### Purpose

Reconciliation keeps `.INDEX.yaml` consistent with the actual contents of the directory. It handles three concerns:

1. **ID assignment** — every markdown file should have a unique `id` in its YAML front matter.
2. **Rename detection** — if a markdown file is renamed on disk, its `id` (which persists in the front matter) lets the index entry's `name` be updated to match the new filename.
3. **New-entry detection** — files or folders present on disk but absent from the index are appended to the end of the root `files[]` list.

### When Reconciliation Runs

Reconciliation is triggered in several situations:

| Trigger | `createIfMissing` | Effect |
|---|---|---|
| **Folder navigation** (`currentPath` changes) | `false` | Reconciles existing index; does nothing if no `.INDEX.yaml` |
| **Enable Document Mode** clicked | `true` | Creates `.INDEX.yaml` if absent, then reconciles |
| **Paste as child** completes | `false` | Populates `id`/fingerprint fields on newly added child stubs |

Reconciliation does **not** run on every file-operation refresh (create, rename, delete, paste). This prevents concurrent executions that could corrupt the index. Insert bars call `insertIntoIndexYaml` directly and do not trigger reconciliation.

### Algorithm (`reconcileIndexedFiles`)

Located in `src/utils/indexUtil.ts`.

```
1. Read .INDEX.yaml from disk.
   - If it does not exist and createIfMissing = false → return immediately.
   - If it does not exist and createIfMissing = true → start with an empty files list.

2. Read all non-hidden directory entries (files + folders).

3. For each markdown file in the directory:
   a. Parse its YAML front matter.
   b. If it already has an `id`, record it in nameToId / idToName maps.
   c. If it has no `id`, generate a 9-char uppercase hex ID, write it into
      the file's front matter, and record it in the maps.

4. Call reconcileAndPruneTree(files, ...) — see Tree helpers below.
   This single pass walks the entire tree (root entries + all children at
   any depth), updating names and collecting handled names.

5. For every visible directory entry whose name is not in handledNames,
   append a new root-level entry (with id if markdown, fingerprint if not).

6. Write the updated files list back to .INDEX.yaml.
```

### Tree helpers

All helpers are module-private functions in `src/utils/indexUtil.ts`.

**`findEntryInTree(files, name)`**  
Depth-first search through the entry tree. Returns `{ entry, list, idx }` — the entry object, its containing array, and its index within that array. Returns `null` if not found. Used by `moveInIndexYaml`, `moveToEdgeInIndexYaml`, `ensureFrontMatterIdIfIndexed`, and `pasteAsChildrenInIndexYaml`.

**`reconcileAndPruneTree(entries, idToName, fingerprintToVisibleName, visibleNames, nameToId, nameToStat, handledNames)`**  
Recursively walks `entries`, reconciling each entry in-place and removing entries whose files no longer exist on disk. Returns the pruned list. For each surviving entry it recurses into `entry.children` (if any), so rename detection and deletion pruning work at every depth. Newly bare `{ name }` children (added by `pasteAsChildrenInIndexYaml`) get their `id` or `create_time`/`size` fields populated here.

**`removeNamesFromTree(entries, names)`**  
Returns a structurally new copy of `entries` with all entries whose `name` is in `names` removed, recursively at every depth. Used by `pasteAsChildrenInIndexYaml` to ensure an entry appears in exactly one place in the tree after being re-parented.

**`moveInIndexYaml` / `moveToEdgeInIndexYaml`**  
Both use `findEntryInTree` to locate the entry, then operate on `list` (the entry's containing sibling array) rather than on the root `files[]`. This means move operations work correctly whether the entry is at root level or nested inside a parent's `children[]`.

### `insertIntoIndexYaml`

Also in `src/utils/indexUtil.ts`. Used by the insert bars to add a single new entry at a specific position in the **root** `files[]` array only:

1. Read the current `.INDEX.yaml`.
2. Find the entry named `insertAfterName` in the root `files` list.
3. Splice the new entry immediately after it (or unshift to position 0 if `insertAfterName` is `null`).
4. Write the updated list back.

Existing `id` and `children` fields on all other entries are preserved.


## Stable Identity via Front-Matter IDs

Each markdown file gets a front-matter block added (or extended) with an `id` field:

```markdown
---
id: A1B2C3D4E
---

# Document content here
```

The ID is generated with `customAlphabet('0123456789ABCDEF', 9)` from the `nanoid` library, producing a 9-character uppercase hex string. IDs are stored in both the file's front matter and in the corresponding `.INDEX.yaml` entry. This makes it possible to detect renames: even after a file is moved to a different name, its `id` in the front matter matches an existing index entry, allowing the entry's `name` to be corrected automatically on the next reconcile.

`ensureFrontMatterIdIfIndexed` (called on every `.md` save) uses `findEntryInTree` to search the whole YAML tree — not just root `files[]` — so that markdown files living in a `children` list also get their index entry updated with the new `id`.


## Code Locations

| Concern | File |
|---|---|
| `IndexEntry` type, `IndexYaml` interface | `src/utils/indexUtil.ts` |
| Tree helpers: `findEntryInTree`, `reconcileAndPruneTree`, `removeNamesFromTree` | `src/utils/indexUtil.ts` |
| Reconcile, insert-into-index, move, write-options logic | `src/utils/indexUtil.ts` |
| `pasteAsChildrenInIndexYaml` | `src/utils/indexUtil.ts` |
| IPC handlers (`reconcile-indexed-files`, `insert-into-index-yaml`, `paste-as-children-in-index-yaml`, …) | `src/main.ts` |
| Preload bridge | `src/preload.ts` |
| API type declarations | `src/global.d.ts` |
| `IndexEntryData` interface (renderer-side mirror of `IndexEntry`) | `src/store/types.ts` |
| BrowseView — insert bars, hierarchical rendering, `renderIndexedLevel`, child memos | `src/components/views/BrowseView.tsx` |
| `EntryActionBar` — paste-as-child button (PlusCircleIcon) | `src/components/entries/common/EntryActionBar.tsx` |
| Sort menu | `src/components/menus/SortPopupMenu.tsx` |
| Directory reading + indexOrder injection | `src/utils/fileUtils.ts` |
