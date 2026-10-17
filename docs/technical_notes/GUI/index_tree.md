# Index Tree Application Panel

The component `IndexTreeView.tsx` (`src/components/views/`) is the tree view panel on the left side of the main application window. It displays the file system hierarchy: only files and folders. Folders can be expanded and collapsed, and so can a file that owns an attachment folder (`<name>.attach`), which is shown as that file's child. Clicking a file opens it on its own in the browse view; right-clicking any node opens a context menu (Browse, Rename, Delete, Cut, Paste, Paste Link into Editor, Copy Path, …). "Copy Path" copies the node's absolute path, which the editor's "Paste Link" turns into a relative link (asking first whether to add a front-matter id to an id-less Markdown target) — the intended replacement for "Paste Link into Editor".

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

`children: null` means the node has never been expanded and its contents are unknown. An empty array `[]` means it was expanded and genuinely has no children. A directory's children are its listing; a file's only possible child is its attachment folder (see `makeFileChildren` in `src/renderer/treeNodes.ts` and `docs/technical_notes/features/file_attachments.md`).

## Store Integration

The tree root is stored as `FileNode | null` under `AppState.indexTreeRoot`. The relevant actions live in `src/store/indexTree.ts` and are exported via the `src/store/index.ts` barrel:

| Function | Purpose |
|---|---|
| `setIndexTreeRoot(root)` | Replace the entire tree (called when `rootPath` changes) |
| `expandIndexTreeNode(path, children)` | Set a node's children and mark it expanded |
| `collapseIndexTreeNode(path)` | Mark a node collapsed without clearing its children |
| `setIndexTreeNodeLoading(path, loading)` | Toggle the loading state on a node |
| `collapseAllIndexTreeNodes()` | Recursively collapse every node (files included) below the root |
| `getIndexTreeRoot()` | Non-hook snapshot, used inside async callbacks |

Components subscribe with a direct selector: `useAS(s => s.indexTreeRoot)`.

The internal `updateNodeByPath(node, targetPath, updater)` function traverses the tree and applies `updater` to the node whose `path` matches `targetPath`, keeping the identity of every subtree that doesn't contain it (so the memo()'d rows for those skip re-rendering).

## Lazy Loading

The tree uses lazy loading throughout. All child lists are built by the helpers in `src/renderer/treeNodes.ts` (`makeTreeNodes`, `mergeTreeNodes`, `makeFileChildren`, `expandFileNode`, `refreshExpandedNodes`):

- **Directories**: children are `null` until first expansion. On expand, `api.readDirectory(path)` is called and the results are converted to `FileNode[]`, merged with any previously loaded children so expansion state underneath survives.
- **Files**: `expandFileNode` builds the children without any I/O: the attachment-folder node when the file has one, otherwise an empty list.

## Rendering

`flattenVisible(nodes, cutPaths, foldersOnTop)` in `IndexTreeView.tsx` produces the flat ordered list of `{ node, depth }` pairs that the component renders. It recurses into any node where `node.isExpanded && node.children`, skips cut nodes, keeps Document Mode (index-ordered) siblings in their existing order, and sorts everything else alphabetically (optionally folders first).

Each visible row is a memo()'d `TreeFileRow`:
- **Directory**: amber folder icon (open/closed), purple background when it is or contains `currentPath`.
- **Attachment folder under its file**: labelled `*.attach`, italic and dimmed.
- **File**: file-type icon; a paperclip marks a file that owns an attachment folder.
