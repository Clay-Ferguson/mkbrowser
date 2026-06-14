/**
 * Centralized special filenames and naming conventions used across both the
 * main process and the renderer. Keeping these in one place avoids typo-prone
 * duplication of the conventions (AI conversation files, attachment folders)
 * throughout the codebase.
 *
 * This module intentionally has no imports so it is safe to use from either
 * the main process or the renderer.
 */

/** Filename holding a human conversation turn. */
export const HUMAN_FILENAME = 'HUMAN.md';

/** Filename holding an AI conversation turn. */
export const AI_FILENAME = 'AI.md';

/** Filename holding AI "thinking" content, written alongside {@link AI_FILENAME}. */
export const THINK_FILENAME = 'THINK.md';

/** Suffix marking a hidden attachment folder (e.g. `foo.md.attach`). */
export const ATTACH_SUFFIX = '.attach';
