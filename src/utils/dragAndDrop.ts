import type React from 'react';
import type { ItemData } from '../types/types';
import { pasteCutItems } from '../edit';

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
  const sourceFolder = payload.path.substring(0, payload.path.lastIndexOf('/'));
  if (sourceFolder === destFolder) return false;
  if (payload.isDirectory && destFolder.startsWith(payload.path + '/')) return false;
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
  const sourceFolder = payload.path.substring(0, payload.path.lastIndexOf('/'));

  // pasteCutItems only reads .path and .name; a minimal synthetic item is sufficient.
  const item = { path: payload.path, name: payload.name, isDirectory: payload.isDirectory } as ItemData;
  const result = await pasteCutItems(
    [item],
    destFolder,
    window.electronAPI.pathExists,
    window.electronAPI.renameFile
  );

  if (!result.success) {
    return { success: false, error: result.error, sourceFolder };
  }

  await Promise.all([
    window.electronAPI.reconcileIndexedFiles(sourceFolder, false),
    window.electronAPI.reconcileIndexedFiles(destFolder, false),
  ]);

  return { success: true, sourceFolder };
}
