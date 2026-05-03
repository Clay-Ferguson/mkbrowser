import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

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
 * `description` is the multi-line description shown as a tooltip.
 * `group` (optional) identifies a set of mutually exclusive tags.
 */
export interface HashtagDefinition {
  tag: string;
  description: string;
  group?: string;
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
 *   cooking:
 *     description: |
 *       Use this for all culinary posts.
 *     group: category
 *   travel:
 *     description: |
 *       Reserved for international trips.
 * ```
 * Keys are plain tag names (without `#`); the `#` prefix is added automatically.
 * `group` is optional — omit it for tags that don't belong to a mutually exclusive set.
 */
export function tagName(tag: string): string {
  return tag.startsWith('#') ? tag.slice(1) : tag;
}

export function splitFrontMatter(text: string): { yamlStr: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text);
  return match ? { yamlStr: match[1], body: text.slice(match[0].length) } : null;
}

export function getTagsFromYaml(yamlStr: string): string[] {
  const parsed = yaml.load(yamlStr) as Record<string, unknown> | null;
  if (!parsed || !Array.isArray(parsed.tags)) return [];
  return parsed.tags.filter((t): t is string => typeof t === 'string');
}

export function setTagsInYaml(yamlStr: string, tags: string[]): string {
  const parsed = (yaml.load(yamlStr) as Record<string, unknown> | null) ?? {};
  if (tags.length > 0) {
    parsed.tags = tags;
  } else {
    delete parsed.tags;
  }
  return Object.keys(parsed).length > 0 ? yaml.dump(parsed) : '';
}

export function assembleFrontMatter(yamlContent: string, body: string): string {
  const trimmed = yamlContent.trim();
  return trimmed ? `---\n${trimmed}\n---\n${body}` : body;
}

export function removeTagFromText(text: string, tag: string): string {
  const parts = splitFrontMatter(text);
  if (!parts) return text;
  const updated = getTagsFromYaml(parts.yamlStr).filter(t => t !== tagName(tag));
  return assembleFrontMatter(setTagsInYaml(parts.yamlStr, updated), parts.body);
}

export function insertTagIntoText(text: string, tag: string): string {
  const name = tagName(tag);
  const parts = splitFrontMatter(text);
  if (parts) {
    const current = getTagsFromYaml(parts.yamlStr);
    if (current.includes(name)) return text;
    return assembleFrontMatter(setTagsInYaml(parts.yamlStr, [...current, name]), parts.body);
  }
  return assembleFrontMatter(`tags:\n  - ${name}`, text);
}

export async function collectAncestorTags(filePath: string): Promise<HashtagDefinition[]> {
  const map = new Map<string, HashtagDefinition>();

  // Start from the directory containing the file
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;

  // Walk up the directory tree
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const tagsFile = path.join(dir, '.TAGS.yaml');
    try {
      const content = await fs.promises.readFile(tagsFile, 'utf-8');
      const parsed = yaml.load(content) as { hashtags?: Record<string, unknown> } | null;
      const hashtags = parsed?.hashtags;
      if (hashtags && typeof hashtags === 'object') {
        for (const [key, value] of Object.entries(hashtags)) {
          const tag = `#${key}`;
          let description = '';
          let group: string | undefined;
          if (typeof value === 'object' && value !== null) {
            const v = value as Record<string, unknown>;
            description = typeof v.description === 'string' ? v.description.trim() : '';
            group = typeof v.group === 'string' ? v.group : undefined;
          }
          map.set(tag, { tag, description, group });
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
