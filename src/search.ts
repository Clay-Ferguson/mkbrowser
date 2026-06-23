/**
 * Core search logic extracted from the IPC handler for testability.
 * 
 * This module implements folder-level search across .md and .txt files,
 * supporting literal, wildcard, and advanced (JavaScript expression) search types.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fdir } from 'fdir';
import * as ExifReader from 'exifreader';
import { load } from 'js-yaml';
import { parseDateString, past, future, today } from './utils/timeUtil';
import { createContentSearcher } from './utils/searchUtil';
import { splitFrontMatter } from './utils/tagUtil';
import { escapeRegexExceptWildcard, buildExcludePredicate } from './utils/pathPattern';
import { mapWithConcurrency } from './utils/asyncUtil';

/** Max number of files read/stat'd concurrently during a search. Bounded so huge
 * trees don't exhaust file descriptors (EMFILE) while still overlapping I/O. */
const SEARCH_FILE_CONCURRENCY = 32;

/** YAML parse cache: keyed by file path. Created per `searchFolder` invocation so
 * concurrent searches never share (and corrupt) each other's cached parses. */
type YamlCache = Map<string, Record<string, unknown> | null>;

/**
 * Return the parsed front-matter YAML for a file, using the cache when possible.
 * Falls back to parsing `content` if `filePath` is not provided or not yet cached.
 */
function getYaml(cache: YamlCache, content: string, filePath?: string): Record<string, unknown> | null {
  if (filePath !== undefined && cache.has(filePath)) {
    return cache.get(filePath) as Record<string, unknown> | null;
  }
  const parts = splitFrontMatter(content);
  let parsed: Record<string, unknown> | null = null;
  if (parts) {
    try {
      parsed = load(parts.yamlStr) as Record<string, unknown> | null ?? null;
    } catch {
      parsed = null;
    }
  }
  if (filePath !== undefined) {
    cache.set(filePath, parsed);
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
  modifiedTime?: number;
  createdTime?: number;
}

export type SearchType = 'literal' | 'wildcard' | 'advanced';
export type SearchMode = 'content' | 'filenames';
/** Match predicate result */
interface MatchResult {
  matches: boolean;
  matchCount: number;
}

/** Convert wildcard pattern to regex (each * matches up to 25 chars) */
function wildcardToRegex(pattern: string): RegExp {
  const escaped = escapeRegexExceptWildcard(pattern);
  const regexPattern = escaped.replace(/\*/g, '.{0,25}');
  return new RegExp(regexPattern, 'i');
}

/**
 * Returns a `prop(propPath, valType?)` function scoped to the given file content.
 * `propPath` supports dot-notation to drill into nested YAML objects.
 * `valType` can be "string" (default) or "ts" (parse value as a date, return ms number).
 */
function createPropFunction(cache: YamlCache, content: string, filePath?: string): (propPath: string, valType?: 'string' | 'ts') => unknown {
  return (propPath: string, valType?: 'string' | 'ts'): unknown => {
    const parsed = getYaml(cache, content, filePath);
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
  type: SearchType,
  cache: YamlCache = new Map()
): (content: string, filePath?: string) => MatchResult {
  if (type === 'advanced') {
    // Compile the user expression ONCE, when the predicate is created — not once
    // per file scanned. A syntax error in the query yields an always-false
    // predicate rather than throwing or silently failing on every file.
    let evalFunction: (...args: unknown[]) => unknown;
    try {
      evalFunction = new Function(
        '$', 'past', 'future', 'today', 'prop',
        `return (${queryStr});`,
      ) as (...args: unknown[]) => unknown;
    } catch {
      return () => ({ matches: false, matchCount: 0 });
    }

    return (content: string, filePath?: string) => {
      const { $, getMatchCount } = createContentSearcher(content);
      const prop = createPropFunction(cache, content, filePath);
      try {
        const matches = Boolean(evalFunction($, past, future, today, prop));
        const matchCount = getMatchCount();
        return {
          matches,
          matchCount: matches ? Math.max(matchCount, 1) : 0,
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
        return { matches: true, matchCount: allMatches ? allMatches.length : 1};
      }
      return { matches: false, matchCount: 0};
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
      return { matches: matchCount > 0, matchCount };
    };
  }
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
 * Stat an entry and assemble its SearchResult. Stat failures are swallowed so an
 * entry that can't be stat'd still appears (without time metadata) — matching the
 * prior behavior. Factored out of the four near-identical build-and-push blocks.
 */
async function buildResult(
  folderPath: string,
  entryPath: string,
  matchCount: number,
): Promise<SearchResult> {
  const relativePath = path.relative(folderPath, entryPath);
  const result: SearchResult = { path: entryPath, relativePath, matchCount };
  try {
    const stat = await fs.promises.stat(entryPath);
    result.modifiedTime = stat.mtimeMs;
    result.createdTime = stat.birthtimeMs;
  } catch { /* ignore stat errors */ }
  return result;
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
  const yamlCache: YamlCache = new Map();
  const results: SearchResult[] = [];
  const shouldExcludePath = buildExcludePredicate(ignoredPaths);
  const hasQuery = query.trim().length > 0;
  const matchPredicate = hasQuery ? createMatchPredicate(query, searchType, yamlCache) : null;

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

    // Stat entries with bounded concurrency. mapWithConcurrency preserves input
    // order, so the pre-sort order matches the old sequential loop exactly.
    const entryResults = await mapWithConcurrency(
      allEntries,
      SEARCH_FILE_CONCURRENCY,
      async (entryPath): Promise<SearchResult | null> => {
        const entryName = path.basename(entryPath);
        if (matchPredicate) {
          const { matches, matchCount } = matchPredicate(entryName);
          if (!matches) return null;
          return buildResult(folderPath, entryPath, matchCount);
        }
        // No query — return all entries (mostRecent mode with empty query)
        return buildResult(folderPath, entryPath, 1);
      },
    );
    for (const r of entryResults) {
      if (r) results.push(r);
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

    // Read + stat files with bounded concurrency. mapWithConcurrency preserves
    // input order, so the pre-sort order matches the old sequential loop exactly.
    const fileResults = await mapWithConcurrency(
      filesToSearch,
      SEARCH_FILE_CONCURRENCY,
      async (filePath): Promise<SearchResult | null> => {
        try {
          const ext = path.extname(filePath).toLowerCase();
          const isImage = EXIF_IMAGE_EXTENSIONS.has(ext);

          if (matchPredicate) {
            const content = isImage
              ? await extractExifText(filePath)
              : await fs.promises.readFile(filePath, 'utf-8');

            if (isImage && !content) return null;

            const { matches, matchCount } = matchPredicate(content, filePath);
            if (!matches) return null;

            return await buildResult(folderPath, filePath, matchCount);
          }
          // No query — return all files (mostRecent mode with empty query)
          return await buildResult(folderPath, filePath, 1);
        } catch {
          // Skip files that can't be read
          return null;
        }
      },
    );
    for (const r of fileResults) {
      if (r) results.push(r);
    }
  }

  // Sort by match count (descending)
  results.sort((a, b) => b.matchCount - a.matchCount);
  return results;
}
