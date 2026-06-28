import type React from 'react';
import { api } from '../services/api';
import type { FileNode } from '../shared/types';
import { pasteCutItems } from './edit';
import { getIndexTreeRoot, expandIndexTreeNode } from '../store';
import { getParentPath, isPathInside } from './pathUtil';
import { ATTACH_SUFFIX } from '../shared/specialFiles';

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
  if (payload.path === destFolder) return false;
  const sourceFolder = getParentPath(payload.path);
  if (sourceFolder === destFolder) return false;
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
  // a failed rename), keeping the indexes in step with the filesystem.
  if (result.movedPaths.length > 0) {
    await Promise.all([
      api.reconcileIndexedFiles(sourceFolder, false),
      api.reconcileIndexedFiles(destFolder, false),
    ]);
  }

  if (!result.success) {
    return { success: false, error: result.error, sourceFolder };
  }

  return { success: true, sourceFolder };
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
    expandIndexTreeNode(folderPath, makeTreeNodes(entries));
  } catch {
    // leave tree as-is
  }
}
