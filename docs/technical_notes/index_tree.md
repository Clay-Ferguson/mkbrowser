# Index Tree Application Panel

The component `IndexTreeView.tsx` (`src/components/views/`) is the tree view panel on the left side of the Browse tab. It displays the file system hierarchy below `rootPath`: only files and folders. Folders can be expanded and collapsed, and so can a file that owns an attachment folder (`<name>.attach`), which is shown as that file's child.

- **Clicking a folder** toggles it open or closed (reading its listing on first expand).
- **Clicking a file** highlights it, opens it on its own in single-file browsing (`setBrowseFile`, see `docs/technical_notes/single_file_browsing.md`), and toggles its attachment folder in the tree.
- **Right-clicking any node** opens `IndexTreeContextMenu` (see [Context Menu](#context-menu)).

`App.tsx` renders the panel beside `BrowseView`/`BrowseFile` inside the Browse tab, and omits it entirely when `settings.indexTreeWidth` is `'hidden'`.

## Node Type

Every node in the tree is a `FileNode` (defined in `src/shared/types.ts`):

```ts
interface FileNode {
  path: string;                 // absolute filesystem path (also the store lookup key)
  name: string;                 // display name (basename)
  isDirectory: boolean;
  isExpanded: boolean;
  isLoading: boolean;
  children: FileNode[] | null;  // null = never loaded
  indexOrder?: number;          // Document Mode (.INDEX.yaml) position
  hasAttachFolder?: boolean;    // file nodes only: a sibling `<name>.attach` folder exists
  isOwnedAttach?: boolean;      // an attachment folder shown under its owning file
}
```

`children: null` means the node has never been expanded and its contents are unknown. An empty array `[]` means it was expanded and genuinely has no children. A directory's children are its listing; a file's only possible child is its attachment folder (see `makeFileChildren` in `src/renderer/treeNodes.ts` and `docs/technical_notes/file_attachments.md`).

`isLoading` is still part of the type, but nothing currently sets it to `true` and no row renders a spinner for it. The builders always create nodes with `isLoading: false`, and `expandIndexTreeNode` clears it.

The root node is built by `IndexTreeView` itself when `rootPath` changes: its `path` and `name` are both `rootPath`, it is always expanded, and it is never rendered as a row. Only its children are drawn.

## Store Integration

The tree lives in the single Zustand store. The relevant `AppState` fields (in `src/shared/types.ts`) are:

| Field | Purpose |
|---|---|
| `indexTreeRoot: FileNode \| null` | The whole tree |
| `pendingIndexTreeReveal: string \| null` | A path the tree should expand to and scroll into view (see [Revealing a Path](#revealing-a-path)) |
| `pendingIndexTreeRevealExpandsFile: boolean` | When the reveal target is a file, also expand that file's node (showing its attachment folder) |

The actions live in `src/store/indexTree.ts` and are exported via the `src/store/index.ts` barrel:

| Function | Purpose |
|---|---|
| `setIndexTreeRoot(root)` | Replace the entire tree: on a `rootPath` change (`IndexTreeView`) and after a full refresh (`refreshIndexTree` in `directoryLoader.ts`) |
| `expandIndexTreeNode(path, children)` | Set a node's children, mark it expanded, and clear `isLoading`. Used for both directories (their listing) and files (their attachment folder) |
| `collapseIndexTreeNode(path)` | Mark a node collapsed without clearing its children |
| `collapseAllIndexTreeNodes()` | Recursively collapse every node (files included) below the root. The root itself stays expanded |
| `setIndexTreeNodeLoading(path, loading)` | Toggle the loading flag on a node (currently has no callers) |
| `setPendingIndexTreeReveal(path, expandFile?)` | Queue a reveal of `path` |
| `revealInTree(path)` | In one `set()`: highlight `path`, switch to the Browse tab, queue the reveal, and push a navigation-history entry |
| `clearPendingIndexTreeReveal()` | Clear the queued reveal (called by `IndexTreeView` once it picks it up) |
| `getIndexTreeRoot()` | Non-hook snapshot, used inside async callbacks |

The same slice also holds `setIndexYaml` and `getHasIndexFile`, which are about Document Mode's `.INDEX.yaml` for the current folder, not the tree.

Components subscribe with a direct selector: `useAS(s => s.indexTreeRoot)`.

The internal `updateNodeByPath(node, targetPath, updater)` function traverses the tree and applies `updater` to the node whose `path` matches `targetPath`. It keeps the identity of every subtree that doesn't contain the target, so the memo()'d rows for those skip re-rendering. Every action returns early, with no store write, when nothing changed (for example, collapsing an already-collapsed tree).

## Lazy Loading and Child Building

The tree uses lazy loading throughout. All child lists are built by the helpers in `src/renderer/treeNodes.ts`, so every path that builds children applies the same membership rules:

- `makeTreeNodes(entries)` converts a directory listing to `FileNode[]`. It omits any `.attach` folder whose owning file is in the same listing, because that folder shows under its file instead. An orphaned `.attach` folder stays as an ordinary folder under its real name.
- `mergeTreeNodes(entries, previousChildren)` rebuilds a folder's children from a fresh listing. It carries over, by path, the expansion state and loaded children of every surviving node, and reuses unchanged nodes as-is, so their rows don't re-render. A path that changed kind (file ↔ folder) does not inherit its old children.
- `makeFileChildren(file)` / `expandFileNode(node)` give a file its children without any I/O: the attachment-folder node (`isOwnedAttach: true`) when `hasAttachFolder` is set, otherwise an empty list.
- `findTreeNodeByPath(root, path)` is a depth-first lookup by path. It includes attachment folders under loaded file nodes.

How each kind of node loads:

- **Directories**: children are `null` until first expansion. On expand, `api.readDirectory(path)` is called and the result is passed through `mergeTreeNodes`, so a folder that was collapsed and reopened restores whatever was open underneath it.
- **Files**: `expandFileNode` reuses already-loaded children, or builds them with `makeFileChildren`.

## Keeping the Tree in Sync with Disk

There are two refresh paths, and both go through `mergeTreeNodes`:

- **`reloadExpandedTreeFolder(folderPath)`** re-reads one folder, but only if it is currently expanded. Collapsed folders reload lazily on their next expand. It is called after every tree-initiated change (paste, rename, delete, new file, new folder) for the affected folder(s), and by `completeEntryDrop` in `src/renderer/dragAndDrop.ts` for both the source and destination folders of a drag-and-drop move.
- **`refreshExpandedNodes(node)`** recursively re-reads every expanded directory, including an expanded attachment folder under an expanded file. It returns the same node object when nothing below it changed. `refreshDirectory()` in `src/renderer/directoryLoader.ts` calls it through `refreshIndexTree`, which installs the result with `setIndexTreeRoot`. If the tree changed while the reads were in flight, it redoes the refresh from the current tree instead, so a user's expand or collapse is never reverted.

Tree-initiated changes also refresh the browse view when `affectsBrowseListing(folder, currentPath)` says the change is visible there. That includes changes inside attachment folders, which the browse view renders inline.

## Revealing a Path

Several places ask the tree to show a path:

- The entry action bar's "Reveal in folder tree" button calls `revealInTree`. The button is hidden for attachments and when the tree is hidden.
- The breadcrumb's "Reveal in folder tree" button calls `setPendingIndexTreeReveal(currentPath)` after switching to the Browse tab.
- Right-clicking a bookmark in `BookmarksPopupMenu` calls `revealInTree`.
- At startup, a file named on the command line is opened in single-file mode and revealed with `setPendingIndexTreeReveal(file, true)`. The `true` also expands that file's node, as a click would.

`IndexTreeView` handles a reveal in an effect that waits until the tree for the current `rootPath` has loaded (`treeReady`). It then:

1. Clears the pending reveal and bumps `revealTokenRef`, so an older reveal still awaiting a directory read gives up instead of expanding and scrolling after a newer one has started.
2. Walks from the root down to the target, reading and expanding each ancestor directory that isn't loaded and expanded yet (via `mergeTreeNodes`). When a path segment is an `.attach` folder, it expands the owning file first, since that is where the folder lives in the tree.
3. Expands the target itself if it is a folder, or if it is a file and `pendingIndexTreeRevealExpandsFile` was set.
4. Sets `revealScrollTarget`. A `useLayoutEffect` keyed on `treeRoot` finds the row by its `data-tree-path` attribute on the first commit that renders it, and calls `scrollIntoView({ block: 'center' })` before paint.

Paths outside `rootPath` are ignored.

## Rendering

`flattenVisible(nodes, cutPaths, foldersOnTop)` in `IndexTreeView.tsx` produces the flat ordered list of `{ node, depth }` pairs that the component renders. It recurses into any node where `node.isExpanded && node.children`, and skips cut nodes (and therefore their subtrees). Siblings keep their existing order when any of them has an `indexOrder` (Document Mode). Otherwise they are sorted alphabetically (case-insensitive), with folders first when `settings.foldersOnTop` is on. The builders never sort; ordering happens only here, at render time.

Each visible row is a memo()'d `TreeFileRow`, indented 20px per depth level. Each row selects its own "is highlighted" and "relation to `currentPath`" values from the store, so only the rows whose answer changes re-render when the highlight moves or the browse view navigates.

- **Directory**: amber folder icon (open or closed) and amber text.
- **Attachment folder under its file**: labelled `*.attach` (the node keeps its real name and path), italic and dimmed.
- **File**: a `FileTypeIcon`, plus a paperclip icon after the name when the file owns an attachment folder. `.sh` files have green text.
- **Browsed folder and its ancestors**: a translucent purple background on the name. The browsed folder itself also gets a gray border.
- **Highlighted item** (`highlightItem`, file or folder): white text and a purple border on the name.
- **Context-menu target**: a blue row background while its menu is open.
- **Running script**: a 3-second green fade (`scriptRunFlash` keyframes in `src/index.css`).
- **Drag-over folder**: the shared `ENTRY_DROP_TARGET` highlight, which replaces the row's normal colors.

Each row's icon is a drag handle (`makeEntryDragStartHandler`). Only directory rows accept drops: `handleDropOnFolder` checks the payload with `canDropInto` and hands the move to the shared `completeEntryDrop`.

While `indexTreeRoot` has no children loaded yet, the panel shows a "Loading…" placeholder.

## Toolbar and Width

The header row has:

- **Bookmarks menu** (`BookmarksPopupMenu`): clicking a bookmark opens a file in single-file browsing or browses to a folder, and right-clicking one reveals it in the tree.
- **Collapse All**: calls `collapseAllIndexTreeNodes`. It is disabled when no top-level node is expanded.
- **Narrow tree / Widen tree**: step `settings.indexTreeWidth` through `narrow` (¼ of the window), `medium` (⅓) and `wide` (½), and persist it with `saveSettings()`. Each button is hidden at its end of the range.

The same width can be picked in Settings, which offers narrow, medium and wide. `'hidden'` is a valid `IndexTreeWidth` value (the config schema accepts it, and `App.tsx`, the breadcrumb and the entry action bar honor it), but no current UI sets it. It can only come from the config file.

## Context Menu

`handleFileNodeContextMenu` builds the item callbacks, and `IndexTreeContextMenu` (`src/components/menus/`) renders only the items whose callbacks are provided:

| Item | Shown for | Behavior |
|---|---|---|
| Browse | all | A folder: browse to it. A file: browse to its parent folder, highlighted and scrolled to. Always lands in a folder listing, so it also exits single-file mode |
| Run | `.sh` files | `api.runShellScript`, with the row's green flash. Ignored while another script's flash is running |
| New File | folders | In a Document Mode folder (one with an `.INDEX.yaml`), immediately creates a timestamp-named file at ordinal 0. Otherwise navigates to the folder and shows `CreateFileDialog`. Both use `createFileOp`, which opens the new file for editing |
| New Folder | folders | `CreateFolderDialog`, then `api.createFolder` and index reconciliation |
| Rename | all | `RenameDialog`. When a file rename would drop its `--ID` suffix (`idSuffixLost`), a "Remove Link ID?" confirmation comes first. `renameItem` re-keys the store and remaps bookmarks and other stored paths |
| Delete | all | `ConfirmDialog`, then `api.deleteFile`, `deleteItems`, and index reconciliation |
| Cut | all | `handleCutNode`, described below |
| Paste into Folder | folders, when something is cut | `pasteCutItems` inside `runCutPasteExclusive`, described below |
| Copy Path | all | Copies the node's absolute path to the clipboard |

The editor's "Paste Link" turns a copied path into a relative link. When the target file has no id yet, it first asks whether to add one (`AddLinkIdDialog`). A Markdown file gets a front-matter `id`, and any other file is renamed to carry an `--ID` suffix. Folders always get a plain link.

**Cut** takes the item from its parent's fresh directory listing rather than building it from the tree node. This is because the store entry needs the file's real timestamps, and the node's folder may never have been browsed. If the file has an attachment folder that a cut would leave behind, the user confirms first. The tree has no multi-select, so `cutSingleItem` always starts a fresh single-item cut. Cut nodes disappear from the tree because `flattenVisible` skips them. The component subscribes to the set of cut paths (`getCutPaths`), not just a boolean, so swapping one cut for another updates the tree.

**Paste into Folder** moves all cut items by rename, and is exclusive with every other cut/paste in the app. The move is not atomic: only the paths that actually moved (`movedPaths`) are removed from the store and reconciled with `.INDEX.yaml` in both the source and destination folders. Cut items are cleared only when every move succeeded, and any failure is reported with `setAppError`.
