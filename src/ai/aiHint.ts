/**
 * Helper for extracting a short preview snippet from an AI conversation
 * folder (an "H*" or "A*" folder containing HUMAN.md / AI.md).  Used to hint
 * at a folder's contents in the UI without the user having to drill into it.
 *
 * Main-process only — imports 'node:fs'.  Keep renderer-safe pattern matching
 * in ./aiPatterns instead.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { AI_FOLDER_REGEX, HUMAN_FOLDER_REGEX } from './aiPatterns';
import { HUMAN_FILENAME, AI_FILENAME } from '../utils/specialFiles';

/** Max length of the preview snippet shown next to a conversation folder. */
export const AI_HINT_MAX_LENGTH = 120;

/**
 * Read a short preview snippet from the HUMAN.md / AI.md file inside an AI
 * conversation folder.  Returns undefined when folderName is not a
 * conversation folder or the file can't be read.
 *
 * @param folderPath Absolute path to the conversation folder.
 * @param folderName The folder's name (used to decide HUMAN.md vs AI.md).
 */
export async function readAiHint(
  folderPath: string,
  folderName: string,
): Promise<string | undefined> {
  let hintFile: string | undefined;
  if (HUMAN_FOLDER_REGEX.test(folderName)) {
    hintFile = HUMAN_FILENAME;
  } else if (AI_FOLDER_REGEX.test(folderName)) {
    hintFile = AI_FILENAME;
  }
  if (!hintFile) return undefined;

  try {
    const content = await fs.readFile(path.join(folderPath, hintFile), 'utf8');
    return content.slice(0, AI_HINT_MAX_LENGTH).trim();
  } catch {
    // File doesn't exist or can't be read — no hint
    return undefined;
  }
}
