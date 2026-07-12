/**
 * Transactional file-splitting utility.
 *
 * `splitFile` divides a file on a blank-line delimiter into numbered parts
 * (`name-00.ext`, `name-01.ext`, …). Because it manipulates real user files, it
 * is written to be fail-safe: it validates and detects collisions before
 * touching the filesystem, only ever *adds* files until every part is safely on
 * disk (the original is deleted last, never written through), and on any
 * mid-operation failure it attempts a best-effort rollback so the user's files
 * are left as they were.
 */

import { getFileName, getParentPath, joinPath } from './pathUtil';
import type { FileOps } from '../shared/shared';

/**
 * Delimiter between parts: a run of 3 or more line breaks (each optionally
 * `\r\n`). Collapsing runs of 3+ avoids leaving stray newlines on the following
 * part, and round-trips cleanly with `joinFiles`, which joins parts with
 * `'\n\n\n'`.
 */
const SPLIT_DELIMITER = /(?:\r?\n){3,}/;

export interface SplitFileResult {
  success: boolean;
  error?: string;
  /** Number of files created (including the original, which keeps the first part) */
  fileCount?: number;
  /** Paths of all files (original file first, then new files) */
  filePaths?: string[];
}

/**
 * Split a file into multiple files based on a blank-line delimiter (a run of 3+
 * newlines). Every part — including the first — is written to a new numbered
 * file (e.g. my-file-00.md, my-file-01.md, …) and the original file is deleted
 * once they all exist.
 *
 * The operation is transactional in spirit: all targets are computed and checked
 * for collisions before any mutation, every part is created as a *new* file (the
 * original is never written through, so its bytes stay intact on disk until the
 * very last step), and any failure triggers a best-effort rollback that deletes
 * the parts created so far, leaving the original as it was.
 *
 * @param filePath - Full path to the file to split
 * @param ops - Injected file operations: `readFile` to load the original,
 *   `createFile` to write each part, `pathExists` for the collision check, and
 *   `deleteFile` to remove the original (and to roll back on failure).
 * @returns Result object with success status and file info
 */
export async function splitFile(
  filePath: string,
  ops: Pick<FileOps, 'readFile' | 'createFile' | 'pathExists' | 'deleteFile'>
): Promise<SplitFileResult> {
  const { readFile, createFile, pathExists, deleteFile } = ops;

  // ---- Phase 1: validate and compute everything before mutating anything ----

  let parts: string[];
  let directory: string;
  let baseName: string;
  let extension: string;
  try {
    const content = await readFile(filePath);

    // Split on the blank-line delimiter, dropping empty/whitespace-only parts so
    // a leading or trailing delimiter does not produce empty files. Non-empty
    // parts are kept verbatim (their content is not trimmed).
    parts = content.split(SPLIT_DELIMITER).filter((p) => p.trim().length > 0);

    if (parts.length <= 1) {
      return {
        success: false,
        error: 'File does not contain any split points (double blank lines).',
      };
    }

    directory = getParentPath(filePath);
    const fileName = getFileName(filePath);
    const lastDotIndex = fileName.lastIndexOf('.');
    baseName = lastDotIndex >= 0 ? fileName.substring(0, lastDotIndex) : fileName;
    extension = lastDotIndex >= 0 ? fileName.substring(lastDotIndex) : '';
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred while splitting file.',
    };
  }

  // Pair every part with its target path up front: -00 (the renamed original)
  // through -NN.
  const targets = parts.map((content, i) => {
    const paddedNumber = String(i).padStart(2, '0');
    return { content, path: joinPath(directory, `${baseName}-${paddedNumber}${extension}`) };
  });
  // Collision check: fail early with zero side effects if any target exists.
  for (const target of targets) {
    try {
      if (await pathExists(target.path)) {
        return {
          success: false,
          error: `Cannot split: a file named "${getFileName(target.path)}" already exists.`,
        };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to check for existing files before splitting.',
      };
    }
  }

  // ---- Phase 2: mutate, tracking what was done so it can be undone ----

  const createdPaths: string[] = [];

  /**
   * Best-effort rollback: delete any parts we created. The original is never
   * modified before the final delete, so undoing the parts restores the starting
   * state. Returns true only if every undo step succeeded.
   */
  const rollback = async (): Promise<boolean> => {
    let fullyRolledBack = true;
    for (const created of createdPaths) {
      try {
        if (!(await deleteFile(created))) fullyRolledBack = false;
      } catch {
        fullyRolledBack = false;
      }
    }
    return fullyRolledBack;
  };

  /** Build a failure result, attempting rollback and reporting its outcome. */
  const fail = async (error: string): Promise<SplitFileResult> => {
    const fullyRolledBack = await rollback();
    return {
      success: false,
      error: fullyRolledBack
        ? `${error} (changes rolled back)`
        : `${error} (WARNING: rollback incomplete — some files may remain)`,
    };
  };

  try {
    // Create every part (-00 … -NN) as a brand new file. The original is never
    // written through, so the full original bytes remain on disk — recoverable
    // by rollback — until every part has been created successfully.
    for (const { content, path: newFilePath } of targets) {
      const result = await createFile(newFilePath, content);
      if (!result.success) {
        return await fail(result.error || `Failed to create file: ${getFileName(newFilePath)}`);
      }
      createdPaths.push(newFilePath);
    }

    // All parts exist; the original is now redundant. Deleting it is the last
    // and only destructive mutation.
    if (!(await deleteFile(filePath))) {
      return await fail('Failed to delete the original file after creating the parts.');
    }

    return {
      success: true,
      fileCount: parts.length,
      filePaths: targets.map((t) => t.path),
    };
  } catch (err) {
    return await fail(
      err instanceof Error ? err.message : 'Unknown error occurred while splitting file.'
    );
  }
}
