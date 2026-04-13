/**
 * Shared AI conversation folder-name patterns.
 * Importable from both the main process and the renderer.
 *
 * NOTE: This file must NOT import Node.js modules (e.g. 'node:fs') because
 * it is also bundled into the renderer (browser) process.
 */

/** Matches AI conversation folders: "A", "A1", "A2", etc. (case-sensitive) */
export const AI_FOLDER_REGEX = /^A\d*$/;

/** Matches Human conversation folders: "H", "H1", "H2", etc. (case-sensitive) */
export const HUMAN_FOLDER_REGEX = /^H\d*$/;

import type { FileEntry } from '../global';

/** Returns true when the loaded entries contain a HUMAN.md or AI.md file. */
export function isAiThreadByEntries(entries: FileEntry[]): boolean {
  return entries.some(e => e.name === 'HUMAN.md' || e.name === 'AI.md');
}

/** Returns true when the loaded entries contain a HUMAN.md file. */
export function hasHumanMd(entries: FileEntry[]): boolean {
  return entries.some(e => e.name === 'HUMAN.md');
}
