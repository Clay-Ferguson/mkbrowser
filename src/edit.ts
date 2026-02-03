import type { ItemData } from './store/types';
import { splitFile as splitFileUtil, joinFiles as joinFilesUtil } from './utils/editUtil';

/**
 * Get the parent path (directory) of a given path
 */
function getParentPath(path: string): string {
  return path.substring(0, path.lastIndexOf('/'));
}

/**
 * Find cut items that come from different folders than the first cut item
 */
export function findCutItemsFromDifferentFolders(cutItems: ItemData[]): string[] {
  if (cutItems.length === 0) return [];

  const baseFolder = getParentPath(cutItems[0].path);

  return cutItems
    .filter((item) => getParentPath(item.path) !== baseFolder)
    .map((item) => item.name);
}

/**
 * Find which cut items would create duplicates in the destination folder
 */
export async function findPasteDuplicates(
  cutItems: ItemData[],
  destinationPath: string,
  pathExists: (path: string) => Promise<boolean>
): Promise<string[]> {
  const duplicateNames = await Promise.all(
    cutItems.map(async (item) => {
      const destPath = `${destinationPath}/${item.name}`;
      const exists = await pathExists(destPath);
      return exists ? item.name : null;
    })
  );

  return duplicateNames.filter((name): name is string => Boolean(name));
}

/**
 * Result of paste operation
 */
export interface PasteResult {
  success: boolean;
  error?: string;
  /** Name of the single pasted item (for scroll-to functionality) */
  pastedItemName?: string;
}

/**
 * Paste cut items to the destination folder
 */
export async function pasteCutItems(
  cutItems: ItemData[],
  destinationPath: string,
  pathExists: (path: string) => Promise<boolean>,
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>
): Promise<PasteResult> {
  if (cutItems.length === 0) {
    return { success: true };
  }

  // Check if pasting to the same folder
  const sourceFolder = getParentPath(cutItems[0].path);
  if (sourceFolder === destinationPath) {
    return { success: false, error: 'Cannot paste. Cut items are already in this folder.' };
  }

  // Check for items from different folders
  const crossFolderItems = findCutItemsFromDifferentFolders(cutItems);
  if (crossFolderItems.length > 0) {
    return {
      success: false,
      error: `Cannot paste. Cut items must come from the same folder: ${crossFolderItems.join(', ')}`,
    };
  }

  // Check for duplicates in destination
  const duplicates = await findPasteDuplicates(cutItems, destinationPath, pathExists);
  if (duplicates.length > 0) {
    return {
      success: false,
      error: `Cannot paste. These items already exist: ${duplicates.join(', ')}`,
    };
  }

  // Move each item
  for (const item of cutItems) {
    const newPath = `${destinationPath}/${item.name}`;
    const success = await renameFile(item.path, newPath);
    if (!success) {
      return { success: false, error: `Failed to move ${item.name}` };
    }
  }

  return {
    success: true,
    pastedItemName: cutItems.length === 1 ? cutItems[0].name : undefined,
  };
}

/**
 * Result of delete operation
 */
export interface DeleteResult {
  success: boolean;
  deletedPaths: string[];
  failedItem?: string;
}

/**
 * Delete selected items from the filesystem
 */
export async function deleteSelectedItems(
  selectedItems: ItemData[],
  deleteFile: (path: string) => Promise<boolean>
): Promise<DeleteResult> {
  if (selectedItems.length === 0) {
    return { success: true, deletedPaths: [] };
  }

  const deletedPaths: string[] = [];

  for (const item of selectedItems) {
    const success = await deleteFile(item.path);
    if (success) {
      deletedPaths.push(item.path);
    } else {
      return {
        success: false,
        deletedPaths,
        failedItem: item.name,
      };
    }
  }

  return { success: true, deletedPaths };
}

/**
 * Result of move-to-folder operation
 */
export interface MoveToFolderResult {
  success: boolean;
  error?: string;
  /** The path of the newly created folder */
  newFolderPath?: string;
}

/**
 * Move a file into a new folder with the same name (minus extension)
 * Creates a folder with the file's base name and moves the file into it.
 */
export async function moveFileToFolder(
  filePath: string,
  fileName: string,
  currentPath: string,
  pathExists: (path: string) => Promise<boolean>,
  createFolder: (path: string) => Promise<{ success: boolean; error?: string }>,
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>
): Promise<MoveToFolderResult> {
  // Get the file name without extension to use as folder name
  const lastDotIndex = fileName.lastIndexOf('.');
  const folderName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;

  // Build the new folder path in the current directory
  const newFolderPath = `${currentPath}/${folderName}`;

  // Check if folder already exists
  const folderExists = await pathExists(newFolderPath);
  if (folderExists) {
    return {
      success: false,
      error: `A file/folder named "${folderName}" already exists in this directory.`,
    };
  }

  // Create the new folder
  const folderResult = await createFolder(newFolderPath);
  if (!folderResult.success) {
    return {
      success: false,
      error: folderResult.error || `Failed to create folder "${folderName}".`,
    };
  }

  // Move the file into the new folder
  const newFilePath = `${newFolderPath}/${fileName}`;
  const moveSuccess = await renameFile(filePath, newFilePath);
  if (!moveSuccess) {
    return {
      success: false,
      error: `Failed to move "${fileName}" into the new folder.`,
    };
  }

  return { success: true, newFolderPath };
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
  readFile: (path: string) => Promise<string>,
  writeFile: (path: string, content: string) => Promise<boolean>,
  createFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>,
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>
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

  // Check that the file is a .txt or .md file
  const fileName = selectedItem.name.toLowerCase();
  if (!fileName.endsWith('.txt') && !fileName.endsWith('.md')) {
    return { success: false, error: 'Split is only available for text (.txt) and markdown (.md) files.' };
  }

  // Perform the split operation
  const result = await splitFileUtil(
    selectedItem.path,
    readFile,
    writeFile,
    createFile,
    renameFile
  );

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
  readFile: (path: string) => Promise<string>,
  writeFile: (path: string, content: string) => Promise<boolean>,
  deleteFile: (path: string) => Promise<boolean>,
  getFileSize: (path: string) => Promise<number>
): Promise<JoinFilesValidationResult> {
  // Check that multiple items are selected
  if (selectedItems.length < 2) {
    return { success: false, error: 'Please select at least two files to join.' };
  }

  // Check that all selected items are files (not folders) and are .txt or .md files
  for (const item of selectedItems) {
    if (item.isDirectory) {
      return { success: false, error: `Cannot join folders. "${item.name}" is a folder.` };
    }
    const fileName = item.name.toLowerCase();
    if (!fileName.endsWith('.txt') && !fileName.endsWith('.md')) {
      return { success: false, error: `Join is only available for text (.txt) and markdown (.md) files. "${item.name}" is not supported.` };
    }
  }

  // Get the file paths
  const filePaths = selectedItems.map(item => item.path);

  // Perform the join operation
  const result = await joinFilesUtil(
    filePaths,
    readFile,
    writeFile,
    deleteFile,
    getFileSize
  );

  if (!result.success) {
    return { success: false, error: result.error || 'Failed to join files.' };
  }

  return { success: true };
}
