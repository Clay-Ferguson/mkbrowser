import { load, dump } from 'js-yaml';
import { splitFrontMatter, assembleFrontMatter } from './frontMatterUtil';

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

/** Strips a leading `#` from a hashtag, returning the bare tag name. */
export function tagName(tag: string): string {
  return tag.startsWith('#') ? tag.slice(1) : tag;
}

/**
 * Reports whether a raw YAML string can be parsed by js-yaml. Empty/whitespace
 * front matter counts as parseable. Callers use this to refuse a tag edit (and
 * warn the user) rather than silently discarding front matter js-yaml rejects —
 * js-yaml 4.x throws on more than malformed syntax (e.g. duplicated mapping keys).
 */
export function isYamlParseable(yamlStr: string): boolean {
  try {
    load(yamlStr);
    return true;
  } catch {
    return false;
  }
}

/** Parses the `tags` array from a raw YAML string, returning bare tag names (no `#`). Returns `[]` on parse error or missing tags. */
export function getTagsFromYaml(yamlStr: string): string[] {
  try {
    const parsed = load(yamlStr) as Record<string, unknown> | null;
    if (!parsed || !Array.isArray(parsed.tags)) return [];
    // Coerce scalar entries (numbers/booleans a user typed unquoted, e.g. `- 2024`)
    // to strings so a tag toggle doesn't silently drop them from the rewritten list.
    // Non-scalar entries (maps/sequences/null) are not meaningful tags and are skipped.
    return parsed.tags
      .filter(t => typeof t === 'string' || typeof t === 'number' || typeof t === 'boolean')
      .map(t => String(t));
  } catch {
    return [];
  }
}

/**
 * Serialize `tags` back into a YAML string, replacing any existing `tags` key.
 * Tags are stored sorted alphabetically. If `tags` is empty the key is omitted.
 * Returns an empty string when the resulting document would be empty.
 */
export function setTagsInYaml(yamlStr: string, tags: string[]): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = (load(yamlStr) as Record<string, unknown> | null) ?? {};
  } catch {
    // Refuse to edit: return the original string untouched rather than
    // proceeding with `{}`, which would wipe every existing front-matter
    // property. Callers should guard with isYamlParseable() to warn the user.
    return yamlStr;
  }
  if (tags.length > 0) {
    parsed.tags = [...tags].sort((a, b) => a.localeCompare(b));
  } else {
    delete parsed.tags;
  }
  return Object.keys(parsed).length > 0 ? dump(parsed, { lineWidth: -1 }) : '';
}

/** Removes a tag from a markdown document's front matter, leaving the rest unchanged. */
export function removeTagFromText(text: string, tag: string): string {
  const parts = splitFrontMatter(text);
  if (!parts) return text;
  const updated = getTagsFromYaml(parts.yamlStr).filter(t => t !== tagName(tag));
  return assembleFrontMatter(setTagsInYaml(parts.yamlStr, updated), parts.body);
}

/**
 * Inserts a tag into a markdown document's front matter. If the tag is already
 * present the document is returned unchanged. If there is no front matter block
 * one is created containing only the tags list.
 */
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

/** Converts a TagCategory[] back to the canonical tags.yaml YAML string. */
export function serializeTagsToYaml(categories: TagCategory[]): string {
  const hashtags: Record<string, Record<string, { description: string }>> = {};
  for (const cat of categories) {
    const catMap: Record<string, { description: string }> = {};
    hashtags[cat.name] = catMap;
    for (const tag of cat.tags) {
      const name = tagName(tag.tag);
      const desc = tag.description.trim();
      catMap[name] = { description: desc ? desc + '\n' : '\n' };
    }
  }
  return dump({ hashtags }, { lineWidth: -1 });
}
