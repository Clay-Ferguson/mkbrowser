import type { ItemData } from '../shared/types';
import { joinFiles as joinFilesUtil } from './joinUtil';
import { splitFile as splitFileUtil } from './splitUtil';
import type { FileOps } from '../shared/shared';
import { getParentPath, joinPath, isPathInside, isSamePath } from './pathUtil';
import { toErrorMessage } from '../shared/logUtil';
import { isTextFile, isMarkdownFile } from '../shared/fileTypes';
import { mapWithConcurrency } from '../shared/asyncUtil';

/**
 * Bound on how many filesystem operations (rename/delete/existence checks) run
 * concurrently. libuv's fs threadpool defaults to 4 threads, so values far above
 * that give diminishing returns; 16 keeps large multi-selects well-bounded
 * without serializing every round-trip.
 */
const FILE_OP_CONCURRENCY = 16;

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

  const baseFolder = getParentPath(cutItems[0]!.path); 

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
 * Two kinds of collision are reported:
 *
 * 1. **Against the destination.** A per-item `pathExists` check. Because the
 *    main-process `pathExists` is a `stat` call, this already honors the
 *    destination filesystem's own case rules (a `Readme.md` already on a
 *    case-insensitive NTFS/APFS volume is matched by a cut item named
 *    `README.MD`).
 * 2. **Among the cut items themselves.** Two cut items whose names differ only
 *    in case (`notes.md` + `Notes.md`) collide with *each other* on a
 *    case-insensitive destination, mapping to the same target path. The per-item
 *    check in (1) cannot catch this: it runs against the pre-move destination,
 *    where neither target exists yet, so both items pass and the second `rename`
 *    would clobber the first. We therefore detect case-insensitive duplicates
 *    directly among the cut names. This is flagged unconditionally — the
 *    renderer can't know the destination FS's case sensitivity, and rejecting
 *    the rare "paste `notes.md` + `Notes.md` together" case on a case-sensitive
 *    FS is far cheaper than risking a silent overwrite on Windows/macOS. (The
 *    main-process `renameFile` non-clobber guard is the real safety net; this
 *    just turns the hazard into a clean pre-paste message.)
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
    const existsAtDest = await mapWithConcurrency(cutItems, FILE_OP_CONCURRENCY, async (item) => {
      const destPath = joinPath(destinationPath, item.name);
      const exists = await pathExists(destPath);
      return exists ? item.name : null;
    });

    // Intra-batch case-insensitive collisions: the first time a lowercased name
    // repeats, both the earlier and current item are flagged.
    const firstByLowerName = new Map<string, string>();
    const caseCollisions = new Set<string>();
    for (const item of cutItems) {
      const lower = item.name.toLowerCase();
      const first = firstByLowerName.get(lower);
      if (first === undefined) {
        firstByLowerName.set(lower, item.name);
      } else {
        caseCollisions.add(first);
        caseCollisions.add(item.name);
      }
    }

    // Merge both sources into a single de-duplicated list that preserves the
    // original cut-item order.
    const flagged = new Set<string>(caseCollisions);
    for (const name of existsAtDest) {
      if (name !== null) flagged.add(name);
    }
    const duplicates: string[] = [];
    const seen = new Set<string>();
    for (const item of cutItems) {
      if (flagged.has(item.name) && !seen.has(item.name)) {
        duplicates.push(item.name);
        seen.add(item.name);
      }
    }

    return { duplicates };
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
  // source folder. Check if pasting back into that same folder. isSamePath (not
  // string equality) so a trailing separator or a '\'-vs-'/' spelling of the same
  // folder still hits this guard and yields the honest message, instead of falling
  // through to the duplicate check and reporting the items as "already existing".
  const sourceFolder = getParentPath(cutItems[0]!.path);
  if (isSamePath(sourceFolder, destinationPath)) {
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

  // Move items with bounded concurrency rather than one-at-a-time: the renames
  // are mutually independent (duplicates were pre-checked above), so serializing
  // hundreds of IPC round-trips would needlessly stall a large multi-select.
  // This is best-effort and not atomic: every item is attempted regardless of
  // earlier failures, and the items that did move are reported via movedPaths so
  // the caller can reconcile the store/index rather than desyncing on the first
  // failure. A rejected rename (e.g. EPERM/EBUSY from the main process) is
  // caught and treated as a failure for that item.
  const outcomes = await mapWithConcurrency(cutItems, FILE_OP_CONCURRENCY, async (item) => {
    const newPath = joinPath(destinationPath, item.name);
    try {
      return { item, ok: await renameFile(item.path, newPath) };
    } catch (err) {
      return { item, ok: false, error: toErrorMessage(err) };
    }
  });

  // movedPaths preserves selection order: mapWithConcurrency returns results in
  // input order, and filtering keeps that order.
  const movedPaths = outcomes.filter((o) => o.ok).map((o) => o.item.path);
  const failures = outcomes.filter((o) => !o.ok);

  if (failures.length > 0) {
    const first = failures[0];
    const error =
      failures.length === 1
        ? `Failed to move ${first!.error ? `${first!.item.name}: ${first!.error}` : first!.item.name}` 
        : `Failed to move ${failures.length} items: ${failures.map((f) => f.item.name).join(', ')}`;
    return { success: false, error, movedPaths };
  }

  return {
    success: true,
    pastedItemName: cutItems.length === 1 ? cutItems[0]!.name : undefined, 
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
 *
 * The independent deletes run with bounded concurrency rather than one-at-a-time
 * so a large multi-select doesn't serialize hundreds of IPC round-trips.
 */
export async function deleteSelectedItems(
  selectedItems: Pick<ItemData, 'path' | 'name'>[],
  deleteFile: (path: string) => Promise<boolean>
): Promise<DeleteResult> {
  const outcomes = await mapWithConcurrency(selectedItems, FILE_OP_CONCURRENCY, async (item) => {
    try {
      return { item, ok: await deleteFile(item.path) };
    } catch {
      return { item, ok: false };
    }
  });

  // Both arrays preserve selection order: mapWithConcurrency returns results in
  // input order, and filtering keeps that order.
  const deletedPaths = outcomes.filter((o) => o.ok).map((o) => o.item.path);
  const failedItems = outcomes.filter((o) => !o.ok).map((o) => o.item.name);

  return { success: failedItems.length === 0, deletedPaths, failedItems };
}

/**
 * Result of split file validation/operation
 */
export interface SplitFileValidationResult {
  success: boolean;
  error?: string;
  /**
   * Paths of every file produced by a successful split (the renamed `-00`
   * original first, then the new `-01` … `-NN` parts, in document order).
   * Callers use this to splice the new parts into the folder's .INDEX.yaml.
   */
  filePaths?: string[];
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
  if (selectedItem!.isDirectory) { 
    return { success: false, error: 'Cannot split a folder. Please select a text or markdown file.' };
  }

  // Check that the file is a text or markdown file
  if (!isSplittableJoinable(selectedItem!.name)) { 
    return { success: false, error: 'Split is only available for text and markdown files.' };
  }

  // Perform the split operation
  const result = await splitFileUtil(selectedItem!.path, ops);

  if (!result.success) {
    return { success: false, error: result.error || 'Failed to split file.' };
  }

  return { success: true, filePaths: result.filePaths };
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

  // All files must live in the same folder: `joinFiles` writes the joined content
  // into the alphabetically-first *name* and deletes the rest, so a cross-folder
  // selection would silently merge files out of their own folders.
  const otherFolderItems = findCutItemsFromDifferentFolders(selectedItems);
  if (otherFolderItems.length > 0) {
    return {
      success: false,
      error: `Cannot join files from different folders. Select files from a single folder. (${otherFolderItems.join(', ')})`,
    };
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
