/**
 * Transactional file-joining utility.
 *
 * `joinFiles` concatenates multiple files (sorted alphabetically) into the
 * alphabetically-first file, deleting the rest only after the write is verified.
 * The inverse of `splitFile` in `splitUtil.ts`.
 */

import { dump } from 'js-yaml';
import { parseFrontMatter } from '../shared/frontMatterUtil';
import { isMarkdownFile } from '../shared/fileTypes';
import { getFileName, getParentPath } from './pathUtil';
import type { FileOps } from '../shared/shared';

/**
 * For a markdown file being appended (not the lead file), strips its front
 * matter and converts it to a fenced YAML code block (removing the `id`
 * property). Returns the content ready to append.
 */
function prepareMarkdownForAppend(filePath: string, rawContent: string): string {
  if (!isMarkdownFile(getFileName(filePath))) return rawContent;

  const { yaml: frontMatter, content } = parseFrontMatter(rawContent);
  if (!frontMatter) return rawContent;

  // Remove the id property — it's no longer valid after the file is deleted
  const { id: _id, ...rest } = frontMatter as Record<string, unknown>;
  const yamlStr = dump(rest, { lineWidth: -1 }).trimEnd();
  const fencedBlock = '```yaml\n' + yamlStr + '\n```\n';
  return fencedBlock + content;
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
 * @param ops - Injected file operations: `readFile`, `writeFile`, and
 *   `deleteFile`.
 * @returns Result object with success status and info
 */
export async function joinFiles(
  filePaths: string[],
  ops: Pick<FileOps, 'readFile' | 'writeFile' | 'deleteFile'>
): Promise<JoinFilesResult> {
  const { readFile, writeFile, deleteFile } = ops;
  try {
    if (filePaths.length === 0) {
      return { success: false, error: 'No files were provided to join.' };
    }

    // All files must share a parent folder. The join writes into the
    // alphabetically-first *name* and deletes the rest, so a cross-folder set
    // would merge files out of (and delete them from) unrelated folders.
    const baseFolder = getParentPath(filePaths[0]!);
    const outsiders = filePaths.filter((p) => getParentPath(p) !== baseFolder);
    if (outsiders.length > 0) {
      return {
        success: false,
        error: 'Cannot join files from different folders. All selected files must be in the same folder.',
      };
    }

    // Sort file paths alphabetically by filename
    const sortedPaths = [...filePaths].sort((a, b) => {
      const nameA = getFileName(a);
      const nameB = getFileName(b);
      return nameA.localeCompare(nameB);
    });
    
    // Read all file contents; for appended files (not the lead), convert front matter to a fenced code block
    const contents: string[] = [];
    for (let i = 0; i < sortedPaths.length; i++) {
      const filePath = sortedPaths[i];
      const raw = await readFile(filePath!); 
      const content = i === 0 ? raw : prepareMarkdownForAppend(filePath!, raw); 
      contents.push(content);
    }
    
    // Concatenate with double blank line separator
    const joinedContent = contents.join('\n\n\n');

    // Write to the first file (alphabetically). Note that writeFile may
    // legitimately normalize/transform the content (e.g. markdown TOC expansion
    // or front-matter id injection), so it returns the exact bytes it wrote
    // back in `content`. We verify against that authoritative result, not
    // against joinedContent.
    const targetPath = sortedPaths[0];
    const writeSuccess = await writeFile(targetPath!, joinedContent); 
    if (!writeSuccess.ok) {
      return {
        success: false,
        error: 'Failed to write the joined content to the target file.',
      };
    }

    // Verify the write landed by reading the file back and comparing it to the
    // content the writer reported writing. (readFile returns '' on error, which
    // safely fails this comparison and preserves the source files.)
    const readBack = await readFile(targetPath!); 
    if (readBack !== writeSuccess.content) {
      return {
        success: false,
        error: 'File verification failed: the written file does not match the expected content. Files were NOT deleted to preserve data.',
      };
    }

    // Delete the other files (all except the first one)
    for (let i = 1; i < sortedPaths.length; i++) {
      const deleteSuccess = await deleteFile(sortedPaths[i]!); 
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
