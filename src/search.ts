/**
 * Core search logic extracted from the IPC handler for testability.
 * 
 * This module implements folder-level search across .md and .txt files,
 * supporting literal, wildcard, and advanced (JavaScript expression) search types.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fdir } from 'fdir';
import ExifReader from 'exifreader';
import yaml from 'js-yaml';
import { extractTimestamp, parseDateString, past, future, today } from './utils/timeUtil';
import { createContentSearcher } from './utils/searchUtil';
import { splitFrontMatter } from './utils/tagUtils';

/** Module-level YAML parse cache: keyed by file path, cleared at the start of each search */
let yamlCache: Map<string, Record<string, unknown> | null> = new Map();

/**
 * Return the parsed front-matter YAML for a file, using the cache when possible.
 * Falls back to parsing `content` if `filePath` is not provided or not yet cached.
 */
function getYaml(content: string, filePath?: string): Record<string, unknown> | null {
  if (filePath !== undefined && yamlCache.has(filePath)) {
    return yamlCache.get(filePath)!;
  }
  const parts = splitFrontMatter(content);
  let parsed: Record<string, unknown> | null = null;
  if (parts) {
    try {
      parsed = yaml.load(parts.yamlStr) as Record<string, unknown> | null ?? null;
    } catch {
      parsed = null;
    }
  }
  if (filePath !== undefined) {
    yamlCache.set(filePath, parsed);
  }
  return parsed;
}

/** Image extensions supported by ExifReader for EXIF metadata search */
const EXIF_IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.bmp', '.ico', '.tiff', '.tif', '.avif',
]);

/**
 * Search result from the file search
 */
export interface SearchResult {
  path: string;
  relativePath: string;
  matchCount: number;
  lineNumber?: number;
  lineText?: string;
  extraLine?: string;
  foundTime?: number;
  modifiedTime?: number;
  createdTime?: number;
}

export type SearchType = 'literal' | 'wildcard' | 'advanced';
export type SearchMode = 'content' | 'filenames';
/** Match predicate result */
interface MatchResult {
  matches: boolean;
  matchCount: number;
  foundTime?: number;
}

/** Helper to escape regex special characters (except *) */
function escapeRegexExceptWildcard(str: string): string {
  return str.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** Convert wildcard pattern to regex (each * matches up to 25 chars) */
function wildcardToRegex(pattern: string): RegExp {
  const escaped = escapeRegexExceptWildcard(pattern);
  const regexPattern = escaped.replace(/\*/g, '.{0,25}');
  return new RegExp(regexPattern, 'i');
}

/**
 * Returns an `inList(propPath, value)` function scoped to the given file content.
 * Resolves `propPath` (dot-notation) to a YAML array and checks for an exact match.
 */
function createInListFunction(content: string, filePath?: string): (propPath: string, value: string) => boolean {
  return (propPath: string, value: string): boolean => {
    const parsed = getYaml(content, filePath);
    if (!parsed) return false;
    const keys = propPath.split('.');
    let current: unknown = parsed;
    for (const key of keys) {
      if (current === null || typeof current !== 'object') return false;
      current = (current as Record<string, unknown>)[key];
    }
    if (!Array.isArray(current)) return false;
    return current.some(item => String(item) === value);
  };
}

/**
 * Returns a `prop(propPath, valType?)` function scoped to the given file content.
 * `propPath` supports dot-notation to drill into nested YAML objects.
 * `valType` can be "string" (default) or "ts" (parse value as a date, return ms number).
 */
function createPropFunction(content: string, filePath?: string): (propPath: string, valType?: 'string' | 'ts') => unknown {
  return (propPath: string, valType?: 'string' | 'ts'): unknown => {
    const parsed = getYaml(content, filePath);
    if (!parsed) return undefined;
    const keys = propPath.split('.');
    let current: unknown = parsed;
    for (const key of keys) {
      if (current === null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    if (current === undefined) return undefined;
    if (valType === 'ts') return parseDateString(String(current));
    return current;
  };
}

/**
 * Create a predicate function that tests content against the query.
 * Exported for unit testing individual match predicates.
 */
export function createMatchPredicate(
  queryStr: string,
  type: SearchType
): (content: string, filePath?: string) => MatchResult {
  if (type === 'advanced') {
    return (content: string, filePath?: string) => {
      const ts = extractTimestamp(content);
      const { $, getMatchCount } = createContentSearcher(content);
      const prop = createPropFunction(content, filePath);
      const inList = createInListFunction(content, filePath);
      try {
        const expressionCode = `return (${queryStr});`;
        const evalFunction = new Function('$', 'ts', 'past', 'future', 'today', 'prop', 'inList', expressionCode);
        const rawResult = evalFunction($, ts, past, future, today, prop, inList);
        const matches = Boolean(rawResult);
        const matchCount = getMatchCount();
        return {
          matches,
          matchCount: matches ? Math.max(matchCount, 1) : 0,
          foundTime: ts > 0 ? ts : undefined,
        };
      } catch {
        return { matches: false, matchCount: 0 };
      }
    };
  } else if (type === 'wildcard') {
    const regex = wildcardToRegex(queryStr);
    return (content: string, _filePath?: string) => {
      const matches = regex.test(content);
      if (matches) {
        const allMatches = content.match(new RegExp(regex.source, 'gi'));
        return { matches: true, matchCount: allMatches ? allMatches.length : 1, foundTime: undefined };
      }
      return { matches: false, matchCount: 0, foundTime: undefined };
    };
  } else {
    // Literal mode: case-insensitive text search
    const queryLower = queryStr.toLowerCase();
    return (content: string, _filePath?: string) => {
      const contentLower = content.toLowerCase();
      let matchCount = 0;
      let searchIndex = 0;
      while ((searchIndex = contentLower.indexOf(queryLower, searchIndex)) !== -1) {
        matchCount++;
        searchIndex += queryLower.length;
      }
      return { matches: matchCount > 0, matchCount, foundTime: undefined };
    };
  }
}

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
    // Always exclude hidden files/folders (starting with '.')
    if (name.startsWith('.')) return true;
    return ignoredPatterns.some(p => p.test(name) || p.test(fullPath));
  };
}

/**
 * Extract all EXIF metadata text from an image file.
 * Returns a string with one line per tag: "GroupName > TagName: Description"
 */
async function extractExifText(filePath: string): Promise<string> {
  try {
    const tags = await ExifReader.load(filePath, { expanded: true, length: 128 * 1024 });
    const skipGroups = new Set(['Thumbnail', 'thumbnail']);
    const lines: string[] = [];

    for (const [groupName, groupTags] of Object.entries(tags)) {
      if (skipGroups.has(groupName)) continue;
      if (typeof groupTags !== 'object' || groupTags === null) continue;

      for (const [tagName, tagValue] of Object.entries(groupTags as Record<string, unknown>)) {
        if (tagValue && typeof tagValue === 'object' && 'description' in tagValue) {
          const desc = (tagValue as { description: unknown }).description;
          if (typeof desc === 'string' && desc.length > 0) {
            lines.push(`${groupName} > ${tagName}: ${desc}`);
          } else if (typeof desc === 'number') {
            lines.push(`${groupName} > ${tagName}: ${String(desc)}`);
          }
        }
      }
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

/** Maximum number of files to keep when mostRecent filter is enabled */
export const MOST_RECENT_LIMIT = 500;

/**
 * Filter an array of file paths to the N most recently modified.
 * Stats all files, sorts by mtime descending, and returns the top MOST_RECENT_LIMIT.
 */
async function filterMostRecent(filePaths: string[]): Promise<string[]> {
  const entries: Array<{ path: string; mtime: number }> = [];
  for (const fp of filePaths) {
    try {
      const stat = await fs.promises.stat(fp);
      entries.push({ path: fp, mtime: stat.mtimeMs });
    } catch {
      // Skip files that can't be stat'd
    }
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  return entries.slice(0, MOST_RECENT_LIMIT).map(e => e.path);
}

/**
 * Search a folder for files matching the given query.
 *
 * @param folderPath   - Root folder to search
 * @param query        - Search text or JavaScript expression
 * @param searchType   - 'literal' | 'wildcard' | 'advanced'
 * @param searchMode   - 'content' (search file bodies) or 'filenames'
 * @param ignoredPaths - Array of path patterns to exclude (supports wildcards)
 * @param searchImageExif - Whether to include image files and search their EXIF metadata
 * @param mostRecent   - Whether to limit search to the 500 most recently modified files
 * @returns Array of SearchResult sorted by matchCount descending
 */
export async function searchFolder(
  folderPath: string,
  query: string,
  searchType: SearchType = 'literal',
  searchMode: SearchMode = 'content',
  ignoredPaths: string[] = [],
  searchImageExif = false,
  mostRecent = false,
): Promise<SearchResult[]> {
  yamlCache = new Map();
  const results: SearchResult[] = [];
  const shouldExcludePath = buildExcludePredicate(ignoredPaths);
  const hasQuery = query.trim().length > 0;
  const matchPredicate = hasQuery ? createMatchPredicate(query, searchType) : null;

  if (searchMode === 'filenames') {
    // Search file and folder names
    const filesApi = new fdir()
      .withFullPaths()
      .exclude((dirName, dirPath) => shouldExcludePath(dirName, dirPath))
      .filter((filePath) => !shouldExcludePath(path.basename(filePath), filePath))
      .crawl(folderPath);

    const dirsApi = new fdir()
      .withFullPaths()
      .exclude((dirName, dirPath) => shouldExcludePath(dirName, dirPath))
      .onlyDirs()
      .crawl(folderPath);

    const [files, dirs] = await Promise.all([
      filesApi.withPromise(),
      dirsApi.withPromise(),
    ]);

    let allEntries = [...files, ...dirs.filter(d => d !== folderPath)];

    // When mostRecent is enabled, limit to the 500 most recently modified entries
    if (mostRecent) {
      allEntries = await filterMostRecent(allEntries);
    }

    for (const entryPath of allEntries) {
      const entryName = path.basename(entryPath);

      if (matchPredicate) {
        const { matches, matchCount, foundTime } = matchPredicate(entryName);
        if (!matches) continue;

        const relativePath = path.relative(folderPath, entryPath);
        let modifiedTime: number | undefined;
        let createdTime: number | undefined;
        try {
          const stat = await fs.promises.stat(entryPath);
          modifiedTime = stat.mtimeMs;
          createdTime = stat.birthtimeMs;
        } catch { /* ignore stat errors */ }
        results.push({
          path: entryPath,
          relativePath,
          matchCount,
          ...(foundTime !== undefined && { foundTime }),
          ...(modifiedTime !== undefined && { modifiedTime }),
          ...(createdTime !== undefined && { createdTime }),
        });
      } else {
        // No query — return all entries (mostRecent mode with empty query)
        const relativePath = path.relative(folderPath, entryPath);
        let modifiedTime: number | undefined;
        let createdTime: number | undefined;
        try {
          const stat = await fs.promises.stat(entryPath);
          modifiedTime = stat.mtimeMs;
          createdTime = stat.birthtimeMs;
        } catch { /* ignore stat errors */ }
        results.push({
          path: entryPath,
          relativePath,
          matchCount: 1,
          ...(modifiedTime !== undefined && { modifiedTime }),
          ...(createdTime !== undefined && { createdTime }),
        });
      }
    }
  } else {
    // Search file contents - .md and .txt files, plus images when searchImageExif is enabled
    const api = new fdir()
      .withFullPaths()
      .exclude((dirName, dirPath) => shouldExcludePath(dirName, dirPath))
      .filter((filePath) => {
        const fileName = path.basename(filePath);
        if (shouldExcludePath(fileName, filePath)) return false;
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.md' || ext === '.txt') return true;
        if (searchImageExif && EXIF_IMAGE_EXTENSIONS.has(ext)) return true;
        return false;
      })
      .crawl(folderPath);

    const files = await api.withPromise();

    // When mostRecent is enabled, limit to the 500 most recently modified files
    const filesToSearch = mostRecent ? await filterMostRecent(files) : files;

    for (const filePath of filesToSearch) {
      try {
        const ext = path.extname(filePath).toLowerCase();
        const isImage = EXIF_IMAGE_EXTENSIONS.has(ext);

        if (matchPredicate) {
          const content = isImage
            ? await extractExifText(filePath)
            : await fs.promises.readFile(filePath, 'utf-8');

          if (isImage && !content) continue;

          const { matches, matchCount, foundTime } = matchPredicate(content, filePath);

          if (matches) {
            const relativePath = path.relative(folderPath, filePath);
            let modifiedTime: number | undefined;
            let createdTime: number | undefined;
            try {
              const fileStat = await fs.promises.stat(filePath);
              modifiedTime = fileStat.mtimeMs;
              createdTime = fileStat.birthtimeMs;
            } catch { /* ignore stat errors */ }
            results.push({
              path: filePath,
              relativePath,
              matchCount,
              ...(foundTime !== undefined && { foundTime }),
              ...(modifiedTime !== undefined && { modifiedTime }),
              ...(createdTime !== undefined && { createdTime }),
            });
          }
        } else {
          // No query — return all files (mostRecent mode with empty query)
          const relativePath = path.relative(folderPath, filePath);
          let modifiedTime: number | undefined;
          let createdTime: number | undefined;
          try {
            const stat = await fs.promises.stat(filePath);
            modifiedTime = stat.mtimeMs;
            createdTime = stat.birthtimeMs;
          } catch { /* ignore stat errors */ }
          results.push({
            path: filePath,
            relativePath,
            matchCount: 1,
            ...(modifiedTime !== undefined && { modifiedTime }),
            ...(createdTime !== undefined && { createdTime }),
          });
        }
      } catch {
        // Skip files that can't be read
      }
    }
  }

  // Sort by match count (descending)
  results.sort((a, b) => b.matchCount - a.matchCount);
  return results;
}
