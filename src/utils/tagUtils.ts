/**
 * Tag utility module — loads tags for the TagsPicker by walking up the directory
 * tree from a file's location, reading `.TAGS.md` files at each level, and
 * extracting hashtags from their content.
 *
 * Tags are deduplicated and returned in the order they are first encountered
 * (closest directory first, then ancestors).
 */
import { HASHTAG_REGEX } from './hashtagRegex';

/**
 * Extract unique hashtags from a block of text.
 * Returns tags in the order they first appear, without duplicates.
 */
export function extractTagsFromText(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  let match;
  // Reset lastIndex in case regex was used before
  HASHTAG_REGEX.lastIndex = 0;
  while ((match = HASHTAG_REGEX.exec(text)) !== null) {
    const tag = match[0];
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

/** Result of an async tag-loading operation */
export type TagsLoadState =
  | { status: 'loading' }
  | { status: 'loaded'; tags: string[] };

/**
 * Load tags for a given file path by walking up ancestor directories
 * and collecting hashtags from `.TAGS.md` files.
 *
 * This calls the `collect-ancestor-tags` IPC which does the actual
 * filesystem work in the main process.
 *
 * @param filePath - Absolute path to the file being edited
 * @returns Array of unique hashtag strings (closest-first order)
 */
export async function loadTagsForFile(filePath: string): Promise<string[]> {
  return window.electronAPI.collectAncestorTags(filePath);
}

/**
 * Walk up the directory tree from the given file, reading `.TAGS.md` at each
 * level and collecting unique hashtags. Returns them sorted case-insensitively.
 *
 * This is the main-process implementation behind the `collect-ancestor-tags` IPC.
 */
export async function collectAncestorTags(filePath: string): Promise<string[]> {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const seen = new Set<string>();
  const tags: string[] = [];

  // Start from the directory containing the file
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;

  // Walk up the directory tree
  while (true) {
    const tagsFile = path.join(dir, '.TAGS.md');
    try {
      const content = await fs.promises.readFile(tagsFile, 'utf-8');
      for (const tag of extractTagsFromText(content)) {
        if (!seen.has(tag)) {
          seen.add(tag);
          tags.push(tag);
        }
      }
    } catch {
      // .TAGS.md doesn't exist at this level — that's fine, keep walking
    }

    // Stop at filesystem root
    if (dir === root || dir === path.dirname(dir)) break;
    dir = path.dirname(dir);
  }

  // Sort tags alphabetically (case-insensitive)
  tags.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  return tags;
}
