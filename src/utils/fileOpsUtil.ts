import type { ItemData } from '../types/types';
import type { OcrTarget } from '../types/shared';
import { api } from '../services/api';
import type { FileEntry } from '../global';
import { isImageFile, isTextFile, isMarkdownFile } from './fileTypes';
import {
  deleteItems,
  clearAllSelections,
  clearAllCutItems,
  setHighlightItem,
  setPendingScrollToFile,
  setPendingEditFile,
  setItemExpanded,
} from '../store';
import { pasteCutItems, deleteSelectedItems, performSplitFile, performJoinFiles } from './edit';
import { pasteFromClipboard } from './clipboard';
import { getParentPath, joinPath } from './pathUtil';
import { toErrorMessage } from './errorUtil';

/**
 * Error-callback signature shared by every file operation in this module.
 * Called with a message on failure, or null to clear a previously shown error.
 */
type SetError = (e: string | null) => void;

/** Delay before expanding a freshly pasted item, giving the refresh time to render it. */
const EXPAND_AFTER_PASTE_DELAY_MS = 200;

/**
 * Moves all cut items in the store into the given folder, then reconciles the index
 * for both the source and destination folders.
 *
 * @param folderPath - Absolute path of the destination folder.
 * @param items - The current item map from the store (used to find cut items).
 * @param onSetError - Callback invoked with an error message on failure, or null to clear.
 * @param onRefreshDirectory - Callback invoked to trigger a directory refresh after the move.
 */
export async function pasteIntoFolder(
  folderPath: string,
  items: ReadonlyMap<string, ItemData>,
  onSetError: SetError,
  onRefreshDirectory: () => void
): Promise<void> {
  const cutItems = Array.from(items.values()).filter((item) => item.isCut);
  if (cutItems.length === 0) return;

  onSetError(null);

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
    const sourceFolder = getParentPath(cutItems[0].path);
    deleteItems(result.movedPaths);
    try {
      await Promise.all([
        api.reconcileIndexedFiles(sourceFolder, false),
        api.reconcileIndexedFiles(folderPath, false),
      ]);
    } catch (err: unknown) {
      onSetError('Failed to update index after paste: ' + toErrorMessage(err));
      onRefreshDirectory();
      return;
    }
  }

  if (!result.success) {
    onSetError(result.error || 'Failed to paste items');
    // Items that failed to move remain cut at their source; leave their cut
    // state intact and only refresh if something actually changed on disk.
    if (moved) onRefreshDirectory();
    return;
  }

  clearAllCutItems();
  onRefreshDirectory();
}

/**
 * Deletes all currently selected items, updates the store, and reconciles the index
 * if an index file is present in the current folder.
 *
 * @param selectedItems - The list of items to delete.
 * @param currentPath - Absolute path of the folder being viewed, used for index reconciliation.
 * @param hasIndexFile - Whether the current folder has an .INDEX.yaml file to reconcile.
 * @param onSetError - Callback invoked with an error message if any deletion fails.
 * @param onRefreshDirectory - Callback invoked to trigger a directory refresh after deletion.
 * @param onDismissConfirm - Callback invoked to close any active confirmation dialog.
 */
export async function deleteSelected(
  selectedItems: ItemData[],
  currentPath: string | null,
  hasIndexFile: boolean,
  onSetError: SetError,
  onRefreshDirectory: () => void,
  onDismissConfirm: () => void
): Promise<void> {
  if (selectedItems.length === 0) return;

  onDismissConfirm();

  const result = await deleteSelectedItems(selectedItems, api.deleteFile);

  if (!result.success) {
    const failed = result.failedItems;
    onSetError(
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
        onSetError('Failed to update index after delete: ' + toErrorMessage(err));
      }
    }
    onRefreshDirectory();
  }
}


/**
 * Splits the single selected Markdown file into multiple files by H1 headings: each top-level
 * `# Heading` becomes the first line of a new file, and the original file is replaced by the
 * content before the first H1. Clears all selections and refreshes the directory view on success.
 *
 * @param currentPath - Absolute path of the folder containing the file (unused directly but
 *   kept for API symmetry with other ops).
 * @param selectedItems - The selected items; exactly one Markdown file is expected.
 * @param onSetError - Callback invoked with an error message if the split fails or no H1s are found.
 * @param onRefreshDirectory - Callback invoked to trigger a directory refresh after the split.
 */
export async function splitSelectedFile(
  currentPath: string,
  selectedItems: ItemData[],
  onSetError: SetError,
  onRefreshDirectory: () => void
): Promise<void> {
  const result = await performSplitFile(selectedItems, api);

  if (!result.success) {
    onSetError(result.error || 'Failed to split file.');
    return;
  }

  clearAllSelections();
  onRefreshDirectory();
}

/**
 * Concatenates two or more selected Markdown files into the largest file by byte size, appending
 * the others in selection order. The merged source files are deleted after a successful join.
 * Clears all selections and refreshes the directory view on success.
 *
 * @param currentPath - Absolute path of the folder containing the files (unused directly but
 *   kept for API symmetry with other ops).
 * @param selectedItems - The selected items; two or more Markdown files are expected.
 * @param onSetError - Callback invoked with an error message if the join fails.
 * @param onRefreshDirectory - Callback invoked to trigger a directory refresh after the join.
 */
export async function joinSelectedFiles(
  currentPath: string,
  selectedItems: ItemData[],
  onSetError: SetError,
  onRefreshDirectory: () => void
): Promise<void> {
  const result = await performJoinFiles(selectedItems, api);

  if (!result.success) {
    onSetError(result.error || 'Failed to join files.');
    return;
  }

  clearAllSelections();
  onRefreshDirectory();
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
 * @param onRefreshDirectory - Callback invoked to trigger a directory refresh after creation.
 * @param onSetError - Callback invoked with an error message if the creation fails.
 * @param onCloseDialog - Callback invoked to close the "new file" dialog.
 */
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
 * @param onRefreshDirectory - Triggers a directory refresh after creation.
 * @param onSetError - Surfaces an error message on failure.
 * @param onCloseDialog - Closes the originating dialog; always called exactly once.
 * @param onCreated - Optional post-create hook, invoked with the new item's absolute path.
 */
async function createItemOp(
  itemName: string,
  currentPath: string,
  insertAtIndex: number | null,
  sortedEntries: FileEntry[],
  create: (itemPath: string) => Promise<{ success: boolean; error?: string }>,
  failureMessage: string,
  onRefreshDirectory: () => void,
  onSetError: SetError,
  onCloseDialog: () => void,
  onCreated?: (itemPath: string) => void
): Promise<void> {
  const itemPath = joinPath(currentPath, itemName);
  const result = await create(itemPath);

  onCloseDialog();

  if (!result.success) {
    onSetError(result.error || failureMessage);
    return;
  }

  try {
    if (insertAtIndex !== null) {
      const insertAfterName = insertAtIndex > 0 ? sortedEntries[insertAtIndex - 1]?.name ?? null : null;
      await api.insertIntoIndexYaml(currentPath, itemName, insertAfterName);
    }
  } catch (err: unknown) {
    onSetError('Failed to insert item into index: ' + toErrorMessage(err));
    return;
  }

  setHighlightItem(itemPath);
  setPendingScrollToFile(itemPath);
  onRefreshDirectory();
  onCreated?.(itemPath);
}

export async function createFileOp(
  fileName: string,
  currentPath: string | null,
  insertAtIndex: number | null,
  sortedEntries: FileEntry[],
  onRefreshDirectory: () => void,
  onSetError: SetError,
  onCloseDialog: () => void
): Promise<void> {
  if (!currentPath) return;
  await createItemOp(
    fileName,
    currentPath,
    insertAtIndex,
    sortedEntries,
    (filePath) => api.createFile(filePath, ''),
    'Failed to create file',
    onRefreshDirectory,
    onSetError,
    onCloseDialog,
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
 * @param onRefreshDirectory - Callback invoked to trigger a directory refresh after creation.
 * @param onSetError - Callback invoked with an error message if the creation fails.
 * @param onCloseDialog - Callback invoked to close the "new folder" dialog.
 */
export async function createFolderOp(
  folderName: string,
  currentPath: string | null,
  insertAtIndex: number | null,
  sortedEntries: FileEntry[],
  onRefreshDirectory: () => void,
  onSetError: SetError,
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
    onRefreshDirectory,
    onSetError,
    onCloseDialog
  );
}

/**
 * Launches an external terminal to run OCR on the selected image files, or on the entire
 * current folder if nothing is selected. Requires the OCR tools folder to be configured
 * in Settings; errors are surfaced via onSetError if it is missing or the launch fails.
 *
 * When items are selected: runs ocr.sh individually on each selected image file in sequence.
 * When nothing is selected: runs ocr.sh on the current folder path (batch mode).
 *
 * @param currentPath - Absolute path of the folder currently being viewed.
 * @param ocrToolsFolder - Absolute path to the folder containing ocr.sh. If undefined, an
 *   error is shown and the operation is aborted.
 * @param items - The current item map from the store, used to find selected image files.
 * @param onSetError - Callback invoked with an error message on any failure.
 */
export async function runOcr(
  currentPath: string,
  ocrToolsFolder: string | undefined,
  items: ReadonlyMap<string, ItemData>,
  onSetError: SetError
): Promise<void> {
  if (!ocrToolsFolder) {
    onSetError('OCR tools folder is not configured. Set it in Settings → OCR.');
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
      onSetError('No image files in the current selection. Select one or more image files to run OCR.');
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
      onSetError('Failed to launch OCR terminal: ' + (result.error ?? 'Unknown error'));
    }
  } catch (err: unknown) {
    onSetError('Failed to launch OCR terminal: ' + toErrorMessage(err));
  }
}

/**
 * Pastes image or text content from the system clipboard as a new file in the current folder.
 * On success: reconciles the folder's .INDEX.yaml, refreshes the directory view, scrolls to
 * the new file, and expands it in the file tree. No-ops if the clipboard is empty or unsupported.
 *
 * @param currentPath - Absolute path of the folder where the clipboard content will be saved.
 *   Pass null to no-op (e.g. when no folder is open).
 * @param onRefreshDirectory - Callback invoked to trigger a directory refresh after the paste.
 * @param onSetError - Callback invoked with an error message if the paste fails.
 */
export async function pasteFromClipboardOp(
  currentPath: string | null,
  onRefreshDirectory: () => void,
  onSetError: SetError
): Promise<void> {
  if (!currentPath) return;

  const result = await pasteFromClipboard(
    currentPath,
    api.writeFileBinary,
    api.writeFile
  );

  if (result.success && result.fileName) {
    const filePath = joinPath(currentPath, result.fileName);
    setPendingScrollToFile(filePath);
    try {
      await api.reconcileIndexedFiles(currentPath, false);
    } catch (err: unknown) {
      onSetError('Failed to update index after paste: ' + toErrorMessage(err));
      return;
    }
    onRefreshDirectory();
    setTimeout(() => {
      setItemExpanded(filePath, true);
    }, EXPAND_AFTER_PASTE_DELAY_MS);
  } else if (result.error) {
    onSetError(result.error);
  }
}
