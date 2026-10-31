import type { AppState, FileNode } from '../shared/types';
import { getState } from './core';
import type { StoreSet, StoreGet } from './core';
import { withHistoryPush } from './history';

// ============================================================================
// IndexTree - the hierarchical .INDEX.yaml navigation tree
// ============================================================================

/**
 * Recursively find and update a single node by its `path` key, returning a new
 * tree. Subtrees that don't contain the target keep their identity.
 */
function updateNodeByPath(
  node: FileNode,
  targetPath: string,
  updater: (n: FileNode) => FileNode
): FileNode {
  if (node.path === targetPath) return updater(node);
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
 * Collapse `node` and every node beneath it — files too, so an expanded file's
 * attachment folder (a child of the file) folds away. Nodes that are already
 * fully collapsed keep their identity, so the memoized tree rows for them (and
 * the store write itself, when nothing was expanded) are skipped.
 */
function collapseAllNodes(node: FileNode): FileNode {
  const collapsedChildren = collapseAllChildren(node.children);
  if (!node.isExpanded && collapsedChildren === node.children) return node;
  return { ...node, isExpanded: false, children: collapsedChildren };
}

/** collapseAllNodes over a child list, returning the same array when nothing changed. */
function collapseAllChildren(children: FileNode[] | null): FileNode[] | null {
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
  expandIndexTreeNode: (path: string, children: FileNode[]) => void;
  collapseAllIndexTreeNodes: () => void;
  collapseIndexTreeNode: (path: string) => void;
  setPendingIndexTreeReveal: (path: string, expandFile?: boolean) => void;
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
     * Set a node's children and mark it as expanded. Used for both directory
     * nodes (their listing) and file nodes (their attachment folder, if any).
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

    /** Collapse a node (file or directory) without clearing its cached children. */
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

    /**
     * Signal IndexTree to expand to the given path and scroll it into view. With
     * `expandFile`, a file target's own node is expanded too (see
     * pendingIndexTreeRevealExpandsFile).
     */
    setPendingIndexTreeReveal: (path, expandFile = false) => set({
      pendingIndexTreeReveal: path,
      pendingIndexTreeRevealExpandsFile: expandFile,
    }),

    /**
     * Reveal `path` in the index tree from an entry's action bar, in a single
     * state update: highlight the item, switch to the browser view (where the
     * tree lives), and queue the reveal for IndexTree to pick up.
     */
    revealInTree: (path) => set({
      highlightItem: path,
      currentView: 'browser',
      pendingIndexTreeReveal: path,
      pendingIndexTreeRevealExpandsFile: false,
      ...withHistoryPush(get(), path),
    }),

    /** Clear the pending reveal signal (called by IndexTree when it picks it up). */
    clearPendingIndexTreeReveal: () => {
      if (get().pendingIndexTreeReveal === null) return;
      set({ pendingIndexTreeReveal: null, pendingIndexTreeRevealExpandsFile: false });
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

export function expandIndexTreeNode(path: string, children: FileNode[]): void {
  getState().expandIndexTreeNode(path, children);
}

export function collapseAllIndexTreeNodes(): void {
  getState().collapseAllIndexTreeNodes();
}

export function collapseIndexTreeNode(path: string): void {
  getState().collapseIndexTreeNode(path);
}

export function setPendingIndexTreeReveal(path: string, expandFile?: boolean): void {
  getState().setPendingIndexTreeReveal(path, expandFile);
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
 *
 * See: (document_mode.md#overview)
 */
export function getHasIndexFile(): boolean {
  return getState().hasIndexFile;
}
