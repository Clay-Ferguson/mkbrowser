/**
 * Shared AI conversation folder-name patterns.
 * Importable from both the main process and the renderer.
 */

/** Matches AI conversation folders: "A", "A1", "A2", etc. (case-sensitive) */
export const AI_FOLDER_REGEX = /^A\d*$/;

/** Matches Human conversation folders: "H", "H1", "H2", etc. (case-sensitive) */
export const HUMAN_FOLDER_REGEX = /^H\d*$/;

/** Returns true when `folderName` is an AI or Human conversation folder. */
export function isAiThreadFolder(folderName: string): boolean {
  return AI_FOLDER_REGEX.test(folderName) || HUMAN_FOLDER_REGEX.test(folderName);
}
