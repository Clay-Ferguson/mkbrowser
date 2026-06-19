/**
 * Transactional file-splitting utility.
 *
 * `splitFile` divides a file on a blank-line delimiter into numbered parts
 * (`name-00.ext`, `name-01.ext`, …). Because it manipulates real user files, it
 * is written to be fail-safe: it validates and detects collisions before
 * touching the filesystem, and on any mid-operation failure it attempts a
 * best-effort rollback so the user's files are left as they were.
 */

import { getFileName, getParentPath, joinPath } from '../pathUtil';
import type { FileOps } from './fileOps';

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
 * newlines). The original file is renamed to include a "-00" suffix and the
 * remaining parts are written to new numbered files (e.g. my-file-00.md,
 * my-file-01.md, …).
 *
 * The operation is transactional in spirit: all targets are computed and checked
 * for collisions before any mutation, the new parts are created before the
 * original is renamed (so the original is the last thing touched), and any
 * failure triggers a best-effort rollback that deletes created parts and
 * restores the original filename.
 *
 * @param filePath - Full path to the file to split
 * @param ops - Injected file operations: `readFile`/`writeFile`/`createFile`/
 *   `renameFile` to mutate, `pathExists` for the collision check, and
 *   `deleteFile` for rollback.
 * @returns Result object with success status and file info
 */
export async function splitFile(
  filePath: string,
  ops: FileOps
): Promise<SplitFileResult> {
  const { readFile, writeFile, createFile, renameFile, pathExists, deleteFile } = ops;

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

  // Derive every target path up front: -00 (the renamed original) through -NN.
  const targetPaths = parts.map((_, i) => {
    const paddedNumber = String(i).padStart(2, '0');
    return joinPath(directory, `${baseName}-${paddedNumber}${extension}`);
  });
  const renamedFilePath = targetPaths[0];

  // Collision check: fail early with zero side effects if any target exists.
  for (const target of targetPaths) {
    try {
      if (await pathExists(target)) {
        return {
          success: false,
          error: `Cannot split: a file named "${getFileName(target)}" already exists.`,
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
  let renamed = false;

  /**
   * Best-effort rollback: delete any parts we created and restore the original
   * filename. Returns true only if every undo step succeeded.
   */
  const rollback = async (): Promise<boolean> => {
    let fullyRolledBack = true;
    if (renamed) {
      try {
        if (!(await renameFile(renamedFilePath, filePath))) fullyRolledBack = false;
      } catch {
        fullyRolledBack = false;
      }
    }
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
    // Create the new parts (-01 … -NN) first, so the original is untouched until
    // the very end.
    for (let i = 1; i < parts.length; i++) {
      const newFilePath = targetPaths[i];
      const result = await createFile(newFilePath, parts[i]);
      if (!result.success) {
        return await fail(result.error || `Failed to create file: ${getFileName(newFilePath)}`);
      }
      createdPaths.push(newFilePath);
    }

    // Rename the original to the -00 name. After this, rename preserves the full
    // original bytes, so a later failure can be fully undone.
    if (!(await renameFile(filePath, renamedFilePath))) {
      return await fail('Failed to rename the original file with -00 suffix.');
    }
    renamed = true;

    // Write the first part into the renamed file (the last mutation).
    const writeSuccess = await writeFile(renamedFilePath, parts[0]);
    if (!writeSuccess.ok) {
      return await fail('Failed to write the first part to the renamed file.');
    }

    return {
      success: true,
      fileCount: parts.length,
      filePaths: targetPaths,
    };
  } catch (err) {
    return await fail(
      err instanceof Error ? err.message : 'Unknown error occurred while splitting file.'
    );
  }
}
