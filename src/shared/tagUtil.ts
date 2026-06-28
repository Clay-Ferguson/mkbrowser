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

export function getTagsFromYaml(yamlStr: string): string[] {
  try {
    const parsed = load(yamlStr) as Record<string, unknown> | null;
    if (!parsed || !Array.isArray(parsed.tags)) return [];
    return parsed.tags.filter((t): t is string => typeof t === 'string');
  } catch {
    return [];
  }
}

export function setTagsInYaml(yamlStr: string, tags: string[]): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = (load(yamlStr) as Record<string, unknown> | null) ?? {};
  } catch {
    parsed = {};
  }
  if (tags.length > 0) {
    parsed.tags = [...tags].sort((a, b) => a.localeCompare(b));
  } else {
    delete parsed.tags;
  }
  return Object.keys(parsed).length > 0 ? dump(parsed) : '';
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

/** Converts a TagCategory[] back to the canonical tags.yaml YAML string. */
export function serializeTagsToYaml(categories: TagCategory[]): string {
  const hashtags: Record<string, Record<string, { description: string }>> = {};
  for (const cat of categories) {
    hashtags[cat.name] = {};
    for (const tag of cat.tags) {
      const name = tagName(tag.tag);
      const desc = tag.description.trim();
      hashtags[cat.name][name] = { description: desc ? desc + '\n' : '\n' };
    }
  }
  return dump({ hashtags }, { lineWidth: -1 });
}
