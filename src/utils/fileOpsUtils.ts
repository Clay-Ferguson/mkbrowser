import type { ItemData } from '../store/types';
import type { FileEntry } from '../global';
import {
  deleteItems,
  clearAllSelections,
  clearAllCutItems,
  setHighlightItem,
  setPendingScrollToFile,
  setItemExpanded,
  setItemEditing,
} from '../store';
import { pasteCutItems, deleteSelectedItems, moveFileToFolder, performSplitFile, performJoinFiles } from '../edit';
import { pasteFromClipboard } from './clipboard';

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

  const sourceFolder = cutItems[0].path.substring(0, cutItems[0].path.lastIndexOf('/'));
  const movedPaths = cutItems.map((item) => item.path);
  deleteItems(movedPaths);
  clearAllCutItems();
  await Promise.all([
    window.electronAPI.reconcileIndexedFiles(sourceFolder, false),
    window.electronAPI.reconcileIndexedFiles(folderPath, false),
  ]);
  onRefreshDirectory();
}

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

export async function moveSelectedToFolder(
  currentPath: string,
  selectedItems: ItemData[],
  onSetError: (e: string) => void,
  onRefreshDirectory: () => void
): Promise<void> {
  if (selectedItems.length === 0) {
    onSetError('Please select a file to move to a folder.');
    return;
  }
  if (selectedItems.length > 1) {
    onSetError('Please select only one file for "Move to Folder".');
    return;
  }

  const selectedItem = selectedItems[0];

  if (selectedItem.isDirectory) {
    onSetError('Cannot use "Move to Folder" on a folder. Please select a file.');
    return;
  }

  const result = await moveFileToFolder(
    selectedItem.path,
    selectedItem.name,
    currentPath,
    window.electronAPI.pathExists,
    window.electronAPI.createFolder,
    window.electronAPI.renameFile
  );

  if (!result.success) {
    onSetError(result.error || 'Failed to move file to folder.');
    return;
  }

  clearAllSelections();
  deleteItems([selectedItem.path]);
  onRefreshDirectory();
}

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
  const filePath = `${currentPath}/${fileName}`;
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
  const folderPath = `${currentPath}/${folderName}`;
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
    const filePath = `${currentPath}/${result.fileName}`;
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
