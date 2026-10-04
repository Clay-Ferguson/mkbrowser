import type { AppState, TreeNode, FileNode, MarkdownHeadingNode } from '../shared/types';
import { ATTACH_SUFFIX } from '../shared/specialFiles';
import { extractHeadingTree } from '../shared/tocUtil';
import { ensureTrailingSep } from '../renderer/pathUtil';
import { getState } from './core';
import type { StoreSet, StoreGet } from './core';
import { withHistoryPush } from './history';

// ============================================================================
// IndexTree - the hierarchical .INDEX.yaml navigation tree
// ============================================================================

/**
 * Recursively find and update a single node by its `path` key, returning a new
 * tree. Works across mixed trees (FileNode children may include
 * MarkdownHeadingNode) since every TreeNode carries a `path`. The generic return
 * type preserves the concrete root type for callers; `updater` is typed against the
 * base TreeNode (the only fields these updaters touch), and its result is asserted
 * back to T because it spreads the matched node and so keeps all of T's fields.
 */
function updateNodeByPath<T extends TreeNode>(
  node: T,
  targetPath: string,
  updater: (n: TreeNode) => TreeNode
): T {
  if (node.path === targetPath) return updater(node) as T;
  if (!node.children) return node;
  let changed = false as boolean;
  const newChildren = node.children.map(child => {
    const updated = updateNodeByPath(child, targetPath, updater);
    if (updated !== child) changed = true;
    return updated;
  });
  return changed ? { ...node, children: newChildren } : node;
}

/**
 * Whether the file/folder at `target` can be `node` itself or lie somewhere beneath it.
 * A file node's only file/folder descendants are inside its attachment folder, which
 * the tree nests under the file; heading nodes never contain one.
 */
function mayContain(node: TreeNode, target: string): boolean {
  if (node.path === target) return true;
  if (!('isDirectory' in node)) return false;
  const base = (node as FileNode).isDirectory ? node.path : `${node.path}${ATTACH_SUFFIX}`;
  return target.startsWith(ensureTrailingSep(base));
}

/**
 * Like updateNodeByPath, but for a file/folder `targetPath` only, descending just the
 * one branch that can hold it rather than the whole loaded tree — cheap enough to run
 * on every content update. Returns `node` itself when the target isn't loaded.
 */
function updateFileNodeByPath(node: FileNode, targetPath: string, updater: (n: FileNode) => FileNode): FileNode {
  if (node.path === targetPath) return updater(node);
  if (!node.children || !mayContain(node, targetPath)) return node;
  const idx = node.children.findIndex(c => mayContain(c, targetPath));
  if (idx < 0) return node;
  const child = node.children[idx] as FileNode;
  const updated = updateFileNodeByPath(child, targetPath, updater);
  if (updated === child) return node;
  const children = [...node.children];
  children[idx] = updated;
  return { ...node, children };
}

/**
 * Merges freshly extracted headings into the previous ones: a heading still at the same
 * position with the same text keeps its expansion state, and a whole subtree that is
 * unchanged keeps its identity (so its memo()'d rows skip re-rendering). Returns `old`
 * itself when nothing changed.
 */
function mergeHeadings(fresh: MarkdownHeadingNode[], old: MarkdownHeadingNode[]): MarkdownHeadingNode[] {
  const oldByPath = new Map(old.map(h => [h.path, h]));
  const merged = fresh.map(h => {
    const prev = oldByPath.get(h.path);
    if (!prev || prev.heading !== h.heading || prev.slug !== h.slug || prev.depth !== h.depth) return h;
    const children = h.children && prev.children ? mergeHeadings(h.children, prev.children) : h.children;
    if (children === prev.children) return prev;
    return { ...h, isExpanded: prev.isExpanded, children };
  });
  return merged.length === old.length && merged.every((h, i) => h === old[i]) ? old : merged;
}

/**
 * Returns `root` with the heading children of the markdown file at `filePath` rebuilt
 * from `content` — the file's new text, so no disk read is needed. Applied by
 * setItemContent, which every save and reload passes through, so an expanded file's
 * headings in the tree always match what was last saved. The file's attachment-folder
 * child, heading expansion states and unchanged subtrees are kept. A file whose
 * children were never loaded is left alone (its first expand reads the file), and
 * `root` itself is returned when nothing changed.
 */
export function withFileHeadings(root: FileNode | null, filePath: string, content: string): FileNode | null {
  if (!root || !filePath.toLowerCase().endsWith('.md')) return root;
  return updateFileNodeByPath(root, filePath, (node) => {
    if (node.isDirectory || !node.children) return node;
    const oldHeadings = node.children.filter((c): c is MarkdownHeadingNode => 'heading' in c);
    const headings = mergeHeadings(extractHeadingTree(filePath, content), oldHeadings);
    // Headings unchanged: keep the node (and skip the store write).
    if (headings === oldHeadings) return node;
    const others = node.children.filter(c => !('heading' in c));
    return { ...node, children: [...others, ...headings] };
  });
}

/**
 * Collapse `node` and every file/folder node beneath it — files too, so an
 * expanded file's headings and its attachment folder (a child of the file) fold
 * away. Heading nodes are left as they are. Nodes that are already fully
 * collapsed keep their identity, so the memoized tree rows for them (and the
 * store write itself, when nothing was expanded) are skipped.
 */
function collapseAllNodes(node: TreeNode): TreeNode {
  if (!('isDirectory' in node)) return node;
  const collapsedChildren = collapseAllChildren(node.children);
  if (!node.isExpanded && collapsedChildren === node.children) return node;
  return { ...node, isExpanded: false, children: collapsedChildren };
}

/** collapseAllNodes over a child list, returning the same array when nothing changed. */
function collapseAllChildren(children: TreeNode[] | null): TreeNode[] | null {
  if (!children) return children;
  const collapsed = children.map(collapseAllNodes);
  return collapsed.some((c, i) => c !== children[i]) ? collapsed : children;
}

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts`.
 */
export interface IndexTreeSlice {
  setIndexTreeRoot: (root: FileNode | null) => void;
  setIndexTreeNodeLoading: (path: string, loading: boolean) => void;
  expandIndexTreeNode: (path: string, children: TreeNode[]) => void;
  collapseAllIndexTreeNodes: () => void;
  collapseIndexTreeNode: (path: string) => void;
  setPendingIndexTreeReveal: (path: string) => void;
  revealInTree: (path: string) => void;
  clearPendingIndexTreeReveal: () => void;
  setIndexYaml: (indexYaml: AppState['indexYaml']) => void;
}

/**
 * Slice creator called by `core.ts` inside `create()`. A function declaration
 * (not a `const`) so it is hoisted and safe under the core ↔ slice import
 * cycle regardless of module load order.
 */
export function createIndexTreeSlice(set: StoreSet, get: StoreGet): IndexTreeSlice {
  return {
    /** Replace the entire index tree root (used on initialization or rootPath change). */
    setIndexTreeRoot: (root) => set({ indexTreeRoot: root }),

    /** Mark a directory node as loading (spinner while re-reading its children). */
    setIndexTreeNodeLoading: (path, loading) => {
      const root = get().indexTreeRoot;
      if (!root) return;
      const newRoot = updateNodeByPath(root, path, n => ({ ...n, isLoading: loading }));
      if (newRoot === root) return;
      set({ indexTreeRoot: newRoot });
    },

    /**
     * Set a node's children and mark it as expanded.
     * Used for both directory nodes (children: FileNode[]) and markdown file
     * nodes (children: MarkdownHeadingNode[]).
     */
    expandIndexTreeNode: (path, children) => {
      const root = get().indexTreeRoot;
      if (!root) return;

      const newRoot = updateNodeByPath(root, path, n => ({
        ...n,
        isExpanded: true,
        isLoading: false,
        children,
      }));
      if (newRoot === root) return;
      set({ indexTreeRoot: newRoot });
    },

    /** Collapse all expanded file and directory nodes in the tree (preserves root expansion). */
    collapseAllIndexTreeNodes: () => {
      const root = get().indexTreeRoot;
      if (!root) return;
      const newChildren = collapseAllChildren(root.children);
      if (newChildren === root.children) return;
      set({ indexTreeRoot: { ...root, children: newChildren } });
    },

    /** Collapse a node (directory or heading) without clearing its cached children. */
    collapseIndexTreeNode: (path) => {
      const root = get().indexTreeRoot;
      if (!root) return;
      const newRoot = updateNodeByPath(root, path, n => ({
        ...n,
        isExpanded: false,
      }));
      if (newRoot === root) return;
      set({ indexTreeRoot: newRoot });
    },

    /** Signal IndexTree to expand to the given path and scroll it into view. */
    setPendingIndexTreeReveal: (path) => set({ pendingIndexTreeReveal: path }),

    /**
     * Reveal `path` in the index tree from an entry's action bar, in a single
     * state update: highlight the item, switch to the browser view (where the
     * tree lives), and queue the reveal for IndexTree to pick up.
     */
    revealInTree: (path) => set({
      highlightItem: path,
      currentView: 'browser',
      pendingIndexTreeReveal: path,
      ...withHistoryPush(get(), path),
    }),

    /** Clear the pending reveal signal (called by IndexTree when it picks it up). */
    clearPendingIndexTreeReveal: () => {
      if (get().pendingIndexTreeReveal === null) return;
      set({ pendingIndexTreeReveal: null });
    },

    /** Set the parsed .INDEX.yaml for the current directory. */
    setIndexYaml: (indexYaml) => {
      if (get().indexYaml === indexYaml) return;
      set({ indexYaml });
    },
  };
}

// Thin non-hook wrappers so the barrel API (and every caller) is unchanged;
// they delegate to the actions living inside the store.

export function setIndexTreeRoot(root: FileNode | null): void {
  getState().setIndexTreeRoot(root);
}

export function setIndexTreeNodeLoading(path: string, loading: boolean): void {
  getState().setIndexTreeNodeLoading(path, loading);
}

export function expandIndexTreeNode(path: string, children: TreeNode[]): void {
  getState().expandIndexTreeNode(path, children);
}

export function collapseAllIndexTreeNodes(): void {
  getState().collapseAllIndexTreeNodes();
}

export function collapseIndexTreeNode(path: string): void {
  getState().collapseIndexTreeNode(path);
}

export function setPendingIndexTreeReveal(path: string): void {
  getState().setPendingIndexTreeReveal(path);
}

export function revealInTree(path: string): void {
  getState().revealInTree(path);
}

export function clearPendingIndexTreeReveal(): void {
  getState().clearPendingIndexTreeReveal();
}

export function setIndexYaml(indexYaml: AppState['indexYaml']): void {
  getState().setIndexYaml(indexYaml);
}

/**
 * Get the current IndexTree root node without subscribing (for use in async callbacks).
 */
export function getIndexTreeRoot(): FileNode | null {
  return getState().indexTreeRoot;
}

/**
 * Whether the folder currently being browsed has an .INDEX.yaml (Document Mode),
 * read without subscribing (for use in async callbacks).
 */
export function getHasIndexFile(): boolean {
  return getState().hasIndexFile;
}
