/**
 * Utility functions for edit operations (Split, etc.)
 */

export interface SplitFileResult {
  success: boolean;
  error?: string;
  /** Number of files created (including the original, which keeps the first part) */
  fileCount?: number;
  /** Paths of all files (original file first, then new files) */
  filePaths?: string[];
}

/**
 * Split a file into multiple files based on double-blank-line delimiter.
 * The delimiter is "\n\n\n" (or with optional \r after each \n).
 * The original file is renamed to include "-00" suffix, and subsequent parts
 * are written to new files with numbered suffixes (e.g., my-file-00.md, my-file-01.md, my-file-02.md).
 * 
 * @param filePath - Full path to the file to split
 * @param readFile - Function to read file content
 * @param writeFile - Function to write file content
 * @param createFile - Function to create a new file
 * @param renameFile - Function to rename a file
 * @returns Result object with success status and file info
 */
export async function splitFile(
  filePath: string,
  readFile: (path: string) => Promise<string>,
  writeFile: (path: string, content: string) => Promise<boolean>,
  createFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>,
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>
): Promise<SplitFileResult> {
  try {
    // Read the file content
    const content = await readFile(filePath);
    
    // Split using double-blank-line as delimiter
    // The regex matches \n\n\n with optional \r after each \n
    const parts = content.split(/\n\r?\n\r?\n\r?/);
    
    // If there's only one part, nothing to split
    if (parts.length <= 1) {
      return {
        success: false,
        error: 'File does not contain any split points (double blank lines).',
      };
    }
    
    // Parse the file path to get directory, base name, and extension
    const lastSlashIndex = filePath.lastIndexOf('/');
    const directory = lastSlashIndex >= 0 ? filePath.substring(0, lastSlashIndex) : '';
    const fileName = lastSlashIndex >= 0 ? filePath.substring(lastSlashIndex + 1) : filePath;
    
    const lastDotIndex = fileName.lastIndexOf('.');
    const baseName = lastDotIndex >= 0 ? fileName.substring(0, lastDotIndex) : fileName;
    const extension = lastDotIndex >= 0 ? fileName.substring(lastDotIndex) : '';
    
    // Build the new path for the original file with "-00" suffix
    const renamedFileName = `${baseName}-00${extension}`;
    const renamedFilePath = directory ? `${directory}/${renamedFileName}` : renamedFileName;
    
    // Rename the original file to include "-00" suffix
    const renameSuccess = await renameFile(filePath, renamedFilePath);
    if (!renameSuccess) {
      return {
        success: false,
        error: 'Failed to rename the original file with -00 suffix.',
      };
    }
    
    // Write the first part to the renamed file
    const writeSuccess = await writeFile(renamedFilePath, parts[0]);
    if (!writeSuccess) {
      return {
        success: false,
        error: 'Failed to write the first part to the renamed file.',
      };
    }
    
    const filePaths: string[] = [renamedFilePath];
    
    // Create new files for the remaining parts (starting at -01)
    for (let i = 1; i < parts.length; i++) {
      // Format the number with zero-padding (2 digits)
      const paddedNumber = String(i).padStart(2, '0');
      const newFileName = `${baseName}-${paddedNumber}${extension}`;
      const newFilePath = directory ? `${directory}/${newFileName}` : newFileName;
      
      const result = await createFile(newFilePath, parts[i]);
      if (!result.success) {
        return {
          success: false,
          error: result.error || `Failed to create file: ${newFileName}`,
        };
      }
      
      filePaths.push(newFilePath);
    }
    
    return {
      success: true,
      fileCount: parts.length,
      filePaths,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred while splitting file.',
    };
  }
}

export interface JoinFilesResult {
  success: boolean;
  error?: string;
  /** Path of the resulting joined file */
  resultPath?: string;
  /** Number of files that were joined */
  filesJoined?: number;
}

/**
 * Join multiple files into a single file using double-blank-line as separator.
 * Files are sorted alphabetically, concatenated with '\n\n\n' between parts,
 * and the result is written to the alphabetically first file.
 * Other files are deleted only after verifying the write succeeded.
 * 
 * @param filePaths - Array of file paths to join
 * @param readFile - Function to read file content
 * @param writeFile - Function to write file content
 * @param deleteFile - Function to delete a file
 * @param getFileSize - Function to get file size in bytes
 * @returns Result object with success status and info
 */
export async function joinFiles(
  filePaths: string[],
  readFile: (path: string) => Promise<string>,
  writeFile: (path: string, content: string) => Promise<boolean>,
  deleteFile: (path: string) => Promise<boolean>,
  getFileSize: (path: string) => Promise<number>
): Promise<JoinFilesResult> {
  try {
    // Sort file paths alphabetically by filename
    const sortedPaths = [...filePaths].sort((a, b) => {
      const nameA = a.substring(a.lastIndexOf('/') + 1);
      const nameB = b.substring(b.lastIndexOf('/') + 1);
      return nameA.localeCompare(nameB);
    });
    
    // Read all file contents
    const contents: string[] = [];
    for (const filePath of sortedPaths) {
      const content = await readFile(filePath);
      contents.push(content);
    }
    
    // Concatenate with double blank line separator
    const joinedContent = contents.join('\n\n\n');
    
    // Calculate expected byte size (UTF-8)
    const expectedByteSize = new TextEncoder().encode(joinedContent).length;
    
    // Write to the first file (alphabetically)
    const targetPath = sortedPaths[0];
    const writeSuccess = await writeFile(targetPath, joinedContent);
    if (!writeSuccess) {
      return {
        success: false,
        error: 'Failed to write the joined content to the target file.',
      };
    }
    
    // Verify the file was written correctly by checking its size
    const actualByteSize = await getFileSize(targetPath);
    if (actualByteSize !== expectedByteSize) {
      return {
        success: false,
        error: `File verification failed: expected ${expectedByteSize} bytes but file has ${actualByteSize} bytes. Files were NOT deleted to preserve data.`,
      };
    }
    
    // Delete the other files (all except the first one)
    for (let i = 1; i < sortedPaths.length; i++) {
      const deleteSuccess = await deleteFile(sortedPaths[i]);
      if (!deleteSuccess) {
        return {
          success: false,
          error: `Failed to delete file: ${sortedPaths[i]}. Some files may remain.`,
        };
      }
    }
    
    return {
      success: true,
      resultPath: targetPath,
      filesJoined: sortedPaths.length,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred while joining files.',
    };
  }
}
