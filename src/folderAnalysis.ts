/**
 * Folder analysis module - scans a folder recursively for hashtags in .md and .txt files.
 * 
 * This module handles the main-process side of the folder analysis feature.
 * It uses fdir for recursive directory crawling and extracts hashtags from file content.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fdir } from 'fdir';

/**
 * Result of a folder analysis scan
 */
export interface FolderAnalysisResult {
  /** Array of hashtag entries with tag name and count */
  hashtags: Array<{ tag: string; count: number }>;
  /** Total number of files that were scanned */
  totalFiles: number;
}

/**
 * Regex for extracting hashtags from text content.
 * Matches # followed by alphanumeric characters, underscores, dots, or hyphens.
 * Must start with a letter or number after the # (not a symbol).
 */
const HASHTAG_REGEX = /#[a-zA-Z0-9][a-zA-Z0-9_-]*/g;

/**
 * Build the exclude predicate from an array of ignored path patterns.
 * Patterns support wildcards via `*`.
 */
function buildExcludePredicate(ignoredPaths: string[]): (name: string, fullPath: string) => boolean {
  const ignoredPatterns = ignoredPaths.map(pattern => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\/]/g, '\\$&');
    const regexPattern = escaped.replace(/\*/g, '.*');
    return new RegExp(`^${regexPattern}$`, 'i');
  });

  return (name: string, fullPath: string): boolean => {
    return ignoredPatterns.some(p => p.test(name) || p.test(fullPath));
  };
}

/**
 * Scan a folder recursively for hashtags in .md and .txt files.
 * 
 * @param folderPath   - Root folder to scan
 * @param ignoredPaths - Array of path patterns to exclude (supports wildcards)
 * @returns FolderAnalysisResult with hashtag counts and total files scanned
 */
export async function analyzeFolderHashtags(
  folderPath: string,
  ignoredPaths: string[] = [],
): Promise<FolderAnalysisResult> {
  const shouldExcludePath = buildExcludePredicate(ignoredPaths);
  const hashtagCounts = new Map<string, number>();

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

  // Read each file and extract hashtags
  for (const filePath of files) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      
      let match: RegExpExecArray | null;
      // Reset regex lastIndex before each file
      HASHTAG_REGEX.lastIndex = 0;
      while ((match = HASHTAG_REGEX.exec(content)) !== null) {
        const tag = match[0]; // includes the # prefix
        const currentCount = hashtagCounts.get(tag) || 0;
        hashtagCounts.set(tag, currentCount + 1);
      }
    } catch {
      // Skip files that can't be read (permissions, encoding, etc.)
    }
  }

  // Convert Map to sorted array (by count descending)
  const hashtags = Array.from(hashtagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  return {
    hashtags,
    totalFiles: files.length,
  };
}
