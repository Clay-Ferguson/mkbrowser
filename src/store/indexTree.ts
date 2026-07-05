import type { AppState, TreeNode, FileNode } from '../shared/types';
import { getState } from './core';
import type { StoreSet, StoreGet } from './core';

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

function collapseAllNodes(node: TreeNode): TreeNode {
  if (!('isDirectory' in node) || !(node as FileNode).isDirectory) return node;
  const collapsedChildren = node.children
    ? node.children.map(collapseAllNodes)
    : node.children;
  return { ...node, isExpanded: false, children: collapsedChildren };
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
  clearPendingIndexTreeReveal: () => void;
  setHasIndexFile: (hasIndexFile: boolean) => void;
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

    /** Collapse all expanded directory nodes in the tree (preserves root expansion). */
    collapseAllIndexTreeNodes: () => {
      const root = get().indexTreeRoot;
      if (!root) return;
      const newChildren = root.children
        ? root.children.map(collapseAllNodes)
        : root.children;
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

    /** Clear the pending reveal signal (called by IndexTree when it picks it up). */
    clearPendingIndexTreeReveal: () => {
      if (get().pendingIndexTreeReveal === null) return;
      set({ pendingIndexTreeReveal: null });
    },

    /** Set whether the current directory contains a .INDEX.yaml file. */
    setHasIndexFile: (hasIndexFile) => set({ hasIndexFile }),

    /** Set the parsed .INDEX.yaml for the current directory. */
    setIndexYaml: (indexYaml) => set({ indexYaml }),
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

export function clearPendingIndexTreeReveal(): void {
  getState().clearPendingIndexTreeReveal();
}

export function setHasIndexFile(hasIndexFile: boolean): void {
  getState().setHasIndexFile(hasIndexFile);
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
