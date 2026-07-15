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
import { loadYaml } from '../shared/yamlUtil';
import { parseDateString, past, future, today } from '../shared/timeUtil';
import { createContentSearcher } from '../shared/searchHelpers';
import { splitFrontMatter } from '../shared/frontMatterUtil';
import { escapeRegexExceptWildcard, buildExcludePredicate } from '../shared/pathPattern';
import { mapWithConcurrency } from '../shared/asyncUtil';
import { logger } from '../shared/logUtil';

/** Max number of files read/stat'd concurrently during a search. Bounded so huge
 * trees don't exhaust file descriptors (EMFILE) while still overlapping I/O. */
const SEARCH_FILE_CONCURRENCY = 32;

/** Upper bound (bytes) on a single file read fully into memory while searching
 * content. Mirrors MAX_REPLACE_FILE_BYTES in searchAndReplace.ts: a stray
 * multi-hundred-MB/GB file matching .md/.txt would otherwise be slurped into one
 * V8 string in the Electron MAIN process, risking a memory spike (amplified by
 * SEARCH_FILE_CONCURRENCY) or blowing past V8's max string length. Oversized
 * files are skipped (logged at debug), the same graceful handling as an
 * unreadable file. */
const MAX_SEARCH_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

/** YAML parse cache: keyed by file path. Created per `searchFolder` invocation so
 * concurrent searches never share (and corrupt) each other's cached parses. */
type YamlCache = Map<string, Record<string, unknown> | null>;

/**
 * Return the parsed front-matter YAML for a file, using the cache when possible.
 * Falls back to parsing `content` if `filePath` is not provided or not yet cached.
 */
function getYaml(cache: YamlCache, content: string, filePath?: string): Record<string, unknown> | null {
  if (filePath !== undefined) {
    const cached = cache.get(filePath);
    // A cached `null` means "parsed, no front-matter" — that's a real hit and must
    // not re-parse. Only `undefined` (key absent) falls through. Keep this `!== undefined`
    // explicit; a falsy check would wrongly treat the cached `null` as a miss.
    if (cached !== undefined) return cached;
  }
  const parts = splitFrontMatter(content);
  let parsed: Record<string, unknown> | null = null;
  if (parts) {
    try {
      parsed = loadYaml(parts.yamlStr) as Record<string, unknown> | null ?? null;
    } catch (err) {
      // Malformed front-matter YAML is an expected, file-specific condition (not a
      // bug). Treat as "no front-matter" but log so it's distinguishable in a trace.
      logger.debug('search: failed to parse front-matter YAML', filePath ?? '(inline)', err);
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
    } catch (err) {
      // The user's advanced query is syntactically invalid. We can't evaluate it,
      // so the predicate matches nothing. Log at warn so an invalid query is
      // distinguishable from a query that legitimately matched zero files.
      // (Surfacing this to the UI as "invalid query" is tracked separately.)
      logger.warn('search: invalid advanced query expression', queryStr, err);
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
      } catch (err) {
        // A runtime error while evaluating the (validly-compiled) query against
        // this file's content — e.g. the expression references a property in a way
        // that throws. Treat as a non-match for this file, but log it.
        logger.debug('search: advanced query threw evaluating file', filePath ?? '(unknown)', err);
        return { matches: false, matchCount: 0 };
      }
    };
  } else if (type === 'wildcard') {
    // Compile the global regex ONCE, when the predicate is created — not once per
    // matching file. It's derived purely from the query, and the single global
    // scan below counts matches and answers "did it match?" in one pass (no
    // separate `test`, no array of substrings materialized just to read .length).
    const regex = new RegExp(wildcardToRegex(queryStr).source, 'gi');
    return (content: string, _filePath?: string) => {
      regex.lastIndex = 0;
      let matchCount = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        matchCount++;
        // A zero-width match (possible when the pattern is all wildcards, since
        // `.{0,25}` can match the empty string) never advances lastIndex — step
        // it forward manually so the loop terminates.
        if (match.index === regex.lastIndex) regex.lastIndex++;
      }
      return matchCount > 0
        ? { matches: true, matchCount }
        : { matches: false, matchCount: 0 };
    };
  } else {
    // Literal mode: case-insensitive text search
    const queryLower = queryStr.toLowerCase();
    // Guard the empty needle: indexOf('', idx) always returns idx (never -1) and
    // idx += 0 never advances, so the counting loop below would spin forever.
    // searchFolder gates this off via its hasQuery check, but createMatchPredicate
    // is exported — any other caller passing '' must not hang the main process.
    if (queryLower.length === 0) {
      return () => ({ matches: false, matchCount: 0 });
    }
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
  } catch (err) {
    // No readable EXIF (unsupported/corrupt image, or no metadata). Expected for
    // many images; return empty text so the file simply yields no EXIF matches.
    logger.debug('search: failed to read EXIF metadata', filePath, err);
    return '';
  }
}

/** Maximum number of files to keep when mostRecent filter is enabled */
export const MOST_RECENT_LIMIT = 500;

/** Hard ceiling on results returned from any single search, regardless of mode/query.
 * Bounds the payload sent to the renderer and the size of the rendered list. The
 * mostRecent path is additionally capped earlier at MOST_RECENT_LIMIT (500). */
export const SEARCH_RESULT_LIMIT = 500;

/** Modified/created timestamps (ms) plus byte size captured from a single stat()
 * call. `size` lets the content-read path enforce MAX_SEARCH_FILE_BYTES while
 * reusing an already-captured stat instead of issuing a second one. */
type StatTimes = { mtimeMs: number; birthtimeMs: number; size: number };

/** A file path paired with the stat times captured for it. */
type StatEntry = { path: string } & StatTimes;

/**
 * Filter an array of file paths to the N most recently modified.
 * Stats all files (with bounded concurrency), sorts by mtime descending, and
 * returns the top MOST_RECENT_LIMIT. The captured stat times are returned with
 * each path so callers can reuse them (see buildResult's cachedStat) instead of
 * stat'ing the same files a second time.
 */
async function filterMostRecent(filePaths: string[]): Promise<StatEntry[]> {
  // mapWithConcurrency bounds the concurrent stat() calls (it preserves input
  // order, though that's irrelevant here since we re-sort by mtime below).
  const stats = await mapWithConcurrency(
    filePaths,
    SEARCH_FILE_CONCURRENCY,
    async (fp): Promise<StatEntry | null> => {
      try {
        const stat = await fs.promises.stat(fp);
        return { path: fp, mtimeMs: stat.mtimeMs, birthtimeMs: stat.birthtimeMs, size: stat.size };
      } catch (err) {
        // Expected: file may have vanished or be inaccessible. Skip it (it just
        // won't be considered for the most-recent set), but log for traceability.
        logger.debug('search: failed to stat file for mostRecent filter', fp, err);
        return null;
      }
    },
  );
  const entries = stats.filter((s): s is StatEntry => s !== null);
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries.slice(0, MOST_RECENT_LIMIT);
}

/**
 * Stat an entry and assemble its SearchResult. Stat failures are swallowed so an
 * entry that can't be stat'd still appears (without time metadata) — matching the
 * prior behavior. Factored out of the four near-identical build-and-push blocks.
 *
 * On the mostRecent path the file was already stat'd in filterMostRecent; pass
 * those times as cachedStat to reuse them instead of stat'ing the file again.
 */
async function buildResult(
  folderPath: string,
  entryPath: string,
  matchCount: number,
  cachedStat?: StatTimes,
): Promise<SearchResult> {
  const relativePath = path.relative(folderPath, entryPath);
  const result: SearchResult = { path: entryPath, relativePath, matchCount };
  if (cachedStat) {
    result.modifiedTime = cachedStat.mtimeMs;
    result.createdTime = cachedStat.birthtimeMs;
    return result;
  }
  try {
    const stat = await fs.promises.stat(entryPath);
    result.modifiedTime = stat.mtimeMs;
    result.createdTime = stat.birthtimeMs;
  } catch (err) {
    // Expected: stat may fail (file vanished/inaccessible). The entry still
    // appears in results without time metadata; log so it's not invisible.
    logger.debug('search: failed to stat result entry', entryPath, err);
  }
  return result;
}

/**
 * Search a folder for files matching the given query.
 *
 * Empty-query contract: an empty/whitespace `query` is a deliberate "match every
 * searchable entry" request (used by the "Recent Files" feature and to gather a
 * file list for sorting). It is normally paired with `mostRecent` — the Search
 * dialog disables searching on an empty query unless Recent Files is checked.
 *
 * Results are always bounded: the returned array is capped at SEARCH_RESULT_LIMIT
 * and when `mostRecent` is set the candidate set is first reduced to the
 * MOST_RECENT_LIMIT newest files. So no query — empty or not — can return an
 * unbounded result set.
 *
 * @param folderPath   - Root folder to search
 * @param query        - Search text or JavaScript expression (empty = match everything)
 * @param searchType   - 'literal' | 'wildcard' | 'advanced'
 * @param searchMode   - 'content' (search file bodies) or 'filenames'
 * @param ignoredPaths - Array of path patterns to exclude (supports wildcards)
 * @param searchImageExif - Whether to include image files and search their EXIF metadata
 * @param mostRecent   - Whether to limit search to the 500 most recently modified files
 * @returns Array of SearchResult sorted by matchCount descending, capped at SEARCH_RESULT_LIMIT
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

    // fdir's onlyDirs() returns directory paths with a trailing separator
    // (e.g. "/root/"), but folderPath arrives without one, so a raw !==
    // comparison never excludes the search root itself. Normalize both with
    // path.resolve (which strips trailing separators) so the root is dropped.
    const resolvedRoot = path.resolve(folderPath);
    const allEntries = [...files, ...dirs.filter(d => path.resolve(d) !== resolvedRoot)];

    // When mostRecent is enabled, limit to the 500 most recently modified entries.
    // filterMostRecent already stat'd them, so cache the times by path and feed
    // them to buildResult to avoid a second stat per entry.
    let entriesToSearch = allEntries;
    let statCache: Map<string, StatTimes> | null = null;
    if (mostRecent) {
      const recent = await filterMostRecent(allEntries);
      entriesToSearch = recent.map(e => e.path);
      statCache = new Map(recent.map(e => [e.path, e]));
    }

    // Stat entries with bounded concurrency. mapWithConcurrency preserves input
    // order, so the pre-sort order matches the old sequential loop exactly.
    const entryResults = await mapWithConcurrency(
      entriesToSearch,
      SEARCH_FILE_CONCURRENCY,
      async (entryPath): Promise<SearchResult | null> => {
        const entryName = path.basename(entryPath);
        const cachedStat = statCache?.get(entryPath);
        if (matchPredicate) {
          const { matches, matchCount } = matchPredicate(entryName);
          if (!matches) return null;
          return buildResult(folderPath, entryPath, matchCount, cachedStat);
        }
        // No query — return all entries (mostRecent mode with empty query)
        return buildResult(folderPath, entryPath, 1, cachedStat);
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

    // When mostRecent is enabled, limit to the 500 most recently modified files.
    // filterMostRecent already stat'd them, so cache the times by path and feed
    // them to buildResult to avoid a second stat per file.
    let filesToSearch = files;
    let statCache: Map<string, StatTimes> | null = null;
    if (mostRecent) {
      const recent = await filterMostRecent(files);
      filesToSearch = recent.map(e => e.path);
      statCache = new Map(recent.map(e => [e.path, e]));
    }

    // Read + stat files with bounded concurrency. mapWithConcurrency preserves
    // input order, so the pre-sort order matches the old sequential loop exactly.
    const fileResults = await mapWithConcurrency(
      filesToSearch,
      SEARCH_FILE_CONCURRENCY,
      async (filePath): Promise<SearchResult | null> => {
        const ext = path.extname(filePath).toLowerCase();
        const isImage = EXIF_IMAGE_EXTENSIONS.has(ext);
        const cachedStat = statCache?.get(filePath);

        // No query — return all files (mostRecent mode with empty query)
        if (!matchPredicate) {
          return buildResult(folderPath, filePath, 1, cachedStat);
        }

        // Only the file *read* is wrapped in try/catch: an unreadable file is an
        // expected I/O condition we skip gracefully. Match evaluation and result
        // construction are deliberately left outside the catch so a genuine bug
        // in that path surfaces (via mapWithConcurrency's fail-fast) instead of
        // being silently miscategorized as "file skipped". (Image EXIF reads are
        // handled inside extractExifText, which returns '' on failure.)
        let content: string;
        // Carries the stat used for the size check forward into buildResult so a
        // matched file isn't stat'd twice. In mostRecent mode cachedStat already
        // has the size (no extra stat); otherwise we stat here to bound the read.
        let resultStat = cachedStat;
        if (isImage) {
          content = await extractExifText(filePath);
          if (!content) return null;
        } else {
          try {
            if (!resultStat) {
              const stat = await fs.promises.stat(filePath);
              resultStat = { mtimeMs: stat.mtimeMs, birthtimeMs: stat.birthtimeMs, size: stat.size };
            }
            // Bound the per-file read so a pathological file can't memory-spike
            // or crash the main process; skip it the same way as an unreadable
            // file (see MAX_SEARCH_FILE_BYTES).
            if (resultStat.size > MAX_SEARCH_FILE_BYTES) {
              logger.debug('search: skipping oversized file', filePath, resultStat.size);
              return null;
            }
            content = await fs.promises.readFile(filePath, 'utf-8');
          } catch (err) {
            logger.debug('search: skipping unreadable file', filePath, err);
            return null;
          }
        }

        const { matches, matchCount } = matchPredicate(content, filePath);
        if (!matches) return null;

        return buildResult(folderPath, filePath, matchCount, resultStat);
      },
    );
    for (const r of fileResults) {
      if (r) results.push(r);
    }
  }

  // Sort by match count (descending), then cap to the hard ceiling. The slice keeps
  // the top SEARCH_RESULT_LIMIT by match count (for an empty query every entry has
  // matchCount 1, so it's an arbitrary-but-bounded subset).
  results.sort((a, b) => b.matchCount - a.matchCount);
  return results.slice(0, SEARCH_RESULT_LIMIT);
}
