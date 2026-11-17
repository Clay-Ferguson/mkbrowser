/**
 * Folder analysis module - scans a folder recursively for .md and .txt files and
 * counts two kinds of tags separately:
 *  - Content hashtags: `#foo` written in the body text (after any front matter).
 *  - Properties tags: names in the front matter `tags` list (stored without `#`).
 *
 * This module handles the main-process side of the folder analysis feature.
 * It uses fdir for recursive directory crawling.
 *
 * See: (USER_GUIDE.md#folder-analysis)
 */
import path from 'node:path';
import fs from 'node:fs';
import { fdir } from 'fdir';
import { HASHTAG_REGEX } from '../shared/regexPatterns';
import { buildExcludePredicate } from '../shared/pathPattern';
import { splitFrontMatter } from '../shared/frontMatterUtil';
import { getTagsFromYaml } from '../shared/tagUtil';
import type { FolderAnalysisResult } from '../shared/shared';

/** Map of tag -> count, as an array sorted by count (descending), then name. */
function toSortedEntries(counts: Map<string, number>): Array<{ tag: string; count: number }> {
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Adds one file's tags to the running counts: every content hashtag occurrence in
 * the body, and each distinct front matter tag once (properties tags count files).
 */
function countFileTags(content: string, hashtagCounts: Map<string, number>, propertyTagCounts: Map<string, number>): void {
  const parts = splitFrontMatter(content);
  const body = parts ? parts.body : content;
  // A private copy: HASHTAG_REGEX is a shared /g regex with mutable lastIndex.
  for (const m of body.matchAll(new RegExp(HASHTAG_REGEX.source, 'g'))) {
    hashtagCounts.set(m[0], (hashtagCounts.get(m[0]) ?? 0) + 1);
  }
  if (parts) {
    for (const tag of new Set(getTagsFromYaml(parts.yamlStr))) {
      propertyTagCounts.set(tag, (propertyTagCounts.get(tag) ?? 0) + 1);
    }
  }
}

/**
 * Scan a folder recursively for tags in .md and .txt files.
 * 
 * @param folderPath   - Root folder to scan
 * @param ignoredPaths - Array of path patterns to exclude (supports wildcards)
 * @returns FolderAnalysisResult with content hashtag occurrence counts, properties
 *   tag file counts, and total files scanned
 *
 * See: (USER_GUIDE.md#what-gets-scanned)
 */
export async function analyzeFolderHashtags(
  folderPath: string,
  ignoredPaths: string[] = [],
): Promise<FolderAnalysisResult> {
  const shouldExcludePath = buildExcludePredicate(ignoredPaths);
  const hashtagCounts = new Map<string, number>();
  const propertyTagCounts = new Map<string, number>();

  // Use fdir to recursively find .md and .txt files
  const api = new fdir()
    .withFullPaths()
    .exclude((dirName, dirPath) => shouldExcludePath(dirName, dirPath))
    .filter((filePath) => {
      const fileName = path.basename(filePath);
      if (shouldExcludePath(fileName, filePath)) return false;
      const ext = path.extname(filePath).toLowerCase();
      return ext === '.md' || ext === '.txt';
    })
    .crawl(folderPath);

  const files = await api.withPromise();

  for (const filePath of files) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      countFileTags(content, hashtagCounts, propertyTagCounts);
    } catch {
      // Skip files that can't be read (permissions, encoding, etc.)
    }
  }

  return {
    hashtags: toSortedEntries(hashtagCounts),
    propertyTags: toSortedEntries(propertyTagCounts),
    totalFiles: files.length,
  };
}
