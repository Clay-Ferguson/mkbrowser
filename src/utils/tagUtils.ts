import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

/** A single hashtag definition. `tag` always includes the `#` prefix (e.g. `"#cooking"`). */
export interface HashtagDefinition {
  tag: string;
  description: string;
}

/** A named group of hashtags as defined in `tags.yaml`. */
export interface TagCategory {
  name: string;
  tags: HashtagDefinition[];
}

/** Result of an async tag-loading operation */
export type TagsLoadState =
  | { status: 'loading' }
  | { status: 'loaded'; categories: TagCategory[] };

/** Calls the main-process IPC to load tags from the config folder. */
export async function fetchTags(): Promise<TagCategory[]> {
  return window.electronAPI.loadTags();
}

/**
 * Read `tags.yaml` from `configDir` and return tag categories.
 * Returns an empty array if the file does not exist.
 *
 * Expected YAML format:
 * ```yaml
 * hashtags:
 *   category:
 *     trip:
 *       description: Full travel itineraries.
 *   type:
 *     todo:
 *       description: Current tasks.
 * ```
 * Top-level keys under `hashtags` are group names; their children are tag names.
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

export async function loadTags(configDir: string): Promise<TagCategory[]> {
  const tagsFile = path.join(configDir, 'tags.yaml');
  let content: string;
  try {
    content = await fs.promises.readFile(tagsFile, 'utf-8');
  } catch {
    return [];
  }

  type RawTags = Record<string, { description?: string } | null>;
  type RawFile = { hashtags?: Record<string, RawTags | null> };
  const parsed = yaml.load(content) as RawFile | null;
  const hashtags = parsed?.hashtags;
  if (!hashtags || typeof hashtags !== 'object') return [];

  return Object.entries(hashtags).map(([groupName, groupTags]) => ({
    name: groupName,
    tags: Object.entries(groupTags ?? {}).map(([tagKey, tagVal]) => ({
      tag: `#${tagKey}`,
      description: (tagVal?.description ?? '').trim(),
    })).sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' })),
  }));
}
