import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import type { TagCategory } from '../shared/tagUtil';

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
 *
 * MAIN PROCESS ONLY — uses `node:fs`.
 */
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
  const parsed = load(content) as RawFile | null;
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
