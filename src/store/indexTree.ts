import type { AppState, TreeNode, FileNode, MarkdownHeadingNode } from '../types/types';
import { getState, setState, useStoreValue } from './core';

// ============================================================================
// IndexTree - the hierarchical .INDEX.yaml navigation tree
// ============================================================================

// Internal union covering every node type that carries a path for store lookup.
type PathNode = FileNode | MarkdownHeadingNode;

/**
 * Recursively find and update a single node by path/key, returning a new tree root.
 * Works across mixed trees (FileNode children may include MarkdownHeadingNode).
 */
function updateNodeByPath(
  node: PathNode,
  targetPath: string,
  updater: (n: PathNode) => PathNode
): PathNode {
  if (node.path === targetPath) return updater(node);
  if (!node.children) return node;
  let changed = false;
  const newChildren = node.children.map(child => {
    if (!('path' in child)) return child;
    const updated = updateNodeByPath(child as PathNode, targetPath, updater);
    if (updated !== child) changed = true;
    return updated;
  }) as TreeNode[];
  return changed ? { ...node, children: newChildren } as PathNode : node;
}

/**
 * Replace the entire index tree root (used on initialization or rootPath change).
 */
export function setIndexTreeRoot(root: FileNode | null): void {
  setState({ indexTreeRoot: root });
}

/**
 * Mark a directory node as loading (spinner while re-reading its children).
 */
export function setIndexTreeNodeLoading(path: string, loading: boolean): void {
  const root = getState().indexTreeRoot;
  if (!root) return;
  const newRoot = updateNodeByPath(root, path, n => ({ ...n, isLoading: loading })) as FileNode;
  if (newRoot === root) return;
  setState({ indexTreeRoot: newRoot });
}

/**
 * Set a node's children and mark it as expanded.
 * Used for both directory nodes (children: FileNode[]) and markdown file nodes (children: MarkdownHeadingNode[]).
 */
export function expandIndexTreeNode(path: string, children: TreeNode[]): void {
  const root = getState().indexTreeRoot;
  if (!root) return;

  const newRoot = updateNodeByPath(root, path, n => ({
    ...n,
    isExpanded: true,
    isLoading: false,
    children,
  } as PathNode)) as FileNode;
  if (newRoot === root) return;
  setState({ indexTreeRoot: newRoot });
}

function collapseAllNodes(node: TreeNode): TreeNode {
  if (!('isDirectory' in node) || !(node as FileNode).isDirectory) return node;
  const collapsedChildren = node.children
    ? node.children.map(collapseAllNodes)
    : node.children;
  return { ...node, isExpanded: false, children: collapsedChildren };
}

/**
 * Collapse all expanded directory nodes in the tree (preserves root expansion).
 */
export function collapseAllIndexTreeNodes(): void {
  const root = getState().indexTreeRoot;
  if (!root) return;
  const newChildren = root.children
    ? root.children.map(collapseAllNodes)
    : root.children;
  setState({ indexTreeRoot: { ...root, children: newChildren } });
}

/**
 * Collapse a node (directory or heading) without clearing its cached children.
 */
export function collapseIndexTreeNode(path: string): void {
  const root = getState().indexTreeRoot;
  if (!root) return;
  const newRoot = updateNodeByPath(root, path, n => ({
    ...n,
    isExpanded: false,
  })) as FileNode;
  if (newRoot === root) return;
  setState({ indexTreeRoot: newRoot });
}

/**
 * Hook to subscribe to the IndexTree root node.
 */
export function useIndexTreeRoot(): FileNode | null {
  return useStoreValue(s => s.indexTreeRoot);
}

/**
 * Get the current IndexTree root node without subscribing (for use in async callbacks).
 */
export function getIndexTreeRoot(): FileNode | null {
  return getState().indexTreeRoot;
}

/**
 * Signal IndexTree to expand to the given path and scroll it into view.
 */
export function setPendingIndexTreeReveal(path: string): void {
  setState({ pendingIndexTreeReveal: path });
}

/**
 * Clear the pending reveal signal (called by IndexTree when it picks it up).
 */
export function clearPendingIndexTreeReveal(): void {
  if (getState().pendingIndexTreeReveal === null) return;
  setState({ pendingIndexTreeReveal: null });
}

/**
 * Hook to subscribe to the pending IndexTree reveal path.
 */
export function usePendingIndexTreeReveal(): string | null {
  return useStoreValue(s => s.pendingIndexTreeReveal);
}

/**
 * Set whether the current directory contains a .INDEX.yaml file.
 */
export function setHasIndexFile(hasIndexFile: boolean): void {
  setState({ hasIndexFile });
}

/**
 * Hook to subscribe to hasIndexFile
 */
export function useHasIndexFile(): boolean {
  return useStoreValue(s => s.hasIndexFile);
}

/**
 * Set the parsed .INDEX.yaml for the current directory.
 */
export function setIndexYaml(indexYaml: AppState['indexYaml']): void {
  setState({ indexYaml });
}

/**
 * Hook to subscribe to the current directory's parsed .INDEX.yaml
 */
export function useIndexYaml(): AppState['indexYaml'] {
  return useStoreValue(s => s.indexYaml);
}
