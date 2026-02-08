/**
 * Tag utility module — loads tags for the TagsPicker by walking up the directory
 * tree from a file's location, reading `.TAGS.md` files at each level, and
 * extracting hashtags from their content.
 *
 * Tags are deduplicated and returned in the order they are first encountered
 * (closest directory first, then ancestors).
 */

/**
 * Regex for extracting hashtags from text content.
 * Matches # followed by an alphanumeric character then optional alphanumeric,
 * underscores, or hyphens. Consistent with HASHTAG_REGEX in folderAnalysis.ts.
 */
const HASHTAG_REGEX = /#[a-zA-Z0-9][a-zA-Z0-9_-]*/g;

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
