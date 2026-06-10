import type { ItemData } from '../types/types';
import type { FileEntry } from '../global';
import { isImageFile } from './fileUtil';
import {
  deleteItems,
  clearAllSelections,
  clearAllCutItems,
  setHighlightItem,
  setPendingScrollToFile,
  setItemExpanded,
  setItemEditing,
} from '../store';
import { pasteCutItems, deleteSelectedItems, performSplitFile, performJoinFiles } from '../edit';
import { pasteFromClipboard } from './clipboard';
import { getParentPath, joinPath } from './pathUtil';

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
  onSetError: (e: string | null) => void,
  onRefreshDirectory: () => void
): Promise<void> {
  const cutItems = Array.from(items.values()).filter((item) => item.isCut);
  if (cutItems.length === 0) return;

  onSetError(null);

  const result = await pasteCutItems(
    cutItems,
    folderPath,
    window.electronAPI.pathExists,
    window.electronAPI.renameFile
  );

  if (!result.success) {
    onSetError(result.error || 'Failed to paste items');
    return;
  }

  const sourceFolder = getParentPath(cutItems[0].path);
  const movedPaths = cutItems.map((item) => item.path);
  deleteItems(movedPaths);
  clearAllCutItems();
  await Promise.all([
    window.electronAPI.reconcileIndexedFiles(sourceFolder, false),
    window.electronAPI.reconcileIndexedFiles(folderPath, false),
  ]);
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
  onSetError: (e: string) => void,
  onRefreshDirectory: () => void,
  onDismissConfirm: () => void
): Promise<void> {
  if (selectedItems.length === 0) return;

  onDismissConfirm();

  const result = await deleteSelectedItems(selectedItems, window.electronAPI.deleteFile);

  if (!result.success && result.failedItem) {
    onSetError(`Failed to delete ${result.failedItem}`);
  }

  if (result.deletedPaths.length > 0) {
    deleteItems(result.deletedPaths);
    if (currentPath && hasIndexFile) {
      await window.electronAPI.reconcileIndexedFiles(currentPath, false);
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
  onSetError: (e: string) => void,
  onRefreshDirectory: () => void
): Promise<void> {
  const result = await performSplitFile(
    selectedItems,
    window.electronAPI.readFile,
    window.electronAPI.writeFile,
    window.electronAPI.createFile,
    window.electronAPI.renameFile
  );

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
  onSetError: (e: string) => void,
  onRefreshDirectory: () => void
): Promise<void> {
  const result = await performJoinFiles(
    selectedItems,
    window.electronAPI.readFile,
    window.electronAPI.writeFile,
    window.electronAPI.deleteFile,
    window.electronAPI.getFileSize
  );

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
export async function createFileOp(
  fileName: string,
  currentPath: string | null,
  insertAtIndex: number | null,
  sortedEntries: FileEntry[],
  onRefreshDirectory: () => void,
  onSetError: (e: string) => void,
  onCloseDialog: () => void
): Promise<void> {
  if (!currentPath) return;
  const filePath = joinPath(currentPath, fileName);
  const result = await window.electronAPI.createFile(filePath, '');

  if (result.success) {
    onCloseDialog();
    if (insertAtIndex !== null) {
      const insertAfterName = insertAtIndex > 0 ? sortedEntries[insertAtIndex - 1].name : null;
      await window.electronAPI.insertIntoIndexYaml(currentPath, fileName, insertAfterName);
    }
    setHighlightItem(filePath);
    setPendingScrollToFile(filePath);
    onRefreshDirectory();
    const isMarkdown = fileName.toLowerCase().endsWith('.md');
    const isText = fileName.toLowerCase().endsWith('.txt');
    if (isMarkdown || isText) {
      setTimeout(() => {
        setItemExpanded(filePath, true);
        setItemEditing(filePath, true);
      }, 200);
    }
  } else {
    onCloseDialog();
    onSetError(result.error || 'Failed to create file');
  }
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
  onSetError: (e: string) => void,
  onCloseDialog: () => void
): Promise<void> {
  if (!currentPath) return;
  const folderPath = joinPath(currentPath, folderName);
  const result = await window.electronAPI.createFolder(folderPath);

  if (result.success) {
    onCloseDialog();
    if (insertAtIndex !== null) {
      const insertAfterName = insertAtIndex > 0 ? sortedEntries[insertAtIndex - 1].name : null;
      await window.electronAPI.insertIntoIndexYaml(currentPath, folderName, insertAfterName);
    }
    setHighlightItem(folderPath);
    setPendingScrollToFile(folderPath);
    onRefreshDirectory();
  } else {
    onCloseDialog();
    onSetError(result.error || 'Failed to create folder');
  }
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
export function runOcr(
  currentPath: string,
  ocrToolsFolder: string | undefined,
  items: ReadonlyMap<string, ItemData>,
  onSetError: (e: string) => void
): void {
  if (!ocrToolsFolder) {
    onSetError('OCR tools folder is not configured. Set it in Settings → OCR.');
    return;
  }
  const escapedOcrFolder = ocrToolsFolder.replace(/'/g, "'\\''");

  const selectedImages = Array.from(items.values()).filter(
    (item) => item.isSelected && !item.isDirectory && isImageFile(item.name)
  );
  const hasAnySelection = Array.from(items.values()).some((item) => item.isSelected);

  let command: string;
  if (hasAnySelection) {
    if (selectedImages.length === 0) {
      onSetError('No image files in the current selection. Select one or more image files to run OCR.');
      return;
    }
    const ocrCalls = selectedImages.map((img, i) => {
      const escapedImg = img.path.replace(/'/g, "'\\''");
      return `echo "--- OCR [${i + 1}/${selectedImages.length}]: ${img.name} ---" && ./ocr.sh '${escapedImg}'`;
    });
    command = `cd '${escapedOcrFolder}' && ${ocrCalls.join(' && ')}`;
  } else {
    const escapedPath = currentPath.replace(/'/g, "'\\''");
    command = `cd '${escapedOcrFolder}' && ./ocr.sh '${escapedPath}'`;
  }

  void (async () => {
    const result = await window.electronAPI.runInExternalTerminal(command);
    if (!result.success) {
      onSetError('Failed to launch OCR terminal: ' + (result.error ?? 'Unknown error'));
    }
  })();
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
  onSetError: (e: string) => void
): Promise<void> {
  if (!currentPath) return;

  const result = await pasteFromClipboard(
    currentPath,
    window.electronAPI.writeFileBinary,
    window.electronAPI.writeFile
  );

  if (result.success && result.fileName) {
    const filePath = joinPath(currentPath, result.fileName);
    setPendingScrollToFile(filePath);
    await window.electronAPI.reconcileIndexedFiles(currentPath, false);
    onRefreshDirectory();
    setTimeout(() => {
      setItemExpanded(filePath, true);
    }, 200);
  } else if (result.error) {
    onSetError(result.error);
  }
}
