import type React from 'react';
import { api } from './api';
import type { FileNode, TreeNode } from '../shared/types';
import { pasteCutItems } from './edit';
import { ensureAttachFolder } from './fileOpsUtil';
import {
  getIndexTreeRoot,
  expandIndexTreeNode,
  deleteItems,
  setAppError,
  getCurrentPath,
  requestDirectoryRefresh,
} from '../store';
import { getParentPath, isPathInside, isSamePath, splitPathSegments } from './pathUtil';
import { ATTACH_SUFFIX } from '../shared/specialFiles';
import { logger } from '../shared/logUtil';

/**
 * Custom drag-and-drop MIME type used to carry a single dragged file/folder between
 * the BrowseView entry icons (drag source) and the IndexTreeView folders (drop target).
 */
export const ENTRY_DND_MIME = 'application/x-mkbrowser-entry';

/** The payload serialized into the drag event's dataTransfer. */
export interface DragPayload {
  path: string;
  name: string;
  isDirectory: boolean;
}

/** Result of a drag-and-drop move, including the source folder for index reconciliation. */
export interface MoveResult {
  success: boolean;
  error?: string;
  sourceFolder: string;
}

function serializeDragPayload(payload: DragPayload): string {
  return JSON.stringify(payload);
}

/** Parses a drag payload from a raw dataTransfer string, or returns null if invalid. */
export function parseDragPayload(raw: string): DragPayload | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<DragPayload>;
    if (typeof obj.path === 'string' && typeof obj.name === 'string') {
      return { path: obj.path, name: obj.name, isDirectory: !!obj.isDirectory };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Builds an onDragStart handler for an entry icon. The handler stores the dragged
 * item's payload on the event and uses the icon's parent DOM element (typically the
 * entry's header row) as the drag image so the user sees an outline of the whole row.
 *
 * @param payload - The file/folder being dragged.
 */
export function makeEntryDragStartHandler(payload: DragPayload) {
  return (e: React.DragEvent): void => {
    e.stopPropagation();
    e.dataTransfer.setData(ENTRY_DND_MIME, serializeDragPayload(payload));
    e.dataTransfer.effectAllowed = 'move';
    const parent = e.currentTarget.parentElement;
    if (parent) {
      e.dataTransfer.setDragImage(parent, 0, 0);
    }
  };
}

/**
 * Returns true if the dragged payload can legally be dropped into the destination folder:
 * not onto itself, not into the folder it already lives in, and (for folders) not into one
 * of its own descendants.
 */
export function canDropInto(payload: DragPayload, destFolder: string): boolean {
  // isSamePath rather than string equality: the payload path and the destination
  // reach here from different sources and may differ only in trailing separator or
  // separator spelling while naming the same folder.
  if (isSamePath(payload.path, destFolder)) return false;
  const sourceFolder = getParentPath(payload.path);
  if (isSamePath(sourceFolder, destFolder)) return false;
  // Boundary-correct, separator-aware descendant check (shared with pasteCutItems);
  // avoids the startsWith bug where '.../projects-archive' looks "inside" '.../projects'.
  if (payload.isDirectory && isPathInside(payload.path, destFolder)) return false;
  return true;
}

/**
 * Moves a single dragged file or folder into the destination folder, then reconciles the
 * .INDEX.yaml of both the source and destination folders. Reuses the same move primitive
 * (pasteCutItems) as the cut/paste feature.
 *
 * @param payload - The file/folder being moved.
 * @param destFolder - Absolute path of the destination folder.
 */
export async function moveEntryIntoFolder(payload: DragPayload, destFolder: string): Promise<MoveResult> {
  const sourceFolder = getParentPath(payload.path);

  // pasteCutItems only reads .path, .name and .isDirectory; the DragPayload already
  // provides exactly those fields, so it satisfies the narrowed parameter type directly.
  const result = await pasteCutItems(
    [payload],
    destFolder,
    api.pathExists,
    api.renameFile
  );

  // Only reconcile when the item actually moved on disk (movedPaths is empty on
  // a failed rename), keeping the indexes in step with the filesystem. A reconcile
  // failure must not reject: the rename already happened, so the caller still has to
  // update the store (a stale .INDEX.yaml is recoverable; a store that still lists a
  // file that is no longer there is not).
  if (result.movedPaths.length > 0) {
    await Promise.all([
      api.reconcileIndexedFiles(sourceFolder, false),
      api.reconcileIndexedFiles(destFolder, false),
    ]).catch(err => logger.error('Failed to reconcile indexes after move:', err));
  }

  if (!result.success) {
    return { success: false, error: result.error, sourceFolder };
  }

  return { success: true, sourceFolder };
}

/**
 * Returns true if the dragged payload can legally become an attachment of the file at
 * `filePath` — i.e. be dropped into that file's `.attach` folder.
 *
 * Only the "onto itself" case is specific to attachments (without this check, dragging a
 * file onto its own row would create `<file>.attach` and move the file inside it). Every
 * other rule follows from the destination being `<filePath>.attach`, so they are delegated
 * to {@link canDropInto}: dragging `X.md.attach` back onto `X.md` is a drop onto itself,
 * an item already attached to the file has that folder as its parent, and a folder can
 * never be dropped onto a file it contains.
 */
export function canDropAsAttachment(payload: DragPayload, filePath: string): boolean {
  if (isSamePath(payload.path, filePath)) return false;
  return canDropInto(payload, `${filePath}${ATTACH_SUFFIX}`);
}

/**
 * True when changing the contents of `folder` changes what the browse view is showing for
 * `currentPath`.
 *
 * That is not just `folder === currentPath`: `readDirectory` pre-loads the contents of
 * `.attach` folders into the listing (recursively), so attachments are on screen as rows
 * even though they live in a subfolder. A folder below `currentPath` is therefore visible
 * exactly when every path segment between the two is itself an attachment folder — an
 * ordinary subfolder's contents are not rendered.
 */
export function affectsBrowseListing(folder: string, currentPath: string): boolean {
  if (isSamePath(folder, currentPath)) return true;
  if (!isPathInside(currentPath, folder)) return false;
  const depthBelow = splitPathSegments(currentPath).length;
  return splitPathSegments(folder)
    .slice(depthBelow)
    .every(segment => segment.endsWith(ATTACH_SUFFIX));
}

/**
 * Finishes a drag-and-drop move that {@link canDropInto} has already approved: performs the
 * move, then brings every affected view back in step with the filesystem. Shared by all four
 * drop targets (browse-view folders and files, index tree folders, breadcrumb segments) so
 * they differ only in how they compute the destination folder.
 *
 * @param payload - The file/folder being moved.
 * @param destFolder - Absolute path of the folder to move it into.
 * @param onRefreshDirectory - Reloads the browse view. Callers that have this as a prop should
 *   pass it (it refreshes without a loading flash); otherwise the store-level request is used.
 * @returns True if the item was moved (failures are already reported via setAppError).
 */
export async function completeEntryDrop(
  payload: DragPayload,
  destFolder: string,
  onRefreshDirectory?: () => void
): Promise<boolean> {
  const result = await moveEntryIntoFolder(payload, destFolder);
  if (!result.success) {
    // Nothing moved, so no refresh follows to clear this. Reporting it matters most
    // for the common name-collision case, which otherwise looks like a dead drop.
    setAppError(result.error || 'Failed to move item');
    return false;
  }

  // Drop the moved item from the store so the browse view stops showing it at its old path.
  deleteItems([payload.path]);

  await reloadExpandedTreeFolder(destFolder);
  await reloadExpandedTreeFolder(result.sourceFolder);

  const currentPath = getCurrentPath();
  if (affectsBrowseListing(destFolder, currentPath) || affectsBrowseListing(result.sourceFolder, currentPath)) {
    if (onRefreshDirectory) {
      onRefreshDirectory();
    } else {
      requestDirectoryRefresh();
    }
  }
  return true;
}

/**
 * Moves a dragged file or folder into the attachment folder of the file at `filePath`,
 * creating that `.attach` folder (and registering it in .INDEX.yaml) if it does not exist yet.
 *
 * The folder is created before the move is attempted. A name collision is impossible in a
 * folder that was just created, so the only way this leaves an empty `.attach` behind is a
 * genuine filesystem error during the rename — not worth a compensating delete.
 *
 * @param payload - The file/folder being attached.
 * @param filePath - Absolute path of the file that will own the attachment.
 * @param onRefreshDirectory - See {@link completeEntryDrop}.
 * @returns True if the item was moved (failures are already reported via setAppError).
 */
export async function dropAsAttachment(
  payload: DragPayload,
  filePath: string,
  onRefreshDirectory?: () => void
): Promise<boolean> {
  const attachFolderPath = await ensureAttachFolder(filePath);
  if (!attachFolderPath) return false; // ensureAttachFolder already reported the failure

  return completeEntryDrop(payload, attachFolderPath, onRefreshDirectory);
}

/**
 * Builds the IndexTreeView's lazily-loaded child nodes from a directory listing, omitting
 * Attachment (*.attach) folders, which are never shown in the tree.
 */
export function makeTreeNodes(
  entries: Array<{ path: string; name: string; isDirectory: boolean; indexOrder?: number }>
): FileNode[] {
  return entries.filter(e => !(e.isDirectory && e.name.endsWith(ATTACH_SUFFIX))).map(e => ({
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
