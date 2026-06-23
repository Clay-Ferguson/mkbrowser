import type { ItemData } from '../types/types';
import { joinFiles as joinFilesUtil } from './fileSplitJoin/joinUtil';
import { splitFile as splitFileUtil } from './fileSplitJoin/splitUtil';
import type { FileOps } from './fileSplitJoin/fileOps';
import { getParentPath, joinPath, isPathInside } from './pathUtil';
import { toErrorMessage } from './errorUtil';
import { isTextFile, isMarkdownFile } from './fileTypes';

/**
 * Whether a file is eligible for the split/join operations. Reuses the canonical
 * file-type predicates from `fileTypes.ts` (the same source of truth used across
 * the app) rather than re-testing `.txt`/`.md` literals inline, so the set of
 * "openable as text" files stays consistent with what split/join will accept.
 * Both predicates match case-insensitively, so no `.toLowerCase()` is needed.
 */
function isSplittableJoinable(name: string): boolean {
  return isTextFile(name) || isMarkdownFile(name);
}

/**
 * The minimal subset of `ItemData` the move/paste primitives actually read. Using
 * a structural `Pick` (rather than the full `ItemData`) lets callers like the
 * drag-and-drop path pass a synthetic `{ path, name, isDirectory }` object without
 * fabricating store-specific fields or casting. Real `ItemData` remains assignable
 * as a structural superset.
 */
type CutItem = Pick<ItemData, 'path' | 'name' | 'isDirectory'>;

/**
 * Find cut items that come from different folders than the first cut item
 */
export function findCutItemsFromDifferentFolders(cutItems: Pick<ItemData, 'path' | 'name'>[]): string[] {
  if (cutItems.length === 0) return [];

  const baseFolder = getParentPath(cutItems[0].path);

  return cutItems
    .filter((item) => getParentPath(item.path) !== baseFolder)
    .map((item) => item.name);
}

/**
 * Result of a destination duplicate check.
 */
export interface DuplicateCheckResult {
  /** Names of cut items whose destination path already exists. */
  duplicates: string[];
  /**
   * Set when an existence check itself failed (the injected op rejected). When
   * present the caller must abort the paste rather than proceed.
   */
  error?: string;
}

/**
 * Find which cut items would create duplicates in the destination folder.
 *
 * A `pathExists` rejection (e.g. the IPC call throws) is converted into a hard
 * error rather than being swallowed as "does not exist": treating a failed
 * existence check as absent would risk a later `renameFile` silently
 * overwriting a real file at the destination.
 */
export async function findPasteDuplicates(
  cutItems: Pick<ItemData, 'name'>[],
  destinationPath: string,
  pathExists: (path: string) => Promise<boolean>
): Promise<DuplicateCheckResult> {
  try {
    const duplicateNames = await Promise.all(
      cutItems.map(async (item) => {
        const destPath = joinPath(destinationPath, item.name);
        const exists = await pathExists(destPath);
        return exists ? item.name : null;
      })
    );

    return { duplicates: duplicateNames.filter((name): name is string => Boolean(name)) };
  } catch (err) {
    return {
      duplicates: [],
      error: `Failed to check destination for existing files: ${toErrorMessage(err)}`,
    };
  }
}

/**
 * Result of paste operation
 */
export interface PasteResult {
  success: boolean;
  error?: string;
  /** Name of the single pasted item (for scroll-to functionality) */
  pastedItemName?: string;
  /**
   * Old paths of items that were actually renamed on disk. Populated even on
   * partial failure so callers can reconcile the store and .INDEX.yaml with
   * what truly moved, rather than desyncing on the first failed item.
   */
  movedPaths: string[];
}

/**
 * Paste cut items to the destination folder
 */
export async function pasteCutItems(
  cutItems: CutItem[],
  destinationPath: string,
  pathExists: (path: string) => Promise<boolean>,
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>
): Promise<PasteResult> {
  if (cutItems.length === 0) {
    return { success: true, movedPaths: [] };
  }

  // Establish the single-source-folder invariant FIRST, before any check relies
  // on cutItems[0] standing in for "the" source folder. Otherwise a genuinely
  // cross-folder set whose first item happens to live in the destination would
  // be reported as "already in this folder" instead of the truthful
  // "must come from the same folder" reason.
  const crossFolderItems = findCutItemsFromDifferentFolders(cutItems);
  if (crossFolderItems.length > 0) {
    return {
      success: false,
      error: `Cannot paste. Cut items must come from the same folder: ${crossFolderItems.join(', ')}`,
      movedPaths: [],
    };
  }

  // Now that uniqueness is guaranteed, cutItems[0] safely represents the shared
  // source folder. Check if pasting back into that same folder.
  const sourceFolder = getParentPath(cutItems[0].path);
  if (sourceFolder === destinationPath) {
    return { success: false, error: 'Cannot paste. Cut items are already in this folder.', movedPaths: [] };
  }

  // Reject moving a folder into itself or one of its own descendants. fs.rename
  // would reject this on most platforms, but only with a generic, platform-
  // dependent error and after partially mutating global state — so guard here,
  // before any rename is attempted. isPathInside is separator-aware and avoids
  // the startsWith boundary bug ('/notes/projects-archive' is a sibling of
  // '/notes/projects', not a descendant).
  for (const item of cutItems) {
    if (item.isDirectory && isPathInside(item.path, destinationPath)) {
      return {
        success: false,
        error: `Cannot move "${item.name}" into itself or one of its subfolders.`,
        movedPaths: [],
      };
    }
  }

  // Check for duplicates in destination
  const dupResult = await findPasteDuplicates(cutItems, destinationPath, pathExists);
  if (dupResult.error) {
    // The existence check failed; abort rather than risk overwriting a real file.
    return { success: false, error: dupResult.error, movedPaths: [] };
  }
  if (dupResult.duplicates.length > 0) {
    return {
      success: false,
      error: `Cannot paste. These items already exist: ${dupResult.duplicates.join(', ')}`,
      movedPaths: [],
    };
  }

  // Move each item sequentially. This is not atomic: on a mid-loop failure the
  // items already moved stay moved, so we report them via movedPaths and let the
  // caller reconcile rather than leaving the store/index out of sync with disk.
  const movedPaths: string[] = [];
  for (const item of cutItems) {
    const newPath = joinPath(destinationPath, item.name);
    let success = false;
    try {
      success = await renameFile(item.path, newPath);
    } catch (err) {
      // A rejected rename (e.g. EPERM/EBUSY from the main process) is reported as
      // a failure for this item; already-moved items are still returned so the
      // caller can reconcile the store/index.
      return { success: false, error: `Failed to move ${item.name}: ${toErrorMessage(err)}`, movedPaths };
    }
    if (!success) {
      return { success: false, error: `Failed to move ${item.name}`, movedPaths };
    }
    movedPaths.push(item.path);
  }

  return {
    success: true,
    pastedItemName: cutItems.length === 1 ? cutItems[0].name : undefined,
    movedPaths,
  };
}

/**
 * Result of delete operation
 */
export interface DeleteResult {
  /** True only if every selected item was deleted. */
  success: boolean;
  deletedPaths: string[];
  /** Names of every item that failed to delete (empty on full success). */
  failedItems: string[];
}

/**
 * Delete selected items from the filesystem.
 *
 * Best-effort: every item is attempted regardless of earlier failures, so a
 * single locked/permission-denied item never blocks the rest of the batch.
 * Deletions that succeed are reported via `deletedPaths` (in selection order)
 * and every failure is reported via `failedItems`, even when some succeed.
 */
export async function deleteSelectedItems(
  selectedItems: Pick<ItemData, 'path' | 'name'>[],
  deleteFile: (path: string) => Promise<boolean>
): Promise<DeleteResult> {
  const deletedPaths: string[] = [];
  const failedItems: string[] = [];

  for (const item of selectedItems) {
    let ok = false;
    try {
      ok = await deleteFile(item.path);
    } catch {
      ok = false;
    }
    if (ok) {
      deletedPaths.push(item.path);
    } else {
      failedItems.push(item.name);
    }
  }

  return { success: failedItems.length === 0, deletedPaths, failedItems };
}

/**
 * Result of split file validation/operation
 */
export interface SplitFileValidationResult {
  success: boolean;
  error?: string;
}

/**
 * Validate and perform split file operation on a selected item.
 * Checks that exactly one text/markdown file is selected, then splits it.
 */
export async function performSplitFile(
  selectedItems: ItemData[],
  ops: FileOps
): Promise<SplitFileValidationResult> {
  // Check that exactly one item is selected
  if (selectedItems.length === 0) {
    return { success: false, error: 'Please select a file to split.' };
  }
  if (selectedItems.length > 1) {
    return { success: false, error: 'Please select only one file for "Split".' };
  }

  const selectedItem = selectedItems[0];

  // Check that the selected item is a file, not a folder
  if (selectedItem.isDirectory) {
    return { success: false, error: 'Cannot split a folder. Please select a text or markdown file.' };
  }

  // Check that the file is a text or markdown file
  if (!isSplittableJoinable(selectedItem.name)) {
    return { success: false, error: 'Split is only available for text and markdown files.' };
  }

  // Perform the split operation
  const result = await splitFileUtil(selectedItem.path, ops);

  if (!result.success) {
    return { success: false, error: result.error || 'Failed to split file.' };
  }

  return { success: true };
}

/**
 * Result of join files validation/operation
 */
export interface JoinFilesValidationResult {
  success: boolean;
  error?: string;
}

/**
 * Validate and perform join files operation on selected items.
 * Checks that at least two text/markdown files are selected, then joins them.
 */
export async function performJoinFiles(
  selectedItems: ItemData[],
  ops: Pick<FileOps, 'readFile' | 'writeFile' | 'deleteFile'>
): Promise<JoinFilesValidationResult> {
  // Check that multiple items are selected
  if (selectedItems.length < 2) {
    return { success: false, error: 'Please select at least two files to join.' };
  }

  // Check that all selected items are files (not folders) and are text/markdown files
  for (const item of selectedItems) {
    if (item.isDirectory) {
      return { success: false, error: `Cannot join folders. "${item.name}" is a folder.` };
    }
    if (!isSplittableJoinable(item.name)) {
      return { success: false, error: `Join is only available for text and markdown files. "${item.name}" is not supported.` };
    }
  }

  // Get the file paths
  const filePaths = selectedItems.map(item => item.path);

  // Perform the join operation
  const result = await joinFilesUtil(filePaths, ops);

  if (!result.success) {
    return { success: false, error: result.error || 'Failed to join files.' };
  }

  return { success: true };
}
