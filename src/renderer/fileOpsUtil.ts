import type { ItemData } from '../shared/types';
import type { OcrTarget } from '../shared/shared';
import { api } from './api';
import type { FileEntry } from '../global';
import { isImageFile, isTextFile, isMarkdownFile } from '../shared/fileTypes';
import {
  deleteItems,
  clearAllSelections,
  clearAllCutItems,
  setHighlightItem,
  setPendingScrollToFile,
  setPendingEditFile,
  setPendingExpandFile,
  setAppError,
  setCurrentPath,
  getCurrentPath,
  getHasIndexFile,
} from '../store';
import { pasteCutItems, runCutPasteExclusive, deleteSelectedItems, performSplitFile, performJoinFiles, orderPastedNames, findCutItemsFromDifferentFolders } from './edit';
import { pasteFromClipboard } from './clipboard';
import { refreshDirectory } from './directoryLoader';
import { getFileName, getParentPath, joinPath, isSamePath } from './pathUtil';
import { toErrorMessage } from '../shared/logUtil';
import { generateTimestampFileName } from '../shared/timeUtil';
import { ATTACH_SUFFIX } from '../shared/specialFiles';
import { removeFrontMatterExceptId } from '../shared/frontMatterUtil';
import { DEFAULT_JOIN_OPTIONS, type JoinOptions } from './joinUtil';

/**
 * Returns the attachment folder path for `filePath` (`<filePath>.attach`), creating
 * it on disk if it does not yet exist. When the file lives in the folder currently
 * being browsed and that folder uses index ordering, the new attach folder is also
 * inserted into .INDEX.yaml immediately after its parent file, so it does not get
 * appended to the end of the document by the next reconcile.
 *
 * The index insert is skipped for a file that is *not* in the browsed folder (a file
 * nested inside another .attach folder), where `hasIndexFile` says nothing about the
 * file's own folder.
 *
 * @param filePath - Absolute path of the file that owns the attachments.
 * @returns The attachment folder path, or null if creation failed (error already reported).
 */
export async function ensureAttachFolder(filePath: string): Promise<string | null> {
  const attachFolderPath = `${filePath}${ATTACH_SUFFIX}`;
  const exists = await api.pathExists(attachFolderPath);
  if (exists) return attachFolderPath;

  const result = await api.createFolder(attachFolderPath);
  if (!result.success) {
    setAppError(result.error || 'Failed to create attachment folder');
    return null;
  }

  const parentFolder = getParentPath(filePath);
  if (getHasIndexFile() && isSamePath(parentFolder, getCurrentPath())) {
    const fileName = getFileName(filePath);
    await api.insertIntoIndexYaml(parentFolder, `${fileName}${ATTACH_SUFFIX}`, fileName);
  }
  return attachFolderPath;
}

/**
 * Creates a brand-new, empty Markdown file inside `filePath`'s attach folder (creating
 * that folder on demand) and queues the edit that drops the user straight into the
 * editor for it. This is the one-click "start writing an attachment" path, as opposed
 * to {@link ensureAttachFolder}'s other callers, which attach something that already
 * exists.
 *
 * The name follows the same timestamp convention as a new file inserted into a
 * document, so no naming dialog is needed and two clicks in a row can't collide.
 *
 * @param filePath - Absolute path of the file that will own the attachment.
 */
export async function createAttachmentFileOp(
  filePath: string
): Promise<void> {
  const attachFolderPath = await ensureAttachFolder(filePath);
  if (!attachFolderPath) return; // ensureAttachFolder already reported the failure

  const newFilePath = joinPath(attachFolderPath, generateTimestampFileName());
  const result = await api.createFile(newFilePath, '');
  if (!result.success) {
    setAppError(result.error || 'Failed to create attachment file');
    return;
  }

  try {
    await api.reconcileIndexedFiles(attachFolderPath, false);
  } catch (err: unknown) {
    setAppError('Failed to update index after creating attachment: ' + toErrorMessage(err));
    return;
  }

  setPendingScrollToFile(newFilePath);
  // Drive expand+edit off the refresh-completion effect in BrowseView (which acts once
  // the new attachment is actually rendered) rather than a fixed timing assumption.
  setPendingEditFile(newFilePath);
  refreshDirectory();
}

/**
 * Resolves an insert position in the displayed listing to the name of the entry it
 * follows in .INDEX.yaml — null for position 0 (the topmost insert bar).
 */
function insertAfterNameAt(insertAtIndex: number, sortedEntries: FileEntry[]): string | null {
  return insertAtIndex > 0 ? sortedEntries[insertAtIndex - 1]?.name ?? null : null;
}

/**
 * Moves all cut items in the store into the given folder, then reconciles the index
 * for both the source and destination folders. A no-op while another paste of the
 * cut items is still running (see {@link runCutPasteExclusive}).
 *
 * @param folderPath - Absolute path of the destination folder.
 * @param items - The current item map from the store (used to find cut items).
 * @param insertAtIndex - Zero-based position in the destination document's listing
 *   (an IndexInsertBar's paste button) at which the pasted items are spliced into its
 *   .INDEX.yaml as one block. If null, the reconcile appends them at the end instead.
 *   A positional paste is also the one paste allowed back into the items' own folder:
 *   nothing moves on disk, and the items are just moved to that position in the
 *   document (see {@link reorderCutItemsInIndex}).
 * @param sortedEntries - The destination's current sorted listing, used to resolve
 *   the "insert after" sibling name when insertAtIndex is set.
 */
export async function pasteIntoFolder(
  folderPath: string,
  items: ReadonlyMap<string, ItemData>,
  insertAtIndex: number | null = null,
  sortedEntries: FileEntry[] = []
): Promise<void> {
  await runCutPasteExclusive(() => pasteIntoFolderNow(folderPath, items, insertAtIndex, sortedEntries));
}

async function pasteIntoFolderNow(
  folderPath: string,
  items: ReadonlyMap<string, ItemData>,
  insertAtIndex: number | null,
  sortedEntries: FileEntry[]
): Promise<void> {
  const cutItems = Array.from(items.values()).filter((item) => item.isCut);
  if (cutItems.length === 0) return;

  setAppError(null);

  if (
    insertAtIndex !== null &&
    findCutItemsFromDifferentFolders(cutItems).length === 0 &&
    isSamePath(getParentPath(cutItems[0]!.path), folderPath)
  ) {
    await reorderCutItemsInIndex(folderPath, cutItems, insertAtIndex, sortedEntries);
    return;
  }

  // A positional paste keeps the items in their source document's order, which
  // must be read before the move: the source reconcile below drops their entries.
  const sourceIndex = insertAtIndex !== null
    ? await api.readIndexYaml(getParentPath(cutItems[0]!.path))
    : null;

  // pasteCutItems is the single authority for the "all cut items share one
  // source folder" rule (and reports which items violate it), so we don't
  // re-validate that here. We only need the shared source folder for the
  // post-move index reconcile below, and it's derived there — where the move
  // having happened already guarantees the folder was unique.
  const result = await pasteCutItems(
    cutItems,
    folderPath,
    api.pathExists,
    api.renameFile
  );

  // The move is not atomic: some items may have moved even when the overall
  // result is a failure. Reconcile the store and indexes with whatever actually
  // moved on disk so the UI never desyncs, regardless of success.
  const moved = result.movedPaths.length > 0;
  if (moved) {
    const sourceFolder = getParentPath(cutItems[0]!.path); 
    deleteItems(result.movedPaths);
    // Splice first, then reconcile: the reconcile alone would append the moved
    // items at the end of the destination document.
    const updateDestinationIndex = async () => {
      if (insertAtIndex !== null) {
        const names = orderPastedNames(
          result.movedPaths.map((p) => getFileName(p)),
          (sourceIndex?.files ?? []).map((f) => f.name)
        );
        const insertResult = await api.insertIntoIndexYaml(folderPath, names, insertAfterNameAt(insertAtIndex, sortedEntries));
        if (!insertResult.success) {
          throw new Error(insertResult.error || 'Failed to insert pasted items into the index');
        }
      }
      await api.reconcileIndexedFiles(folderPath, false);
    };
    try {
      await Promise.all([
        api.reconcileIndexedFiles(sourceFolder, false),
        updateDestinationIndex(),
      ]);
    } catch (err: unknown) {
      setAppError('Failed to update index after paste: ' + toErrorMessage(err));
      refreshDirectory();
      return;
    }
  }

  if (!result.success) {
    setAppError(result.error || 'Failed to paste items');
    // Items that failed to move remain cut at their source; leave their cut
    // state intact and only refresh if something actually changed on disk.
    if (moved) refreshDirectory();
    return;
  }

  clearAllCutItems();
  refreshDirectory();
}

/**
 * The same-folder case of a positional paste: the cut items already live in the
 * document, so instead of a move on disk (which pasteCutItems refuses) their
 * .INDEX.yaml entries are moved, as one block in their current document order, to
 * the insert position — insertIntoIndexYaml takes out an already-listed name's old
 * entry before splicing. `sortedEntries` hides the cut items, so the resolved
 * "insert after" name is never one of them. Pasting them right back where they were
 * is allowed and simply rewrites the same order.
 */
async function reorderCutItemsInIndex(
  folderPath: string,
  cutItems: ItemData[],
  insertAtIndex: number,
  sortedEntries: FileEntry[]
): Promise<void> {
  const indexYaml = await api.readIndexYaml(folderPath);
  const names = orderPastedNames(
    cutItems.map((item) => item.name),
    (indexYaml?.files ?? []).map((f) => f.name)
  );
  const result = await api.insertIntoIndexYaml(folderPath, names, insertAfterNameAt(insertAtIndex, sortedEntries));
  if (!result.success) {
    // Nothing changed; the items stay cut so the user can retry.
    setAppError('Failed to move items in the index: ' + (result.error || 'Unknown error'));
    return;
  }
  clearAllCutItems();
  refreshDirectory();
}

/**
 * Deletes all currently selected items, updates the store, and reconciles the index
 * if an index file is present in the current folder.
 *
 * @param selectedItems - The list of items to delete.
 * @param currentPath - Absolute path of the folder being viewed, used for index reconciliation.
 * @param hasIndexFile - Whether the current folder has an .INDEX.yaml file to reconcile.
 * @param onDismissConfirm - Callback invoked to close any active confirmation dialog.
 */
export async function deleteSelected(
  selectedItems: ItemData[],
  currentPath: string | null,
  hasIndexFile: boolean,
  onDismissConfirm: () => void
): Promise<void> {
  if (selectedItems.length === 0) return;

  onDismissConfirm();

  const result = await deleteSelectedItems(selectedItems, api.deleteFile);

  if (!result.success) {
    const failed = result.failedItems;
    setAppError(
      failed.length === 0
        ? 'Failed to delete items'
        : failed.length === 1
          ? `Failed to delete ${failed[0]}`
          : `Failed to delete ${failed.length} items: ${failed.join(', ')}`
    );
  }

  if (result.deletedPaths.length > 0) {
    deleteItems(result.deletedPaths);
    if (currentPath && hasIndexFile) {
      try {
        await api.reconcileIndexedFiles(currentPath, false);
      } catch (err: unknown) {
        setAppError('Failed to update index after delete: ' + toErrorMessage(err));
      }
    }
    refreshDirectory();
  }
}


/**
 * Deletes the (empty) folder being browsed and navigates to its parent. The
 * main process refuses any folder that has content on disk, hidden files
 * included — a lone .INDEX.yaml is the one exception, removed along with the
 * folder — so this can never remove user files the listing doesn't show.
 */
export async function deleteEmptyFolderOp(folderPath: string): Promise<void> {
  const result = await api.deleteEmptyFolder(folderPath);
  if (!result.success) {
    setAppError(`Failed to delete folder: ${result.error ?? 'unknown error'}`);
    return;
  }
  deleteItems([folderPath]);
  // Only leave if the user is still in the folder that was deleted.
  if (isSamePath(getCurrentPath(), folderPath)) {
    setCurrentPath(getParentPath(folderPath));
  }
  refreshDirectory();
}

/**
 * Splices the files created by a split into the folder's .INDEX.yaml so they sit
 * directly after the original file's entry, preserving the split file's position
 * in the document. Without this step the new parts would only be appended to the
 * *end* of the index by the next reconcile, scattering the split content to the
 * bottom of the document.
 *
 * splitFile creates every part (including `-00`) as a new file and deletes the
 * original, so the index still lists the original name when this runs. The parts
 * `-01` … `-NN` are inserted after that entry (or after its attach folder, which
 * must stay immediately behind its file), and the closing reconcile re-points the
 * original's entry to the new `-00` file in place via its front-matter id — the
 * id travels with part 0's content. Front-matter ids are optional, so when the
 * original's entry has none, `-00` is inserted too and the reconcile simply drops
 * the deleted original's entry. If the original has no entry at all, the inserts
 * are skipped and the reconcile appends every part at the end.
 *
 * @param currentPath - Absolute path of the folder that was split into.
 * @param originalName - Filename of the file that was split (now deleted).
 * @param filePaths - All files produced by the split, `-00` first (document order).
 */
async function insertSplitPartsIntoIndex(
  currentPath: string,
  originalName: string,
  filePaths: string[]
): Promise<void> {
  const names = filePaths.map((p) => getFileName(p));

  const indexYaml = await api.readIndexYaml(currentPath);
  const entries = indexYaml?.files ?? [];
  const entryNames = entries.map((f) => f.name);
  const anchorIdx = entryNames.indexOf(originalName);
  if (anchorIdx !== -1) {
    const attachName = `${originalName}${ATTACH_SUFFIX}`;
    let insertAfter = entryNames[anchorIdx + 1] === attachName ? attachName : originalName;
    // With an id, the original's entry becomes `-00`'s (see above); without one it can't.
    const toInsert = entries[anchorIdx]!.id ? names.slice(1) : names;
    for (const name of toInsert) {
      const result = await api.insertIntoIndexYaml(currentPath, name, insertAfter);
      if (!result.success) {
        throw new Error(result.error || `Failed to insert "${name}" into the index`);
      }
      insertAfter = name;
    }
  }

  const result = await api.reconcileIndexedFiles(currentPath, false);
  if (!result.success) {
    throw new Error(result.error || 'Failed to reconcile the index');
  }
}

/**
 * Splits the single selected text/Markdown file into numbered parts on blank-line boundaries
 * (a run of 3 or more newlines). Every part is written to a new numbered file (`-00`, `-01`,
 * `-02`, …) and the original file is deleted once they all exist. See `splitUtil.ts` for the
 * transactional details. In a Document Mode folder, the parts are spliced into .INDEX.yaml at
 * the original file's position so the document order is preserved. Clears all selections and
 * refreshes the directory view on success.
 *
 * @param currentPath - Absolute path of the folder containing the file.
 * @param selectedItems - The selected items; exactly one text or Markdown file is expected.
 * @param hasIndexFile - Whether the current folder has an .INDEX.yaml file to update.
 */
export async function splitSelectedFile(
  currentPath: string,
  selectedItems: ItemData[],
  hasIndexFile: boolean
): Promise<void> {
  const result = await performSplitFile(selectedItems, api);

  if (!result.success) {
    setAppError(result.error || 'Failed to split file.');
    return;
  }

  // The files changed on disk; keep .INDEX.yaml in sync before the refresh. An
  // index failure is surfaced but doesn't suppress the refresh — the split
  // itself succeeded, and the next reconcile heals the index. performSplitFile
  // guarantees exactly one selected item on success, so its name is the name of
  // the (now deleted) file that was split.
  if (hasIndexFile && result.filePaths) {
    try {
      await insertSplitPartsIntoIndex(currentPath, selectedItems[0]!.name, result.filePaths);
    } catch (err: unknown) {
      setAppError('Failed to update index after split: ' + toErrorMessage(err));
    }
  }

  clearAllSelections();
  refreshDirectory();
}

/**
 * Concatenates two or more selected text/Markdown files, in filename order, into the
 * alphabetically first of them, separated by a blank-line delimiter (`\n\n\n`) — the inverse of
 * `splitSelectedFile`. Front matter on the appended files is converted to a fenced YAML block,
 * and those source files are deleted only after the write is verified. See `joinUtil.ts` for the
 * details. In a Document Mode folder, .INDEX.yaml is reconciled afterwards so the deleted
 * sources' entries are dropped (the surviving target keeps its entry and position). Clears all
 * selections and refreshes the directory view on success.
 *
 * @param currentPath - Absolute path of the folder containing the files.
 * @param selectedItems - The selected items; two or more text or Markdown files are expected.
 * @param hasIndexFile - Whether the current folder has an .INDEX.yaml file to reconcile.
 * @param options - Join options chosen in the Join Options dialog (e.g. filename headings).
 */
export async function joinSelectedFiles(
  currentPath: string,
  selectedItems: ItemData[],
  hasIndexFile: boolean,
  options: JoinOptions = DEFAULT_JOIN_OPTIONS
): Promise<void> {
  const result = await performJoinFiles(selectedItems, api, options);

  if (!result.success) {
    setAppError(result.error || 'Failed to join files.');
    return;
  }

  // The joined-away source files are gone from disk; reconcile drops their
  // stale index entries while the surviving target keeps its entry and
  // position. An index failure is surfaced but doesn't suppress the refresh —
  // the join itself succeeded, and the next reconcile heals the index.
  if (hasIndexFile) {
    try {
      await api.reconcileIndexedFiles(currentPath, false);
    } catch (err: unknown) {
      setAppError('Failed to update index after join: ' + toErrorMessage(err));
    }
  }

  clearAllSelections();
  refreshDirectory();
}

/**
 * Shared implementation behind {@link createFileOp} and {@link createFolderOp}: creates the
 * item on disk, closes the dialog, optionally inserts it into the folder's .INDEX.yaml at a
 * specific position, highlights and scrolls to it, then refreshes the directory.
 *
 * @param itemName - Name of the file or folder to create.
 * @param currentPath - Absolute path of the parent folder.
 * @param insertAtIndex - Zero-based index at which to insert the item in the index, or null to append.
 * @param sortedEntries - Current sorted entries, used to resolve the "insert after" sibling name.
 * @param create - The create call to perform (e.g. api.createFile / api.createFolder).
 * @param failureMessage - Fallback error message if the create call reports failure.
 * @param onCloseDialog - Closes the originating dialog; always called exactly once.
 * @param refresh - Brings the view up to date once the item exists; see {@link createFileOp}.
 * @param onCreated - Optional post-create hook, invoked with the new item's absolute path.
 */
async function createItemOp(
  itemName: string,
  currentPath: string,
  insertAtIndex: number | null,
  sortedEntries: FileEntry[],
  create: (itemPath: string) => Promise<{ success: boolean; error?: string }>,
  failureMessage: string,
  onCloseDialog: () => void,
  refresh: () => void,
  onCreated?: (itemPath: string) => void
): Promise<void> {
  const itemPath = joinPath(currentPath, itemName);
  const result = await create(itemPath);

  onCloseDialog();

  if (!result.success) {
    setAppError(result.error || failureMessage);
    return;
  }

  try {
    if (insertAtIndex !== null) {
      const insertResult = await api.insertIntoIndexYaml(currentPath, itemName, insertAfterNameAt(insertAtIndex, sortedEntries));
      if (!insertResult.success) {
        throw new Error(insertResult.error || `Failed to insert "${itemName}" into the index`);
      }
    }
  } catch (err: unknown) {
    setAppError('Failed to insert item into index: ' + toErrorMessage(err));
    return;
  }

  setHighlightItem(itemPath);
  setPendingScrollToFile(itemPath);
  refresh();
  onCreated?.(itemPath);
}

/**
 * Creates a new file in the current folder, optionally inserting it at a specific position
 * in the folder's .INDEX.yaml. For Markdown and text files, immediately opens the item
 * in edit mode after creation.
 *
 * @param fileName - The name of the new file (e.g. "notes.md").
 * @param currentPath - Absolute path of the folder where the file will be created.
 * @param insertAtIndex - Zero-based position at which to insert the new file in the index.
 *   If null, the file is appended by the next reconcile rather than inserted explicitly.
 * @param sortedEntries - The current sorted list of folder entries, used to resolve the
 *   "insert after" sibling name when insertAtIndex is set.
 * @param onCloseDialog - Callback invoked to close the "new file" dialog.
 * @param initialContent - Content to seed the new file with. Defaults to empty; the index
 *   tree's "New TODO" uses it to pre-fill calendar + tag front matter.
 * @param refresh - Brings the view up to date once the file exists. Defaults to
 *   `refreshDirectory`; the index tree passes a navigation to the file's folder instead,
 *   which loads the listing itself.
 */
export async function createFileOp(
  fileName: string,
  currentPath: string | null,
  insertAtIndex: number | null,
  sortedEntries: FileEntry[],
  onCloseDialog: () => void,
  initialContent = '',
  refresh: () => void = refreshDirectory
): Promise<void> {
  if (!currentPath) return;
  await createItemOp(
    fileName,
    currentPath,
    insertAtIndex,
    sortedEntries,
    (filePath) => api.createFile(filePath, initialContent),
    'Failed to create file',
    onCloseDialog,
    refresh,
    (filePath) => {
      if (isMarkdownFile(fileName) || isTextFile(fileName)) {
        // Drive expand+edit off the refresh-completion effect in BrowseView (which acts
        // once the new item is actually rendered) rather than a fixed timing assumption.
        setPendingEditFile(filePath);
      }
    }
  );
}

/**
 * Creates a new subfolder in the current folder, optionally inserting it at a specific
 * position in the folder's .INDEX.yaml.
 *
 * @param folderName - The name of the new subfolder.
 * @param currentPath - Absolute path of the parent folder where the subfolder will be created.
 * @param insertAtIndex - Zero-based position at which to insert the new folder in the index.
 *   If null, the folder is appended by the next reconcile rather than inserted explicitly.
 * @param sortedEntries - The current sorted list of folder entries, used to resolve the
 *   "insert after" sibling name when insertAtIndex is set.
 * @param onCloseDialog - Callback invoked to close the "new folder" dialog.
 */
export async function createFolderOp(
  folderName: string,
  currentPath: string | null,
  insertAtIndex: number | null,
  sortedEntries: FileEntry[],
  onCloseDialog: () => void
): Promise<void> {
  if (!currentPath) return;
  await createItemOp(
    folderName,
    currentPath,
    insertAtIndex,
    sortedEntries,
    api.createFolder,
    'Failed to create folder',
    onCloseDialog,
    refreshDirectory
  );
}

/**
 * Launches an external terminal to run OCR on the selected image files, or on the entire
 * current folder if nothing is selected. Requires the OCR tools folder to be configured
 * in Settings; errors are surfaced via setAppError if it is missing or the launch fails.
 *
 * When items are selected: runs ocr.sh individually on each selected image file in sequence.
 * When nothing is selected: runs ocr.sh on the current folder path (batch mode).
 *
 * @param currentPath - Absolute path of the folder currently being viewed.
 * @param ocrToolsFolder - Absolute path to the folder containing ocr.sh. If undefined, an
 *   error is shown and the operation is aborted.
 * @param items - The current item map from the store, used to find selected image files.
 */
export async function runOcr(
  currentPath: string,
  ocrToolsFolder: string | undefined,
  items: ReadonlyMap<string, ItemData>
): Promise<void> {
  if (!ocrToolsFolder) {
    setAppError('OCR tools folder is not configured. Set it in Settings → OCR.');
    return;
  }

  const selectedImages = Array.from(items.values()).filter(
    (item) => item.isSelected && !item.isDirectory && isImageFile(item.name)
  );
  const hasAnySelection = Array.from(items.values()).some((item) => item.isSelected);

  // Pass paths/labels as structured data; the main process shell-quotes them so a
  // path or filename can never be interpreted as shell syntax.
  let targets: OcrTarget[];
  if (hasAnySelection) {
    if (selectedImages.length === 0) {
      setAppError('No image files in the current selection. Select one or more image files to run OCR.');
      return;
    }
    targets = selectedImages.map((img, i) => ({
      path: img.path,
      label: `--- OCR [${i + 1}/${selectedImages.length}]: ${img.name} ---`,
    }));
  } else {
    targets = [{ path: currentPath }];
  }

  try {
    const result = await api.runOcrInTerminal(ocrToolsFolder, targets);
    if (!result.success) {
      setAppError('Failed to launch OCR terminal: ' + (result.error ?? 'Unknown error'));
    }
  } catch (err: unknown) {
    setAppError('Failed to launch OCR terminal: ' + toErrorMessage(err));
  }
}

/**
 * Pastes image or text content from the system clipboard as a new file in the current folder.
 * On success: reconciles the folder's .INDEX.yaml, refreshes the directory view, scrolls to
 * the new file, and expands it in the file tree. No-ops if the clipboard is empty or unsupported.
 *
 * @param currentPath - Absolute path of the folder where the clipboard content will be saved.
 *   Pass null to no-op (e.g. when no folder is open).
 */
export async function pasteFromClipboardOp(
  currentPath: string | null
): Promise<void> {
  if (!currentPath) return;

  const result = await pasteFromClipboard(
    currentPath,
    api.writeFileBinary,
    api.writeFile
  );

  if (result.success && result.fileName) {
    const filePath = joinPath(currentPath, result.fileName);
    try {
      await api.reconcileIndexedFiles(currentPath, false);
    } catch (err: unknown) {
      setAppError('Failed to update index after paste: ' + toErrorMessage(err));
      return;
    }
    setPendingScrollToFile(filePath);
    // Drive the expand off the refresh-completion effect in BrowseView (which acts
    // once the pasted item is actually rendered) rather than a fixed timing assumption.
    setPendingExpandFile(filePath);
    refreshDirectory();
  } else if (result.error) {
    setAppError(result.error);
  }
}

/**
 * Clears every front-matter property except `id` from each selected Markdown file (see
 * {@link removeFrontMatterExceptId}). Folders and non-Markdown files in the selection are
 * silently skipped. A file that can't be read or written, or whose front matter is
 * malformed, is left untouched and counted in the summary rather than aborting the rest.
 * Refreshes the directory view when anything changed.
 *
 * @param selectedItems - The selected items; only Markdown files are processed.
 * @param onResult - Receives the user-facing summary once every file has been processed.
 */
export async function removePropertiesFromSelected(
  selectedItems: ItemData[],
  onResult: (message: string) => void
): Promise<void> {
  const files = selectedItems.filter((item) => !item.isDirectory && isMarkdownFile(item.name));
  if (files.length === 0) {
    onResult('No Markdown files are selected.');
    return;
  }

  let changed = 0;
  let unchanged = 0;
  const failed: string[] = [];
  for (const file of files) {
    const read = await api.readFile(file.path);
    if (!read.ok) {
      failed.push(`${file.name} (could not be read)`);
      continue;
    }
    const result = removeFrontMatterExceptId(read.content);
    if (result.status === 'unchanged') {
      unchanged++;
    } else if (result.status === 'malformed') {
      failed.push(`${file.name} (malformed front matter)`);
    } else if ((await api.writeFile(file.path, result.content)).ok) {
      changed++;
    } else {
      failed.push(`${file.name} (could not be written)`);
    }
  }

  if (changed > 0) refreshDirectory();

  const lines = [`Removed properties from ${changed} file(s).`];
  if (unchanged > 0) lines.push(`${unchanged} file(s) had no properties to remove.`);
  if (failed.length > 0) lines.push('', 'Skipped:', ...failed.map((f) => `  ${f}`));
  onResult(lines.join('\n'));
}
