# Index Tree Application Panel

The component named `IndexTree.tsx` is the tree view panel on the left side of the main application window. It displays the file system hierarchy and, for markdown files, the internal heading structure. Folders and markdown files can be expanded and collapsed. Right-clicking any node navigates the main browser view to that file or folder.

## Node Type Hierarchy

All nodes in the tree implement the base interface `TreeNode` (defined in `store/types.ts`). It holds only the generic expansion/loading state and the children list:

```ts
interface TreeNode {
  isExpanded: boolean;
  isLoading: boolean;
  children: TreeNode[] | null;  // null = never loaded
}
```

`children: null` means the node has never been expanded and its contents are unknown. An empty array `[]` means it was expanded and genuinely has no children.

### FileNode

```ts
interface FileNode extends TreeNode {
  path: string;       // absolute filesystem path
  name: string;       // display name (basename)
  isDirectory: boolean;
  children: TreeNode[] | null;
}
```

Used for every file and folder entry in the tree. The `path` field is the real filesystem path and also serves as the key used by store functions (`updateNodeByPath`) to locate and update a specific node. When a `FileNode` with `isDirectory: true` is expanded, its `children` are populated with more `FileNode` objects via `window.electronAPI.readDirectory`.

### MarkdownFileNode

```ts
interface MarkdownFileNode extends FileNode {
  isDirectory: false;
}
```

Structurally identical to `FileNode` — the distinction is semantic and acts as a TypeScript discriminator. At runtime, a node is treated as a markdown file if `!node.isDirectory && node.name.toLowerCase().endsWith('.md')` (see `isMarkdownFile()` in `IndexTree.tsx`). When a `MarkdownFileNode` is expanded, its `children` are `MarkdownHeadingNode[]` rather than `FileNode[]`.

### MarkdownHeadingNode

```ts
interface MarkdownHeadingNode extends TreeNode {
  path: string;    // synthetic key: filePath + '#' + flatIndex
  heading: string; // raw text of the heading
  depth: number;   // 1 = H1, 2 = H2, …
  children: MarkdownHeadingNode[] | null;
}
```

Represents one markdown heading inside an expanded markdown file. The tree is hierarchical — H2s are children of their nearest preceding H1, H3s are children of their nearest H2, and so on. The `path` field is a synthetic key of the form `"/abs/path/to/file.md#3"` (file path plus a `#`-prefixed flat index). This synthetic key allows the same store machinery (`updateNodeByPath`, `collapseIndexTreeNode`, `expandIndexTreeNode`) that handles filesystem nodes to locate and update heading nodes without any special casing.

`children: null` means the heading has no sub-headings. `children: []` never occurs — the heading tree is built all at once from a single parse pass and heading nodes are given `null` (not `[]`) when they have no children, so the UI never shows an expand affordance for them.

## Store Integration

The tree root is stored as `FileNode | null` under `AppState.indexTreeRoot`. The relevant store functions are all in `store/store.ts` and exported via `store/index.ts`:

| Function | Purpose |
|---|---|
| `setIndexTreeRoot(root)` | Replace the entire tree (called when `rootPath` changes) |
| `expandIndexTreeNode(path, children)` | Set a node's children and mark it expanded; accepts `TreeNode[]` so it works for both `FileNode[]` and `MarkdownHeadingNode[]` |
| `collapseIndexTreeNode(path)` | Mark a node collapsed without clearing its children; works for both filesystem and heading nodes |
| `setIndexTreeNodeLoading(path, loading)` | Toggle the loading spinner on a node |
| `collapseAllIndexTreeNodes()` | Recursively collapse all directory nodes; leaves markdown heading state intact |
| `useIndexTreeRoot()` | React hook — subscribes to the tree root |
| `getIndexTreeRoot()` | Non-hook snapshot — used inside async callbacks |

The internal `updateNodeByPath(node, targetPath, updater)` function traverses the tree and applies `updater` to the node whose `path` matches `targetPath`. It operates on the internal union type `PathNode = FileNode | MarkdownHeadingNode` and skips children that carry no `path` property, so it handles the mixed-type tree transparently.

## Lazy Loading

The tree uses lazy loading throughout:

- **Directories**: children are `null` until first expansion. On expand, `window.electronAPI.readDirectory(path)` is called and the results are converted to `FileNode[]` via `makeNodes()` in `IndexTree.tsx`.
- **Markdown files**: heading children are `null` until first expansion. On expand, `window.electronAPI.readFile(path)` reads the file content, then `extractHeadingTree(filePath, content)` (from `utils/tocUtils.ts`) parses the AST with `unified`+`remarkParse`, extracts all `heading` nodes, and assembles the full heading hierarchy in one pass. The full tree is stored immediately — sub-headings start with `isExpanded: false` but their children arrays are pre-populated.
- **Heading nodes**: no async loading. Expanding a heading just sets `isExpanded: true` via `expandIndexTreeNode`, revealing pre-populated children.

## Heading Tree Assembly

`extractHeadingTree(filePath, content)` in `utils/tocUtils.ts` builds the heading hierarchy using a depth-based stack algorithm:

1. Parse the markdown AST with `unified().use(remarkParse).parse(content)`.
2. Filter for nodes with `type === 'heading'`, collecting them in document order.
3. Assign each a synthetic `path` key (`filePath + '#' + flatIndex`).
4. Walk the flat list with a stack. For each heading, pop the stack until the top has a lower `depth` than the current heading, then attach the current heading as a child of the new stack top (or as a root if the stack is empty). Push the heading onto the stack.

The result is a `MarkdownHeadingNode[]` of top-level headings, each with their sub-headings recursively nested.

## Runtime Type Guards

`IndexTree.tsx` uses three helper functions to discriminate node types at runtime:

```ts
function isFileNode(node: TreeNode): node is FileNode
  → 'isDirectory' in node

function isMarkdownHeadingNode(node: TreeNode): node is MarkdownHeadingNode
  → 'heading' in node

function isMarkdownFile(node: FileNode): node is MarkdownFileNode
  → !node.isDirectory && node.name.toLowerCase().endsWith('.md')
```

## Rendering

`flattenVisible(nodes, depth)` in `IndexTree.tsx` produces the flat ordered list of `{ node, depth }` pairs that the component renders. It recurses into any node where `node.isExpanded && node.children` — not just directories — so heading nodes participate in the same rendering pass as file and folder nodes.

Each row's appearance depends on its node type:
- **Directory (`FileNode` with `isDirectory: true`)**: yellow expand icon (`▶`/`▼`/`⋯`), highlighted when it is or contains `currentPath`.
- **Markdown file (`MarkdownFileNode`)**: sky-blue expand icon, clickable to load and expand headings.
- **Heading (`MarkdownHeadingNode`)**: no icon if it has no children (`·`), otherwise `▶`/`▼`; heading text rendered in italic. Headings with `children: null` are not clickable.
- **Plain file**: grey dot (`●`), not clickable.
