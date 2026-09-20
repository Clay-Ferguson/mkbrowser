# Document Mode

<!-- TOC -->

* [Overview](#overview)
* [The `.INDEX.yaml` File](#the-indexyaml-file)
  * [Example](#example)
  * [Schema Version](#schema-version)
* [Enabling Custom Ordering](#enabling-custom-ordering)
* [Insert Bars](#insert-bars)
* [Reconciliation](#reconciliation)
  * [Purpose](#purpose)
  * [When Reconciliation Runs](#when-reconciliation-runs)
  * [Algorithm (`reconcileIndexedFiles`)](#algorithm-reconcileindexedfiles)
  * [`insertIntoIndexYaml`](#insertintoindexyaml)
* [Atomic, Serialized Index Updates](#atomic-serialized-index-updates)
  * [Front-Matter IDs on Save (`ensureFrontMatterIdIfIndexed` / `recordFrontMatterIdInIndex`)](#front-matter-ids-on-save-ensurefrontmatteridifindexed--recordfrontmatteridinindex)
* [Stable Identity via Front-Matter IDs](#stable-identity-via-front-matter-ids)
* [Code Locations](#code-locations)

<!-- /TOC -->

## Overview

This application supports something called `Document Mode` which is the ability to do "block based" document editing (in `BrowseView.tsx` component), similar idea to Jupyter Notebooks, but where we're using individual files (in a particular folder) as the "blocks", and we let the containing folder of those files represent the whole document. 

`Document Mode` is considered to be active for any given folder that contains a `.INDEX.yaml` file, which is the file that controls the ordering of files and folders, that are in the same folder with the `.INDEX.yaml`. Note that `Document Mode` is not recursive, and that the `.INDEX.yaml` file only controls ordering of files in it's same folder, and not any subfolders. Subfolders will have their own `.INDEX.yaml`, or not, independently.

The user experience is Jupyter-like, but we're using individual markdown files and/or images as the document content. any folder that contains a file named `.INDEX.yaml` is considered to be a "Document" and so when the user navigates to one of these folders, it triggers our GUI to begin displaying and editing the files and folders in a particular order, with a unique set of features that is not available to the standard file system type editing that we do for ordinary folders. the key innovation that we accomplish with the `.INDEX.yaml` is to have the yam will be able to define a custom file ordering (ordinal positioning) for each file in the document, so that the document structure is maintained.

The way a user would initialize this special "Document View" for any given folder is simply by navigating to that folder and then picking, **Enable Document Mode** from the Edit menu (`EditPopupMenu.tsx`). This will automatically create the `.INDEX.yaml` file (and initializle it) and switch the user into the Document View mode. The react global state variable that indicates we're in document mode is `hasIndexFile`.

The document-editing controls (insert bars, selection checkboxes, and the ordering/creation buttons) are always visible whenever a folder is a document — there is no separate "Edit Mode" toggle.


## The `.INDEX.yaml` File

`.INDEX.yaml` is a hidden YAML file placed directly inside the directory it controls. It has three top-level keys:

- **`version`** — the schema version this file uses (`CURRENT_INDEX_VERSION`, currently `1`). See [Schema Version](#schema-version).
- **`files`** — an ordered list of entries. Each entry has at minimum a `name` field (the exact filename or folder name as it appears on disk). Markdown files also carry an `id` field — a 9-character uppercase hex string used as a stable identity across renames. Non-markdown files (images, PDFs, txt) carry `create_time` and `size` fields instead, forming a best-effort `createTime:size:ext` fingerprint for rename detection (see [Stable Identity](#stable-identity-via-front-matter-ids)).
- **`options`** _(optional)_ — a map of directory-level settings. It is reserved for future per-directory settings and is preserved across reconciliation. Nothing currently writes it.

### Example

```yaml
version: 1
files:
  - name: Introduction.md
    id: A1B2C3D4E
  - name: Chapter 1
  - name: Chapter 2
  - name: References.md
    id: F5E6D7C8B
  - name: cover.png
    create_time: 1717000000000
    size: 20480
  - name: notes.txt
    create_time: 1717000000000
    size: 512
```

Key points:

- **All visible entries are listed** — not just markdown files. Folders, images, PDFs, and any other non-hidden file in the directory appear in the list.
- **Only markdown files have `id`** — non-markdown files have no front matter, so no stable ID can be derived from them. They are fingerprinted by `create_time` + `size` instead (a best-effort identity, not a guaranteed-unique one — see [Stable Identity](#stable-identity-via-front-matter-ids)).
- **Order is authoritative** — the display order in the app exactly follows the sequence in this file.
- **Hidden entries are excluded** — files and folders whose names begin with `.` (including `.INDEX.yaml` itself) are never listed.
- **`options` is preserved across reconciliation** — when `reconcileIndexedFiles` rewrites `.INDEX.yaml`, it reads the existing `options` block and writes it back unchanged, so directory settings are never lost.

### Schema Version

The format originally carried no `version` key, so a file without one is by definition the original layout — which *is* version 1. A missing (or non-numeric) `version` therefore **defaults** to `CURRENT_INDEX_VERSION` rather than being an error, and the key is added to a pre-existing file the next time anything rewrites it. No migration step is needed.

The field exists for one direction only: a future build that changes the layout bumps `CURRENT_INDEX_VERSION`, and **every build refuses to write an index declaring a version above its own**. Without that guard an older build would cheerfully rewrite a newer file in the old layout, silently discarding whatever the new layout added — the same unrecoverable data loss the corrupt-index refusal exists to prevent, so it is surfaced the same way (`corruptIndex: true` → blocking dialog).

Readers are deliberately **not** guarded. `readIndexYaml` (used by the directory listing, export, and AI document context) accepts any version, because a future file still has a `files` list and ordering the view by it beats silently falling back to alphabetical. Only the writing paths go through `readIndexYamlChecked`, which is where the version check lives.

## Enabling Custom Ordering

Custom ordering is enabled via the **Edit menu**, accessible from the edit button in the BrowseView toolbar. When no `.INDEX.yaml` exists in the current folder, the menu shows its standard items (Select All, Split, Join, etc.) plus an additional item at the very bottom:

> **Enable Document Mode**

Clicking this item triggers `reconcileIndexedFiles` with `createIfMissing = true`, which:

1. Assigns a front-matter `id` to every markdown file in the directory that does not already have one.
2. Creates `.INDEX.yaml` and populates it with all visible entries in filesystem order.
3. Refreshes the directory listing.

After the refresh, BrowseView detects entries with `indexOrder` values and switches into indexed mode: the sort menu is replaced by an informational message ("Files ordered by .INDEX.yaml"), the "Enable Document Mode" item disappears from the Edit menu, and insert bars appear between every entry.


## Insert Bars

When a directory is in indexed mode, two icon buttons appear between every consecutive pair of entries and at the very top of the list:

- **Create File here** (blue document-plus icon)
- **Create Folder here** (amber folder-plus icon)

Clicking either button opens the standard create dialog. On confirmation, the new entry is written to disk and then `insertIntoIndexYaml` is called to splice it into `.INDEX.yaml` at the correct position. The position is determined by the entry immediately preceding the insert bar (`insertAfterName`); a bar at the very top passes `null` to insert at index 0.

The header-level create buttons (previously the only way to create files/folders) are hidden in indexed mode because the inline insert bars replace them.

The index tree's right-click **New File** item (`IndexTreeView.tsx`) is a shortcut into the same two behaviors, chosen by whether the right-clicked folder has an `.INDEX.yaml`: a document folder gets a timestamp-named file created immediately at ordinal 0 (exactly what the topmost insert bar does), any other folder gets the usual name prompt. Either way the file is created *before* the browse view is navigated to that folder, so the single directory load the navigation triggers already includes it.


## Reconciliation

### Purpose

Reconciliation keeps `.INDEX.yaml` consistent with the actual contents of the directory — which can be changed at any time by tools other than MkBrowser. It handles five concerns:

1. **ID assignment** — every markdown file should have a unique `id` in its YAML front matter.
2. **Rename detection** — if a markdown file is renamed on disk, its `id` (which persists in the front matter) lets the index entry's `name` be updated to match the new filename. Non-markdown files use the fingerprint path instead.
3. **New-entry detection** — files or folders present on disk but absent from the index are appended to the end of the index.
4. **Deletion** — entries whose file no longer exists on disk are dropped.
5. **Orphan healing** — an entry whose `id` no longer matches any file, but whose name is still on disk and unclaimed, is re-bound to that file in place (adopting its current id) rather than being dropped and re-appended. This is what keeps a hand-edited front-matter `id` from producing two entries for one file.

### When Reconciliation Runs

`reconcileIndexedFiles` takes one flag, `createIfMissing`, which has only two callers' worth of meaning:

| Trigger | `createIfMissing` | Effect |
|---|---|---|
| **Enable Document Mode** clicked | `true` | Creates `.INDEX.yaml` if absent, then reconciles |
| **Everything else** (folder navigation, refresh, and the file operations below) | `false` | Reconciles an existing index; does nothing if no `.INDEX.yaml` |

Importantly, reconciliation does **not** run on every file-operation refresh (create, rename) — for performance, not safety. The insert bars call `insertIntoIndexYaml` directly and do not trigger reconciliation. Operations that remove or add files, however, do keep the index in sync themselves rather than waiting for the next navigation: delete, paste (both folders), clipboard paste, and **Join** call `reconcileIndexedFiles` explicitly after they mutate the disk (for Join, that drops the merged-away sources' entries while the surviving target keeps its entry and position), and **Split** splices its `-01` … `-NN` parts into the index directly after the original file's entry via `insertIntoIndexYaml` and then reconciles — the reconcile re-points the original's entry to the new `-00` file in place via its front-matter id (which travels with part 0's content) — so the parts keep the original file's document position instead of being appended at the end. (Concurrency safety is handled separately by the per-directory lock described below, so even if two index operations do overlap they can no longer corrupt the index.)

### Algorithm (`reconcileIndexedFiles`, and other helpers)

Located in `src/main/indexUtil.ts`.

```
1. Read .INDEX.yaml from disk (raw text — the verbatim bytes are needed for step 8).
   - If it does not exist and createIfMissing = false → return immediately.
   - If it does not exist and createIfMissing = true → start with an empty files list.
   - If it exists but is unreadable / malformed / declares a newer `version`
     → refuse with corruptIndex: true. Never rebuild over it.

2. Read all non-hidden directory entries (files + folders).

3. Build identity for every visible entry (`ensureMarkdownIds`,
   `buildNonMarkdownFingerprints`):
   - Markdown: parse front matter; record an existing `id`, or generate a
     9-char uppercase hex ID (nanoid customAlphabet) and write it into the file.
     IDs must be unique within the directory — on a duplicate (e.g. a copy/paste
     that carried its source's front matter) the OLDEST file keeps the id and the
     newer one is re-keyed, so the original keeps its entry and position.
     Every id write is a guarded compare-and-swap: the file is re-read and
     byte-compared first, so an editor save landing in between is never clobbered.
   - Non-markdown: stat into a `createTime:size:ext` fingerprint.

4. Reconcile each existing index entry (`reconcileEntries`):
   - Entry has `id` → look it up in idToName.
       Found     → set entry.name to the actual filename (handles renames), mark handled.
       Not found → deferred to step 5.
   - Entry has a fingerprint → match it against the disk fingerprints, but ONLY
     when it maps 1:1 (exactly one entry and one file share it). Ambiguous
     fingerprints fall back to name-only matching and never re-point, so a
     collision can't bind an entry to the wrong file. A name-matched entry has
     its stored fingerprint refreshed from the current stat, otherwise one
     content edit would permanently disable rename detection for that file.
   - Entry has neither (folder, or an old entry predating fingerprints)
       → match by name; adopt the file's id if it now has one.

5. Adoption pass: an entry whose `id` matched nothing, but whose NAME is still on
   disk and unclaimed, is that same file with a hand-edited or removed
   front-matter id. Re-bind the entry to it and adopt the file's current id —
   preserving the entry's position. (Without this the index would end up holding
   two entries for one file, showing it twice in the UI.)

6. Drop entries for files that no longer exist: an entry is kept if it matched by
   id or was adopted; an id entry that matched neither is dropped even when its
   name is still visible (that name belongs to the entry holding the file's id).
   Everything else is judged on whether its name is still on disk.

7. Append every visible entry not yet handled (`appendNewEntries`), with identity
   seeded, at the END of the list.

8. Dump `{ version, files, options }` and write it back — but only if the result
   differs from the verbatim text read in step 1, so an unchanged reconcile does
   no disk write at all.
```

### `insertIntoIndexYaml`

Also in `src/main/indexUtil.ts`. Used by the insert bars to add a single new entry at a specific position without re-running the full reconcile:

1. Read the current `.INDEX.yaml` (via `readIndexYamlChecked` — it writes, so a corrupt or too-new index is refused rather than rebuilt).
2. Build the new entry with `buildEntryForName`, which seeds its identity immediately: a front-matter `id` for a markdown file, a `create_time`+`size` fingerprint for another file, name only for a folder. So the entry is complete from the moment it is inserted, not just after the next reconcile.
3. Place it:
   - `insertAfterName === null` → unshift to position 0 (the topmost insert bar).
   - `insertAfterName` found → splice immediately after it.
   - `insertAfterName` not found → push to the end (a safe fallback; the next reconcile leaves it where it is).
4. Write the updated list back.

Existing `id` fields on all other entries are preserved.


## Atomic, Serialized Index Updates

Every function that changes `.INDEX.yaml` follows the same shape: **read** the file → **modify** the parsed `files`/`options` in memory → **`writeFileAtomic`** the whole thing back. `writeFileAtomic` (temp file + rename) guarantees the *final write* is atomic, so a reader never sees a half-written file. It does **not**, on its own, make the surrounding read-modify-write atomic *as a unit*: two operations on the same directory could both read the old index and then each write back its own version, and the later write would silently drop the earlier one's change (a lost update). Because the UI can fire these in quick succession (an insert right before a move, rapid move clicks), that was a real hazard.

To close it, all mutating operations are funneled through **`withIndexLock(dirPath, fn)`** (`src/main/indexUtil.ts`). It is a per-directory promise-chain mutex: each operation waits for the previous one on the *same* `.INDEX.yaml` to settle before it reads, so reads and writes for a given directory never interleave. Different directories never block each other, everything runs in the single Electron main process (so no OS-thread locking is needed), and the stored chain promise never rejects, so one failed mutation can't break serialization for the next. The functions wrapped by it are `insertIntoIndexYaml`, `moveInIndexYaml`, `moveToEdgeInIndexYaml`, `renameInIndexYaml`, `recordFrontMatterIdInIndex`, and `reconcileIndexedFiles`.

One consequence: a locked function must not call another locked function on the same directory (it would deadlock on its own lock). That is why `moveInIndexYaml` and `moveToEdgeInIndexYaml` fold the attach-folder reorder (`reorderAttachFolders`) into their own single write instead of delegating it to a separate locked pass. This also removes a gratuitous second disk write.

A second rule follows from the "never write over an index we can't understand" invariant: **every writing path reads through `readIndexYamlChecked`, never `readIndexYaml`.** The checked reader is the one that reports an existing-but-unloadable index (and a too-new [`version`](#schema-version)) as an error rather than collapsing it to "absent", which is what stops a mutator from rebuilding over user ordering it couldn't parse.

### Front-Matter IDs on Save (`ensureFrontMatterIdIfIndexed` / `recordFrontMatterIdInIndex`)

Saving a markdown file in a Document Mode folder must give it a front-matter `id` and record that `id` in `.INDEX.yaml`. To avoid ever recording an `id` in the index for content that was never written, the work is split and **ordered file-first**:

1. **`ensureFrontMatterIdIfIndexed(filePath, content)`** — if the folder is in Document Mode and the content has no `id`, it returns the content with a freshly injected `id` plus that id as `addedId` (or `addedId: null` for a no-op). It does **not** touch `.INDEX.yaml`.
2. The `write-file` IPC handler writes the (id-bearing) content to disk.
3. **`recordFrontMatterIdInIndex(filePath, addedId)`** — *only after* the file is on disk — records the id in `.INDEX.yaml`, **appending** a new `{ name, id }` entry if the file isn't listed yet (so a brand-new file is consistent immediately, not just after the next reconcile).

If step 3 fails, the file still carries the id and the next reconcile heals the index; the reverse — an index id with no matching file content — can no longer happen. (See issues 013 and 014.)


## Stable Identity via Front-Matter IDs

Each markdown file gets a front-matter block added (or extended) with an `id` field:

```markdown
---
id: A1B2C3D4E
---

# Document content here
```

The ID is generated with `customAlphabet('0123456789ABCDEF', 9)` from the `nanoid` library, producing a 9-character uppercase hex string. IDs are stored in both the file's front matter and in the corresponding `.INDEX.yaml` entry. This makes it possible to detect renames: even after a file is moved to a different name, its `id` in the front matter matches an existing index entry, allowing the entry's `name` to be corrected automatically on the next reconcile.

### Non-Markdown Files: Fingerprint Identity (and Its Limits)

Non-markdown files (images, PDFs, txt) have no front matter, so they can't carry an `id`. To still detect renames, `reconcileIndexedFiles` fingerprints each one as `createTime:size:ext`, derived from `fs.stat` (rounded `birthtimeMs`, byte `size`, and lowercased extension) and stored on the entry as `create_time` + `size`. On the next reconcile, an index entry whose stored fingerprint matches a disk file's is treated as a rename and re-pointed to that file.

Unlike a front-matter `id`, **this fingerprint is not guaranteed unique**:

- **Collisions are real.** Two files of the same type with the same byte size and the same (rounded) creation time produce identical fingerprints — common for empty files (`size === 0`), batch exports, or two copies of the same asset created together.
- **`birthtimeMs` is unreliable.** It is not supported on every Linux filesystem (some ext variants, network/overlay mounts), where Node returns `0`. When birthtime is `0` for every file, the time component is constant and fingerprints collapse to `0:size:ext`, sharply increasing collisions.

Because a wrong re-point silently corrupts the index (an entry bound to the wrong file, the genuine file dropped), reconciliation treats a fingerprint as a trustworthy rename signal **only when it maps one-to-one**: exactly one index entry and exactly one disk file share it. When a fingerprint is ambiguous (claimed by more than one entry and/or matching more than one disk file), reconciliation falls back to **name-only matching** and never re-points — so an entry stays bound to its own file. The trade-off is that a rename among colliding files may be missed (the old entry is dropped and the renamed file re-appended as a new entry), which is a safe, non-destructive failure mode. This logic lives in `reconcileEntries` (`src/main/indexUtil.ts`); see issue 009.



## Code Locations

| Concern                                                             | File |
|---|---|
| Reconcile, insert-into-index, move, rename, and identity logic      | `src/main/indexUtil.ts` |
| `.INDEX.yaml` filename constant (`INDEX_FILENAME`)                  | `src/shared/specialFiles.ts` |
| IPC handlers (`reconcile-indexed-files`, `insert-into-index-yaml`)  | `src/main.ts` |
| Preload bridge                                                      | `src/preload.ts` |
| API type declarations (`ElectronAPI`)                               | `src/shared/shared.ts` |
| BrowseView — insert bars, indexed-mode rendering, useEffects        | `src/components/views/BrowseView.tsx` |
| Edit menu ("Enable Document Mode" item)                             | `src/components/menus/EditPopupMenu.tsx` |
| Directory reading + indexOrder injection                            | `src/main/fileUtil.ts` |
| Export ordering (`getSortedDirEntries` consumer)                    | `src/main/exportUtil.ts` |
| Atomic write primitive (`writeFileAtomic`)                          | `src/main/atomicWrite.ts` |


