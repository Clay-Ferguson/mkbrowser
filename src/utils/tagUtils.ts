import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

/**
 * A single hashtag definition loaded from the `tags.yaml` file.
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

/** Calls the main-process IPC to load tags from the config folder. */
export async function fetchTags(): Promise<HashtagDefinition[]> {
  return window.electronAPI.loadTags();
}

/**
 * Read `tags.yaml` from `configDir` and return its hashtag definitions sorted
 * alphabetically (case-insensitive). Returns an empty array if the file does not exist.
 *
 * This is the main-process implementation behind the `load-tags` IPC.
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
  try {
    const parsed = yaml.load(yamlStr) as Record<string, unknown> | null;
    if (!parsed || !Array.isArray(parsed.tags)) return [];
    return parsed.tags.filter((t): t is string => typeof t === 'string');
  } catch {
    return [];
  }
}

/** Returns all front matter properties except 'tags', preserving their parsed types. */
export function getPropsFromYaml(yamlStr: string): Record<string, unknown> {
  try {
    const parsed = yaml.load(yamlStr) as Record<string, unknown> | null;
    if (!parsed) return {};
    const { tags: _tags, ...rest } = parsed;
    return rest;
  } catch {
    return {};
  }
}

export function setTagsInYaml(yamlStr: string, tags: string[]): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = (yaml.load(yamlStr) as Record<string, unknown> | null) ?? {};
  } catch {
    parsed = {};
  }
  if (tags.length > 0) {
    parsed.tags = [...tags].sort((a, b) => a.localeCompare(b));
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

export async function loadTags(configDir: string): Promise<HashtagDefinition[]> {
  const tagsFile = path.join(configDir, 'tags.yaml');
  let content: string;
  try {
    content = await fs.promises.readFile(tagsFile, 'utf-8');
  } catch {
    return [];
  }

  const parsed = yaml.load(content) as { hashtags?: Record<string, unknown> } | null;
  const hashtags = parsed?.hashtags;
  if (!hashtags || typeof hashtags !== 'object') return [];

  const results: HashtagDefinition[] = [];
  for (const [key, value] of Object.entries(hashtags)) {
    const tag = `#${key}`;
    let description = '';
    let group: string | undefined;
    if (typeof value === 'object' && value !== null) {
      const v = value as Record<string, unknown>;
      description = typeof v.description === 'string' ? v.description.trim() : '';
      group = typeof v.group === 'string' ? v.group : undefined;
    }
    results.push({ tag, description, group });
  }

  return results.sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }));
}
