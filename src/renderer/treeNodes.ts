import { api } from './api';
import type { FileNode, TreeNode } from '../shared/types';
import { getIndexTreeRoot, expandIndexTreeNode } from '../store';
import { ATTACH_SUFFIX } from '../shared/specialFiles';
import { logger } from '../shared/logUtil';

// ============================================================================
// IndexTreeView node builders — the one place tree children are built from a
// directory listing (shared by lazy expand, drag-and-drop, cut/paste, and the
// full refresh in directoryLoader).
// ============================================================================

/**
 * Whether a directory entry may appear in the IndexTreeView at all. Attachment
 * (*.attach) folders never show there. Local by design: `makeTreeNodes` is the
 * only way tree children are built, so every caller gets this filter for free
 * and no other module needs to remember to apply it.
 */
function isTreeVisibleEntry(entry: { name: string; isDirectory: boolean }): boolean {
  return !(entry.isDirectory && entry.name.endsWith(ATTACH_SUFFIX));
}

/**
 * Builds the IndexTreeView's lazily-loaded child nodes from a directory listing, omitting
 * Attachment (*.attach) folders, which are never shown in the tree.
 */
export function makeTreeNodes(
  entries: Array<{ path: string; name: string; isDirectory: boolean; indexOrder?: number }>
): FileNode[] {
  return entries.filter(isTreeVisibleEntry).map(e => ({
    path: e.path,
    name: e.name,
    isDirectory: e.isDirectory,
    isExpanded: false,
    isLoading: false,
    children: null,
    ...(e.indexOrder !== undefined ? { indexOrder: e.indexOrder } : {}),
  }));
}

/**
 * Rebuilds a folder node's children from a fresh directory listing while carrying over
 * the expansion state (and already-loaded children) of every node that survived the
 * refresh, matched by path. Without this, re-reading a folder would hand back all-new
 * `makeTreeNodes` nodes — collapsed, children null — and silently tear down whatever the
 * user had opened underneath it (issue: paste into a tree folder collapsed the tree).
 *
 * Entries that are new on disk come in collapsed; nodes that disappeared are dropped.
 * `indexOrder` always comes from the fresh listing, since that is what just changed.
 *
 * @param entries - The directory listing to rebuild from.
 * @param previousChildren - The node's current children, or null if it had none loaded.
 */
export function mergeTreeNodes(
  entries: Array<{ path: string; name: string; isDirectory: boolean; indexOrder?: number }>,
  previousChildren: TreeNode[] | null | undefined
): FileNode[] {
  const fresh = makeTreeNodes(entries);
  if (!previousChildren || previousChildren.length === 0) return fresh;

  // Heading nodes (no isDirectory) can't match a directory entry, so they never
  // participate in the merge.
  const oldByPath = new Map<string, FileNode>();
  for (const child of previousChildren) {
    if ('isDirectory' in child) oldByPath.set(child.path, child as FileNode);
  }

  return fresh.map(node => {
    const existing = oldByPath.get(node.path);
    // A path that changed kind (file <-> folder) must not inherit the old children.
    if (!existing || existing.isDirectory !== node.isDirectory) return node;
    return { ...node, isExpanded: existing.isExpanded, children: existing.children };
  });
}

/** Depth-first search for a directory/file node by absolute path within the tree. */
export function findTreeNodeByPath(root: FileNode, path: string): FileNode | null {
  if (root.path === path) return root;
  if (!root.children) return null;
  for (const child of root.children) {
    if (!('isDirectory' in child)) continue;
    const found = findTreeNodeByPath(child as FileNode, path);
    if (found) return found;
  }
  return null;
}

/**
 * Reloads a folder node's children from disk in the IndexTreeView, but only if that folder
 * is currently expanded. Collapsed folders need no update — their contents are loaded lazily
 * on next expand. Shared by both drag-and-drop directions and the cut/paste flow.
 *
 * @param folderPath - Absolute path of the folder to reload.
 */
export async function reloadExpandedTreeFolder(folderPath: string): Promise<void> {
  const root = getIndexTreeRoot();
  if (!root) return;
  const node = findTreeNodeByPath(root, folderPath);
  if (!node?.isExpanded) return;
  try {
    const entries = await api.readDirectory(folderPath);
    expandIndexTreeNode(folderPath, mergeTreeNodes(entries, node.children));
  } catch (err) {
    // Leave the tree as-is; a stale node is better than tearing down the expanded view.
    logger.error(`Failed to reload tree folder ${folderPath}:`, err);
  }
}

/**
 * Re-reads every expanded directory node in the tree from disk, returning a new
 * root. Child nodes come from `mergeTreeNodes`, the same builder the lazy expand
 * and `reloadExpandedTreeFolder` use, so all four refresh paths agree on which
 * entries a folder has (`.attach` folders filtered out), carry expansion state
 * over by path, and apply the same file <-> folder kind guard. Building children
 * by hand here instead is what let an attach folder reappear in the tree after a
 * rename, until the next refresh through a builder swept it back out.
 *
 * Recursion is the one thing this adds over `mergeTreeNodes`: each merged child
 * is refreshed too, so an expanded subtree is reloaded all the way down. Row
 * order is not decided here — `flattenVisible` in IndexTreeView orders rows at
 * render time, so builder order only survives for index-ordered (Document Mode)
 * siblings, which it passes through from the listing.
 */
export async function refreshExpandedNodes(node: FileNode): Promise<FileNode> {
  if (!node.isDirectory || !node.isExpanded) return node;
  try {
    const entries = await api.readDirectory(node.path);
    const children = await Promise.all(mergeTreeNodes(entries, node.children).map(refreshExpandedNodes));
    return { ...node, children, isLoading: false };
  } catch {
    return node;
  }
}
