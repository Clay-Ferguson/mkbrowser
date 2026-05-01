# Document Mode

<!-- TOC -->

* [Overview](#overview)
* [The `.INDEX.yaml` File](#the-indexyaml-file)
  * [Example](#example)
* [Enabling Custom Ordering](#enabling-custom-ordering)
* [Insert Bars](#insert-bars)
* [Reconciliation](#reconciliation)
  * [Purpose](#purpose)
  * [When Reconciliation Runs](#when-reconciliation-runs)
  * [Algorithm (`reconcileIndexedFiles`)](#algorithm-reconcileindexedfiles)
  * [`insertIntoIndexYaml`](#insertintoindexyaml)
* [Stable Identity via Front-Matter IDs](#stable-identity-via-front-matter-ids)
* [Code Locations](#code-locations)

<!-- /TOC -->

## Overview

This application supports something called `Document Mode` which is the ability to do "block based" document editing (in `BrowseView.tsx` component), similar idea to Jupyter Notebooks, but where we're using individual files (in a particular folder) as the "blocks", and we let the containing folder of those files represent the whole document. 

`Document Mode` is considered to be active for any given folder that contains a `.INDEX.yaml` file, which is the file that controls the ordering of files and folders, that are in the same folder with the `.INDEX.yaml`. Note that `Document Mode` is not recursive, and that the `.INDEX.yaml` file only controls ordering of files in it's same folder, and not any subfolders. Subfolders will have their own `.INDEX.yaml`, or not, independently.

The user experience is Jupyter-like, but we're using individual markdown files and/or images as the document content. any folder that contains a file named `.INDEX.yaml` is considered to be a "Document" and so when the user navigates to one of these folders, it triggers our GUI to begin displaying and editing the files and folders in a particular order, with a unique set of features that is not available to the standard file system type editing that we do for ordinary folders. the key innovation that we accomplish with the `.INDEX.yaml` is to have the yam will be able to define a custom file ordering (ordinal positioning) for each file in the document, so that the document structure is maintained.

The way a user would initialize this special "Document View" for any given folder is simply by navigating to that folder and then picking, **Custom File Ordering** from the sort options menu (`SortPopupMenu.tsx`). This will automatically create the `.INDEX.yaml` file (and initializle it) and switch the user into the Document View mode. The react global state variable that indicates we're in document mode is `hasIndexFile`.

Whenever a folder is a document there will also be an additional mode flag called "Edit Mode", which can be turned on and off by a checkbox at the top right of the screen (labeled "Edit"). When the user has Edit Mode enabled there will be additional icon buttons on the screen that allow certain features (related to ordering and creating of new files) to appear on the screen which are helpful for editing a document. The react global state variable for edit mode is named `indexYaml?.options?.edit_mode`.


## The `.INDEX.yaml` File

`.INDEX.yaml` is a hidden YAML file placed directly inside the directory it controls. It has two top-level keys:

- **`files`** — an ordered list of entries. Each entry has at minimum a `name` field (the exact filename or folder name as it appears on disk). Markdown files also carry an `id` field — a 9-character uppercase hex string used as a stable identity across renames.
- **`options`** _(optional)_ — a map of directory-level settings. Currently supports:
  - `edit_mode` (`boolean`) — when `true`, the directory opens in edit mode by default.

### Example

```yaml
files:
  - name: Introduction.md
    id: A1B2C3D4E
  - name: Chapter 1
  - name: Chapter 2
  - name: References.md
    id: F5E6D7C8B
  - name: cover.png
  - name: notes.txt
options:
  edit_mode: true
```

Key points:

- **All visible entries are listed** — not just markdown files. Folders, images, PDFs, and any other non-hidden file in the directory appear in the list.
- **Only markdown files have `id`** — non-markdown files have no front matter, so no stable ID can be derived from them. They are tracked by name only.
- **Order is authoritative** — the display order in the app exactly follows the sequence in this file.
- **Hidden entries are excluded** — files and folders whose names begin with `.` (including `.INDEX.yaml` itself) are never listed.
- **`options` is preserved across reconciliation** — when `reconcileIndexedFiles` rewrites `.INDEX.yaml`, it reads the existing `options` block and writes it back unchanged, so directory settings are never lost.

## Enabling Custom Ordering

Custom ordering is enabled via the **Sort menu**, accessible from the sort button in the BrowseView toolbar. When no `.INDEX.yaml` exists in the current folder, the menu shows the standard sort options (Filename, Created Time, etc.) plus an additional item at the bottom:

> **Enable Custom Ordering**

Clicking this item triggers `reconcileIndexedFiles` with `createIfMissing = true`, which:

1. Assigns a front-matter `id` to every markdown file in the directory that does not already have one.
2. Creates `.INDEX.yaml` and populates it with all visible entries in filesystem order.
3. Refreshes the directory listing.

After the refresh, BrowseView detects entries with `indexOrder` values and switches into indexed mode: the sort menu is replaced by an informational message ("Files ordered by .INDEX.yaml"), and insert bars appear between every entry.

Once a `.INDEX.yaml` exists, the **Enable Custom Ordering** item no longer appears in the sort menu.


## Insert Bars

When a directory is in indexed mode, two icon buttons appear between every consecutive pair of entries and at the very top of the list:

- **Create File here** (blue document-plus icon)
- **Create Folder here** (amber folder-plus icon)

Clicking either button opens the standard create dialog. On confirmation, the new entry is written to disk and then `insertIntoIndexYaml` is called to splice it into `.INDEX.yaml` at the correct position. The position is determined by the entry immediately preceding the insert bar (`insertAfterName`); a bar at the very top passes `null` to insert at index 0.

The header-level create buttons (previously the only way to create files/folders) are hidden in indexed mode because the inline insert bars replace them.


## Reconciliation

### Purpose

Reconciliation keeps `.INDEX.yaml` consistent with the actual contents of the directory. It handles three concerns:

1. **ID assignment** — every markdown file should have a unique `id` in its YAML front matter.
2. **Rename detection** — if a markdown file is renamed on disk, its `id` (which persists in the front matter) lets the index entry's `name` be updated to match the new filename.
3. **New-entry detection** — files or folders present on disk but absent from the index are appended to the end of the index.

### When Reconciliation Runs

Reconciliation is triggered in two situations:

| Trigger | `createIfMissing` | Effect |
|---|---|---|
| **Folder navigation** (`currentPath` changes) | `false` | Reconciles existing index; does nothing if no `.INDEX.yaml` |
| **Enable Custom Ordering** clicked | `true` | Creates `.INDEX.yaml` if absent, then reconciles |

Importantly, reconciliation does **not** run on every file-operation refresh (create, rename, delete, paste). This prevents concurrent executions that could corrupt the index. The insert bars call `insertIntoIndexYaml` directly and do not trigger reconciliation.

### Algorithm (`reconcileIndexedFiles`, and other helpers)

Located in `src/utils/indexUtil.ts`.

```
1. Read .INDEX.yaml from disk.
   - If it does not exist and createIfMissing = false → return immediately.
   - If it does not exist and createIfMissing = true → start with an empty files list.

2. Read all non-hidden directory entries (files + folders).

3. For each markdown file in the directory:
   a. Parse its YAML front matter.
   b. If it already has an `id`, record it in nameToId / idToName maps.
   c. If it has no `id`, generate a 9-char uppercase hex ID (nanoid customAlphabet),
      write it into the file's front matter, and record it in the maps.

4. Walk the existing index entries and reconcile each one:
   - Entry has `id`:
       Look up the id in idToName.
       If found → set entry.name to the actual filename (handles renames).
                 → mark the name as handled.
       If not found → file was deleted; keep the entry for now (see TODO).
   - Entry has no `id`:
       Mark its name as handled.
       If a matching markdown file exists in nameToId → assign the id to the entry.

5. For every visible directory entry whose name is not yet in handledNames,
   append a new entry to the files list (with id if it is a markdown file).

6. Write the updated files list back to .INDEX.yaml.
```

### `insertIntoIndexYaml`

Also in `src/utils/indexUtil.ts`. Used by the insert bars to add a single new entry at a specific position without re-running the full reconcile:

1. Read the current `.INDEX.yaml`.
2. Find the entry named `insertAfterName` in the files list.
3. Splice the new entry immediately after it (or unshift to position 0 if `insertAfterName` is `null`).
4. Write the updated list back.

Existing `id` fields on all other entries are preserved.


## Stable Identity via Front-Matter IDs

Each markdown file gets a front-matter block added (or extended) with an `id` field:

```markdown
---
id: A1B2C3D4E
---

# Document content here
```

The ID is generated with `customAlphabet('0123456789ABCDEF', 9)` from the `nanoid` library, producing a 9-character uppercase hex string. IDs are stored in both the file's front matter and in the corresponding `.INDEX.yaml` entry. This makes it possible to detect renames: even after a file is moved to a different name, its `id` in the front matter matches an existing index entry, allowing the entry's `name` to be corrected automatically on the next reconcile.



## Code Locations

| Concern                                                             | File |
|---|---|
| Reconcile, insert-into-index, and write-options logic               | `src/utils/indexUtil.ts` |
| IPC handlers (`reconcile-indexed-files`, `insert-into-index-yaml`)  | `src/main.ts` |
| Preload bridge                                                      | `src/preload.ts` |
| API type declarations                                               | `src/global.d.ts` |
| BrowseView — insert bars, indexed-mode rendering, useEffects        | `src/components/views/BrowseView.tsx` |
| Sort menu — Enable Custom Ordering item                             | `src/components/menus/SortPopupMenu.tsx` |
| Directory reading + indexOrder injection                            | `src/utils/fileUtils.ts` |


