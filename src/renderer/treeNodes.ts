import { api } from './api';
import type { FileNode, TreeNode } from '../shared/types';
import { getIndexTreeRoot, expandIndexTreeNode } from '../store';
import { ATTACH_SUFFIX } from '../shared/specialFiles';
import { extractHeadingTree } from '../shared/tocUtil';
import { logger } from '../shared/logUtil';

// ============================================================================
// IndexTreeView node builders — the one place tree children are built from a
// directory listing (shared by lazy expand, drag-and-drop, cut/paste, and the
// full refresh in directoryLoader).
// ============================================================================

/** A directory listing entry, as far as the tree builders need it. */
type TreeEntry = { path: string; name: string; isDirectory: boolean; indexOrder?: number; hasAttachFolder?: boolean };

/**
 * Builds the IndexTreeView's lazily-loaded child nodes from a directory listing. An
 * Attachment (*.attach) folder whose owning file is in the listing is omitted here — it
 * shows under that file instead (see makeFileChildren). An orphaned one (its file was
 * moved, deleted or never existed) stays as an ordinary folder, under its real name, so
 * it never vanishes from the tree. Local by design: this is the only way folder children
 * are built, so every caller gets the same membership rule.
 *
 * Which files own one comes straight from `hasAttachFolder`, which `readDirectory` already
 * computes in one pass over the listing; one Set of the owned folder names built from it
 * makes the filter O(n), with no lookup or I/O of the tree's own.
 */
export function makeTreeNodes(entries: TreeEntry[]): FileNode[] {
  const owned = new Set<string>();
  for (const e of entries) {
    if (!e.isDirectory && e.hasAttachFolder) owned.add(`${e.name}${ATTACH_SUFFIX}`);
  }
  return entries.filter(e => !(e.isDirectory && owned.has(e.name))).map(e => ({
    path: e.path,
    name: e.name,
    isDirectory: e.isDirectory,
    isExpanded: false,
    isLoading: false,
    children: null,
    ...(e.indexOrder !== undefined ? { indexOrder: e.indexOrder } : {}),
    ...(!e.isDirectory && e.hasAttachFolder ? { hasAttachFolder: true } : {}),
  }));
}

/**
 * The tree node for `file`'s attachment folder. It keeps the folder's real name and
 * path (drag, rename, cut and paste all need them); `isOwnedAttach` makes only the
 * row's label show `*.attach`.
 */
function makeAttachNode(file: FileNode): FileNode {
  return {
    path: `${file.path}${ATTACH_SUFFIX}`,
    name: `${file.name}${ATTACH_SUFFIX}`,
    isDirectory: true,
    isExpanded: false,
    isLoading: false,
    children: null,
    isOwnedAttach: true,
  };
}

/**
 * The children of an expanded file node: its attachment folder (when it has one)
 * first, then `headings` (a markdown file's heading tree; empty for other files).
 * The one place a file's child list is assembled.
 */
export function makeFileChildren(file: FileNode, headings: TreeNode[]): TreeNode[] {
  return file.hasAttachFolder ? [makeAttachNode(file), ...headings] : headings;
}

/**
 * Re-syncs an already-loaded file's children after its `hasAttachFolder` flag flipped
 * on disk: drops the old attachment-folder node and, when the folder now exists, puts a
 * fresh one first. Heading children are kept. Unloaded children (null) stay unloaded —
 * the first expand builds them with makeFileChildren.
 */
function syncAttachChild(children: TreeNode[] | null, file: FileNode): TreeNode[] | null {
  if (!children) return children;
  return makeFileChildren(file, children.filter(c => !('isDirectory' in c)));
}

/**
 * Expands a file node in the tree. Children already loaded are simply shown again;
 * otherwise they are built — a markdown file's headings read from disk, plus the
 * attachment folder node. A markdown file that can't be read is left collapsed.
 */
export async function expandFileNode(node: FileNode): Promise<void> {
  if (node.children !== null) {
    expandIndexTreeNode(node.path, node.children);
    return;
  }
  let headings: TreeNode[] = [];
  if (node.name.toLowerCase().endsWith('.md')) {
    const result = await api.readFile(node.path).catch(() => null);
    if (!result?.ok) return;
    headings = extractHeadingTree(node.path, result.content);
  }
  expandIndexTreeNode(node.path, makeFileChildren(node, headings));
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
  entries: TreeEntry[],
  previousChildren: TreeNode[] | null | undefined
): FileNode[] {
  const fresh = makeTreeNodes(entries);
  if (!previousChildren) return fresh;

  // Heading nodes (no isDirectory) can't match a directory entry, so they never
  // participate in the merge.
  const oldByPath = new Map<string, FileNode>();
  for (const child of previousChildren) {
    if ('isDirectory' in child) oldByPath.set(child.path, child as FileNode);
  }

  const merged = fresh.map(node => {
    const existing = oldByPath.get(node.path);
    // A path that changed kind (file <-> folder) must not inherit the old children.
    if (!existing || existing.isDirectory !== node.isDirectory) return node;
    const attachChanged = existing.hasAttachFolder !== node.hasAttachFolder;
    // Unchanged on disk: reuse the old node so the memo()'d tree row skips its re-render.
    if (existing.name === node.name && existing.indexOrder === node.indexOrder && !attachChanged && !existing.isLoading) return existing;
    // A file whose attachment folder appeared or vanished gets that child added or removed.
    const children = attachChanged ? syncAttachChild(existing.children, node) : existing.children;
    return { ...node, isExpanded: existing.isExpanded, children };
  });
  const unchanged = merged.length === previousChildren.length && merged.every((n, i) => n === previousChildren[i]);
  return unchanged ? (previousChildren as FileNode[]) : merged;
}

/**
 * Depth-first search for a directory/file node by absolute path within the tree,
 * including attachment-folder nodes under (loaded) file nodes.
 */
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
 * root — or the same `node` object when nothing under it changed on disk, so
 * unchanged subtrees keep their identity and their memo()'d rows don't re-render.
 * Child nodes come from `mergeTreeNodes`, the same builder the lazy expand and
 * `reloadExpandedTreeFolder` use, so all four refresh paths agree on which
 * entries a folder has (`.attach` folders filtered out), carry expansion state
 * over by path, and apply the same file <-> folder kind guard. Building children
 * by hand here instead is what let an attach folder reappear in the tree after a
 * rename, until the next refresh through a builder swept it back out.
 *
 * Recursion is the one thing this adds over `mergeTreeNodes`: each merged child
 * is refreshed too, so an expanded subtree is reloaded all the way down —
 * including an expanded attachment folder under an expanded file. Row
 * order is not decided here — `flattenVisible` in IndexTreeView orders rows at
 * render time, so builder order only survives for index-ordered (Document Mode)
 * siblings, which it passes through from the listing.
 */
export async function refreshExpandedNodes(node: FileNode): Promise<FileNode> {
  if (!node.isExpanded) return node;
  if (!node.isDirectory) return refreshFileChildren(node);
  try {
    const entries = await api.readDirectory(node.path);
    const merged = mergeTreeNodes(entries, node.children);
    const children = await Promise.all(merged.map(refreshExpandedNodes));
    // Nothing changed at or below this folder: keep its identity (structural sharing).
    if (merged === node.children && !node.isLoading && children.every((c, i) => c === merged[i])) return node;
    return { ...node, children, isLoading: false };
  } catch {
    return node;
  }
}

/**
 * The file-node half of refreshExpandedNodes: an expanded file's only directory
 * child is its attachment folder, which is refreshed like any folder; heading
 * children pass through. Returns `file` itself when nothing under it changed.
 */
async function refreshFileChildren(file: FileNode): Promise<FileNode> {
  const old = file.children;
  if (!old) return file;
  const children = await Promise.all(old.map(c => ('isDirectory' in c ? refreshExpandedNodes(c as FileNode) : c)));
  return children.every((c, i) => c === old[i]) ? file : { ...file, children };
}
