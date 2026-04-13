/**
 * Tag utility module — loads tags for the TagsPicker by walking up the directory
 * tree from a file's location, reading `.TAGS.yaml` files at each level, and
 * building a map of hashtag definitions from their content.
 *
 * Tags are returned sorted alphabetically (case-insensitive). When the same tag
 * key appears in multiple files, the last file encountered (furthest ancestor)
 * wins.
 */

/**
 * A single hashtag definition loaded from a `.TAGS.yaml` file.
 * `tag` always includes the `#` prefix (e.g. `"#cooking"`).
 * `description` is the multi-line description from the YAML value.
 */
export interface HashtagDefinition {
  tag: string;
  description: string;
}

/** Result of an async tag-loading operation */
export type TagsLoadState =
  | { status: 'loading' }
  | { status: 'loaded'; tags: HashtagDefinition[] };

/**
 * Load tags for a given file path by walking up ancestor directories
 * and collecting hashtag definitions from `.TAGS.yaml` files.
 *
 * This calls the `collect-ancestor-tags` IPC which does the actual
 * filesystem work in the main process.
 *
 * @param filePath - Absolute path to the file being edited
 * @returns Array of unique `HashtagDefinition` objects sorted alphabetically
 */
export async function loadTagsForFile(filePath: string): Promise<HashtagDefinition[]> {
  return window.electronAPI.collectAncestorTags(filePath);
}

/**
 * Walk up the directory tree from the given file, reading `.TAGS.yaml` at each
 * level and collecting hashtag definitions. Returns them sorted case-insensitively.
 *
 * This is the main-process implementation behind the `collect-ancestor-tags` IPC.
 *
 * Expected YAML format:
 * ```yaml
 * hashtags:
 *   cooking: |
 *     Use this for all culinary posts.
 *   travel: |
 *     Reserved for international trips.
 * ```
 * Keys are plain tag names (without `#`); the `#` prefix is added automatically.
 */
export async function collectAncestorTags(filePath: string): Promise<HashtagDefinition[]> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const yaml = await import('js-yaml');

  const map = new Map<string, HashtagDefinition>();

  // Start from the directory containing the file
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;

  // Walk up the directory tree
  while (true) {
    const tagsFile = path.join(dir, '.TAGS.yaml');
    try {
      const content = await fs.promises.readFile(tagsFile, 'utf-8');
      const parsed = yaml.load(content) as { hashtags?: Record<string, unknown> } | null;
      const hashtags = parsed?.hashtags;
      if (hashtags && typeof hashtags === 'object') {
        for (const [key, value] of Object.entries(hashtags)) {
          const tag = `#${key}`;
          map.set(tag, { tag, description: typeof value === 'string' ? value : '' });
        }
      }
    } catch {
      // .TAGS.yaml doesn't exist at this level — that's fine, keep walking
    }

    // Stop at filesystem root
    if (dir === root || dir === path.dirname(dir)) break;
    dir = path.dirname(dir);
  }

  // Sort tags alphabetically (case-insensitive)
  return Array.from(map.values()).sort((a, b) =>
    a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' })
  );
}
