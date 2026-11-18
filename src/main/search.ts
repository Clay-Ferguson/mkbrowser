/**
 * Core search logic extracted from the IPC handler for testability.
 *
 * This module implements folder-level search across .md and .txt files,
 * supporting literal, wildcard, and advanced (JavaScript expression) search types.
 *
 * What is searched is set by two independent flags (the "Search Target"
 * checkboxes in the Search dialog), giving three useful combinations:
 *  - searchContents only — "File Contents": a file is a hit when the query matches
 *    its CONTENTS. Contents are only read for .md/.txt (plus images when
 *    searchImageExif is on).
 *  - searchContents + searchNames — a file is a hit when the query matches its
 *    NAME *or* its CONTENTS. The *name* half covers every file extension — except
 *    under mostRecent, where both halves run inside a window
 *    drawn from the content files only. The name test is pure CPU, so it runs
 *    first and short-circuits: a name-matched file is never read. Folders are
 *    never matched in this mode.
 *  - searchNames only — "File Names": names only, but including folder names
 *    (unless excludeFolders is set).
 * With neither flag set there is nothing to search, so the search returns no results.
 *
 * See: (USER_GUIDE.md#searching)
 */
import path from 'node:path';
import fs from 'node:fs';
import { fdir } from 'fdir';
import * as ExifReader from 'exifreader';
import { loadYaml } from '../shared/yamlUtil';
import { parseDateString, past, future, today, formatDateTime12 } from '../shared/timeUtil';
import { createContentSearcher, compareSearchResults, parseTagFilter, matchesTagFilter, matchesTypeFilter } from '../shared/searchHelpers';
import type { SearchDefinition, SearchMatchType, SortKey } from '../shared/shared';
import { compileAdvancedQuery, compileSortKeyExpression, AdvancedQueryRuntimeError, AdvancedQueryTimeoutError } from './advancedQuery';
import { splitFrontMatter } from '../shared/frontMatterUtil';
import { getTagsFromFrontMatter } from '../shared/tagUtil';
import { escapeRegexExceptWildcard, buildExcludePredicate, wildcardToAnchoredRegex } from '../shared/pathPattern';
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

/**
 * Image extensions supported by ExifReader for EXIF metadata search
 *
 * See: (USER_GUIDE.md#using-search)
 */
const EXIF_IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.bmp', '.ico', '.tiff', '.tif', '.avif',
]);

/**
 * True if a file's *contents* are searchable in a contents search. The name half
 * of a contents+names search deliberately does NOT consult this — every extension can match by
 * name. Shared by the crawl filter and the candidate partition so the two can
 * never disagree about what "readable" means.
 */
function isContentCandidate(filePath: string, searchImageExif: boolean): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md' || ext === '.txt') return true;
  if (searchImageExif && EXIF_IMAGE_EXTENSIONS.has(ext)) return true;
  return false;
}

/**
 * Search result from the file search
 */
export interface SearchResult {
  path: string;
  relativePath: string;
  matchCount: number;
  modifiedTime?: number;
  createdTime?: number;
  /** Set (in a contents+names search only) when this file matched on its NAME, meaning its
   * contents were never read — so matchCount counts occurrences within the file
   * name, not within the body. */
  nameMatch?: boolean;
  /** Set when the result is a folder (only a names-only search returns folders). */
  isDirectory?: boolean;
  /** The file's value under the custom sort expression (custom sort only). */
  sortKey?: SortKey;
  /** `sortKey` formatted for display (custom sort only); see formatSortLabel. */
  sortLabel?: string;
}

/** Match predicate result */
interface MatchResult {
  matches: boolean;
  matchCount: number;
  /** Set (advanced mode only) when the query threw while being evaluated
   * against this input, which then counts as a non-match. */
  error?: string;
}

/**
 * Convert a wildcard pattern to a global, case-insensitive regex (each * matches up to 25 chars).
 *
 * See: (USER_GUIDE.md#using-search)
 */
function wildcardToRegex(pattern: string): RegExp {
  const escaped = escapeRegexExceptWildcard(pattern);
  const regexPattern = escaped.replace(/\*/g, '.{0,25}');
  return new RegExp(regexPattern, 'gi');
}

/** Convert CRLF and lone-CR line endings to LF. */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * A multi-line query (the search dialog always produces LF newlines) must still
 * match a file saved with CRLF line endings, so such queries compare against
 * LF-normalized content. Single-line queries can't be affected by line endings,
 * so they skip the extra pass over every file.
 */
function lineEndingNormalizer(queryStr: string): (content: string) => string {
  return /[\r\n]/.test(queryStr) ? normalizeLineEndings : (content) => content;
}

/**
 * Returns a `getProp(name)` function scoped to the given file content: the
 * top-level front-matter property `name` (backing the advanced query's `p`
 * object), or undefined. Nested values are reached in the query itself
 * (`p.author.name`).
 */
function createGetProp(cache: YamlCache, content: string, filePath?: string): (name: string) => unknown {
  return (name: string): unknown => {
    const parsed = getYaml(cache, content, filePath);
    if (!parsed || !Object.hasOwn(parsed, name)) return undefined;
    return parsed[name];
  };
}

/**
 * Returns a `getFile(name)` function backing the advanced query's `f` object:
 * the file's content and attributes. Dates are integer ms timestamps, so they
 * work with past/future/today and compare with ts(). An attribute that isn't
 * known (no stat, no path, a folder's size) is undefined.
 *
 * See: (USER_GUIDE.md#advanced-search-predicates)
 */
function createGetFile(content: string, filePath?: string, stat?: Partial<StatTimes>): (name: string) => unknown {
  return (name: string): unknown => {
    switch (name) {
      case 'content':
        return content;
      case 'size':
        return stat?.size;
      case 'created':
        return stat?.birthtimeMs === undefined ? undefined : Math.round(stat.birthtimeMs);
      case 'modified':
        return stat?.mtimeMs === undefined ? undefined : Math.round(stat.mtimeMs);
      case 'name':
        return filePath === undefined ? undefined : path.basename(filePath);
      case 'path':
        return filePath;
      case 'ext':
        return filePath === undefined ? undefined : path.extname(filePath).toLowerCase();
      default:
        return undefined;
    }
  };
}

/**
 * Create a predicate function that tests content against the query.
 * Exported for unit testing individual match predicates.
 *
 * See: (USER_GUIDE.md#using-search)
 */
export function createMatchPredicate(
  queryStr: string,
  type: SearchMatchType,
  cache: YamlCache = new Map()
): (content: string, filePath?: string, stat?: Partial<StatTimes>) => MatchResult {
  if (type === 'advanced') {
    // Compile the user expression ONCE, when the predicate is created — not once
    // per file scanned. A syntax error throws AdvancedQuerySyntaxError, which
    // fails the whole search so the UI can report it.
    const evalFunction = compileAdvancedQuery(queryStr);
    // After one timeout, fail every later call immediately. The search runs up
    // to SEARCH_FILE_CONCURRENCY files at once, and each in-flight file whose
    // read completes after the first timeout would otherwise burn its own full
    // EVAL_TIMEOUT_MS of main-process time before the abort takes effect.
    let timedOut: AdvancedQueryTimeoutError | null = null;

    return (content: string, filePath?: string, stat?: Partial<StatTimes>) => {
      if (timedOut) throw timedOut;
      const { $, tag, getMatchCount } = createContentSearcher(content, () => getTagsFromFrontMatter(getYaml(cache, content, filePath)));
      const getProp = createGetProp(cache, content, filePath);
      const getFile = createGetFile(content, filePath, stat);
      try {
        const matches = evalFunction({ $, tag, getProp, getFile, past, future, today, ts: parseDateString });
        const matchCount = getMatchCount();
        return {
          matches,
          matchCount: matches ? Math.max(matchCount, 1) : 0,
        };
      } catch (err) {
        // A runtime error while evaluating the (validly-compiled) query against
        // this file's content — e.g. `p.a.b` on a file without `a`. Treat
        // as a non-match for this file; searchFolder reports it if the query
        // failed on every file. Anything else — notably AdvancedQueryTimeoutError,
        // which would recur on every file — aborts the whole search.
        if (err instanceof AdvancedQueryTimeoutError) timedOut = err;
        if (!(err instanceof AdvancedQueryRuntimeError)) throw err;
        logger.debug('search: advanced query threw evaluating file', filePath ?? '(unknown)', err.message);
        return { matches: false, matchCount: 0, error: err.message };
      }
    };
  } else if (type === 'wildcard') {
    // Compile the global regex ONCE, when the predicate is created — not once per
    // matching file. It's derived purely from the query, and the single global
    // scan below counts matches and answers "did it match?" in one pass (no
    // separate `test`, no array of substrings materialized just to read .length).
    const regex = wildcardToRegex(normalizeLineEndings(queryStr));
    const normalize = lineEndingNormalizer(queryStr);
    return (rawContent: string, _filePath?: string) => {
      const content = normalize(rawContent);
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
    const queryLower = normalizeLineEndings(queryStr).toLowerCase();
    // Guard the empty needle: indexOf('', idx) always returns idx (never -1) and
    // idx += 0 never advances, so the counting loop below would spin forever.
    // searchFolder gates this off via its hasQuery check, but createMatchPredicate
    // is exported — any other caller passing '' must not hang the main process.
    if (queryLower.length === 0) {
      return () => ({ matches: false, matchCount: 0 });
    }
    const normalize = lineEndingNormalizer(queryLower);
    return (content: string, _filePath?: string) => {
      const contentLower = normalize(content).toLowerCase();
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

/** One file's custom sort key, its display label, and the error (if the
 * expression threw on this file, in which case the key is null). */
interface SortKeyOutcome {
  sortKey: SortKey;
  sortLabel: string;
  error?: string;
}

/**
 * Display text for a sort key: numbers that came from `ts()` (listed in
 * `dates`) as dates (`YYYY-MM-DD`, plus ` hh:mm AM/PM` when the time is not
 * midnight — the same format the built-in time sorts show), other values as-is, no value as an em dash, and the parts
 * of an array key joined with ` · `.
 *
 * See: (USER_GUIDE.md#custom-sort-order)
 */
export function formatSortLabel(key: SortKey, dates: ReadonlySet<number> = new Set()): string {
  const one = (v: number | string | null): string =>
    v === null ? '—' : typeof v === 'number' && dates.has(v) ? formatDateTime12(v, true) : String(v);
  return Array.isArray(key) ? key.map(one).join(' · ') : one(key);
}

/**
 * Create an evaluator for a custom sort expression, which runs against one
 * file's content with the same helpers as an advanced query ($, tag, p, f, ts,
 * past, future, today). Exported for unit testing.
 *
 * The expression is compiled once here; a syntax error throws
 * AdvancedQuerySyntaxError, failing the search. A runtime error on one file
 * gives that file no value (null, which sorts last). A timeout aborts the
 * search, and every later call fails at once (see createMatchPredicate).
 *
 * See: (USER_GUIDE.md#custom-sort-order)
 */
export function createSortKeyEvaluator(
  exprStr: string,
  cache: YamlCache = new Map(),
): (content: string, filePath?: string, stat?: Partial<StatTimes>) => SortKeyOutcome {
  const evalFunction = compileSortKeyExpression(exprStr);
  let timedOut: AdvancedQueryTimeoutError | null = null;

  return (content: string, filePath?: string, stat?: Partial<StatTimes>) => {
    if (timedOut) throw timedOut;
    const { $, tag } = createContentSearcher(content, () => getTagsFromFrontMatter(getYaml(cache, content, filePath)));
    const getProp = createGetProp(cache, content, filePath);
    const getFile = createGetFile(content, filePath, stat);
    try {
      const { key, dates } = evalFunction({ $, tag, getProp, getFile, past, future, today, ts: parseDateString });
      return { sortKey: key, sortLabel: formatSortLabel(key, dates) };
    } catch (err) {
      if (err instanceof AdvancedQueryTimeoutError) timedOut = err;
      if (!(err instanceof AdvancedQueryRuntimeError)) throw err;
      logger.debug('search: custom sort expression threw evaluating file', filePath ?? '(unknown)', err.message);
      return { sortKey: null, sortLabel: formatSortLabel(null), error: err.message };
    }
  };
}

/**
 * Predicate for a Wild Card search of file names only: a glob over the
 * WHOLE name, where `*` matches any number of characters — `*.md` matches names
 * ending in .md (not `notes.md.bak`), `report*` names starting with "report".
 * Case-insensitive. Content wildcards (and the name half of a contents+names
 * search) stay unanchored substring matches; see
 * createMatchPredicate.
 *
 * See: (USER_GUIDE.md#using-search)
 */
export function createFileNameGlobPredicate(pattern: string): (name: string) => MatchResult {
  const regex = wildcardToAnchoredRegex(pattern);
  return (name: string) => (regex.test(name)
    ? { matches: true, matchCount: 1 }
    : { matches: false, matchCount: 0 });
}

/**
 * Extract all EXIF metadata text from an image file.
 * Returns a string with one line per tag: "GroupName > TagName: Description"
 *
 * See: (USER_GUIDE.md#using-search)
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

/**
 * Maximum number of files to keep when mostRecent filter is enabled
 *
 * See: (USER_GUIDE.md#using-search)
 */
export const MOST_RECENT_LIMIT = 500;

/** Hard ceiling on results returned from any single search, regardless of mode/query.
 * Bounds the payload sent to the renderer and the size of the rendered list. The
 * mostRecent path is additionally capped earlier at MOST_RECENT_LIMIT (500).
 *
 * See: (USER_GUIDE.md#search-results)
 */
export const SEARCH_RESULT_LIMIT = 500;

/** Modified/created timestamps (ms) plus byte size captured from a single stat()
 * call. `size` lets the content-read path enforce MAX_SEARCH_FILE_BYTES while
 * reusing an already-captured stat instead of issuing a second one. */
type StatTimes = { mtimeMs: number; birthtimeMs: number; size: number };

/** A file path paired with the stat times captured for it. */
type StatEntry = { path: string } & StatTimes;

/**
 * Stat every path (with bounded concurrency), dropping the ones that can't be
 * stat'd. The captured times are returned with each path so callers can reuse
 * them (see buildResult's cachedStat) instead of stat'ing the same files again.
 */
async function statEntries(filePaths: string[], signal?: AbortSignal): Promise<StatEntry[]> {
  // mapWithConcurrency bounds the concurrent stat() calls (it preserves input
  // order, which callers that re-sort by mtime don't rely on).
  const stats = await mapWithConcurrency(
    filePaths,
    SEARCH_FILE_CONCURRENCY,
    async (fp): Promise<StatEntry | null> => {
      signal?.throwIfAborted();
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
  return stats.filter((s): s is StatEntry => s !== null);
}

/**
 * Filter an array of file paths to the MOST_RECENT_LIMIT most recently modified,
 * carrying each one's captured stat times along for buildResult to reuse.
 */
async function filterMostRecent(filePaths: string[], signal?: AbortSignal): Promise<StatEntry[]> {
  const entries = await statEntries(filePaths, signal);
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MOST_RECENT_LIMIT);
}

/**
 * Stat an entry and assemble its SearchResult. Stat failures are swallowed so an
 * entry that can't be stat'd still appears (without time metadata). Shared by
 * every result-producing path in searchFolder.
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
 * The content and stat a custom sort expression is evaluated against for a
 * result whose contents the search never read (a name match, a names-only
 * result, or a result of an empty-query search). Only .md/.txt files are read,
 * with the same size bound as the content search; anything else — folders, other
 * file types, or an unreadable or oversized file — is evaluated against no
 * content, so `p.x` is simply undefined there. Every file is stat'd (for `f.size`
 * etc.); a folder reuses the result's times and has no size.
 */
async function readSortKeySource(result: SearchResult): Promise<{ content: string; stat?: Partial<StatTimes> }> {
  if (result.isDirectory) {
    return { content: '', stat: { mtimeMs: result.modifiedTime, birthtimeMs: result.createdTime } };
  }
  let stat: StatTimes | undefined;
  try {
    const s = await fs.promises.stat(result.path);
    stat = { mtimeMs: s.mtimeMs, birthtimeMs: s.birthtimeMs, size: s.size };
  } catch (err) {
    logger.debug('search: failed to stat file for custom sort', result.path, err);
    return { content: '' };
  }
  if (!isContentCandidate(result.path, false)) return { content: '', stat };
  if (stat.size > MAX_SEARCH_FILE_BYTES) {
    logger.debug('search: skipping oversized file for custom sort', result.path, stat.size);
    return { content: '', stat };
  }
  try {
    return { content: await fs.promises.readFile(result.path, 'utf-8'), stat };
  } catch (err) {
    logger.debug('search: failed to read file for custom sort', result.path, err);
    return { content: '', stat };
  }
}

/**
 * The options of a folder search: the fields of a saved search that shape it
 * (all but its name and query), plus the ignored-path patterns and a signal
 * that cancels it. A whole SearchDefinition can be passed as-is.
 */
export type SearchFolderOptions = Partial<Omit<SearchDefinition, 'name' | 'searchText'>> & {
  ignoredPaths?: string[];
  signal?: AbortSignal;
};

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
 * unbounded result set. The results are sorted by `sortBy`/`sortDirection`
 * BEFORE the cap, so the ones kept are the ones that order puts first (e.g. the
 * 500 newest for "modification time, newest first"), and `totalMatches` says
 * how many there were before the cap.
 *
 * @param folderPath   - Root folder to search
 * @param query        - Search text or JavaScript expression (empty = match everything)
 * @param options      - Every field is optional and defaults to the Search dialog's default:
 * - `matchType` — 'literal' | 'wildcard' | 'advanced'
 * - `searchContents` / `searchNames` — what the query is matched against (see
 *   the module header). Default: contents only. Contents + names matches file
 *   bodies OR file names, but the name half is skipped for 'advanced', which stays
 *   content-only; names alone matches file *and folder* names. Neither: no results.
 * - `ignoredPaths` — path patterns to exclude (supports wildcards)
 * - `searchImageExif` — whether to include image files and search their EXIF metadata
 * - `mostRecent` — whether to limit search to the 500 most recently modified files.
 *   In a contents search those are the 500 newest content files (.md/.txt, plus
 *   images with searchImageExif), and both name and content matching run inside
 *   that set; in a names-only search, the 500 newest files and folders.
 * - `excludeFolders` — in a names-only search, leave folders out entirely (used
 *   by Tools → Recent Files). No effect on contents searches, which never
 *   return folders.
 * - `sortBy` — result order (see compareSearchResults); decides which
 *   results survive the cap
 * - `sortDirection` — 'asc' or 'desc'
 * - `sortExpression` — with `sortBy: 'custom'`, the JavaScript expression whose
 *   per-file value orders the results (see createSortKeyEvaluator). Files the
 *   search matched without reading are read afterwards to evaluate it.
 * - `tags` — the Tags field (see parseTagFilter): only files whose front matter
 *   tags pass it can match, ANDed with the query (an empty query plus tags lists
 *   every file that passes). Ignored without `searchContents`. Since tags live
 *   in the content, every candidate is read, including name matches, and only
 *   content candidates (.md/.txt, plus images) can match.
 * - `type` — the Type field: only Markdown files whose front matter `type` is
 *   this one (ignoring case; see matchesTypeFilter) can match, ANDed like
 *   `tags`. Only `.md` files are searched then. Ignored without `searchContents`.
 * - `signal` — cancels the search: it is checked after each crawl and
 *   before each file is stat'd, read or matched, and an abort rejects the search
 *   with the signal's reason. Partial results are never returned.
 * @returns The results in the requested order, capped at SEARCH_RESULT_LIMIT,
 *   plus the total number of matches before the cap
 *
 * See: (USER_GUIDE.md#using-search)
 */
export async function searchFolderWithTotal(
  folderPath: string,
  query: string,
  {
    matchType = 'literal',
    searchContents = true,
    searchNames = false,
    ignoredPaths = [],
    searchImageExif = false,
    mostRecent = false,
    excludeFolders = false,
    sortBy = 'modified-time',
    sortDirection = 'desc',
    sortExpression = '',
    tags = '',
    type = '',
    signal,
  }: SearchFolderOptions = {},
): Promise<{ results: SearchResult[]; totalMatches: number }> {
  signal?.throwIfAborted();
  if (!searchContents && !searchNames) return { results: [], totalMatches: 0 };
  // fdir's withAbortSignal needs a real signal; one that never aborts stands in.
  const abortSignal = signal ?? new AbortController().signal;
  const yamlCache: YamlCache = new Map();
  const results: SearchResult[] = [];
  const shouldExcludePath = buildExcludePredicate(ignoredPaths);
  const hasQuery = query.trim().length > 0;
  // The Tags and Type filters need file contents, so a names-only search
  // ignores them (the Search dialog disables those fields then).
  const tagFilter = searchContents ? parseTagFilter(tags) : null;
  const typeFilter = searchContents ? type.trim() : '';
  /** A Tags or Type filter is set: every candidate must be read to check it. */
  const frontMatterFilter = tagFilter !== null || typeFilter !== '';
  /** Whether the file whose contents are `content` passes the Tags and Type filters. */
  const passesFrontMatterFilter = (content: string, filePath: string): boolean => {
    if (!frontMatterFilter) return true;
    const frontMatter = getYaml(yamlCache, content, filePath);
    return (!tagFilter || matchesTagFilter(getTagsFromFrontMatter(frontMatter), tagFilter))
      && matchesTypeFilter(frontMatter, typeFilter);
  };
  /** Whose contents a contents search reads: with a Type filter, Markdown files only. */
  const isCandidate = (filePath: string): boolean => typeFilter
    ? path.extname(filePath).toLowerCase() === '.md'
    : isContentCandidate(filePath, searchImageExif);
  const basePredicate: ((content: string, filePath?: string, stat?: Partial<StatTimes>) => MatchResult) | null = !hasQuery
    ? null
    : !searchContents && matchType === 'wildcard'
      ? createFileNameGlobPredicate(query)
      : createMatchPredicate(query, matchType, yamlCache);

  // Custom sort: compiled up front (like the query) so a bad expression fails
  // the search before anything is crawled. Shares the YAML cache, so a file whose
  // front matter the query already parsed isn't parsed again.
  if (sortBy === 'custom' && !sortExpression.trim()) {
    throw new Error('Sort By is Custom, but no sort expression was given.');
  }
  const baseSortKeyEvaluator = sortBy === 'custom' ? createSortKeyEvaluator(sortExpression, yamlCache) : null;
  // Mirrors the query's every-file error tracking below.
  let sortEvaluatedCount = 0;
  let sortErrorCount = 0;
  let firstSortError: string | undefined;
  const withSortKey = (result: SearchResult, content: string, stat?: Partial<StatTimes>): SearchResult => {
    if (!baseSortKeyEvaluator) return result;
    const { sortKey, sortLabel, error } = baseSortKeyEvaluator(content, result.path, stat);
    sortEvaluatedCount++;
    if (error !== undefined) {
      sortErrorCount++;
      firstSortError ??= error;
    }
    return { ...result, sortKey, sortLabel };
  };

  // Track advanced-query runtime errors. One file throwing is normal (the query
  // may assume front matter only some files have), but a query that threw on
  // EVERY file it was evaluated against — typically a typo such as `Prop(...)`
  // — would otherwise look exactly like "no results".
  let evaluatedCount = 0;
  let errorCount = 0;
  let firstError: string | undefined;
  const matchPredicate = basePredicate && ((content: string, filePath?: string, stat?: Partial<StatTimes>): MatchResult => {
    // Every name/content match goes through here, so this is also the
    // cancellation checkpoint for the CPU-only name passes.
    signal?.throwIfAborted();
    const result = basePredicate(content, filePath, stat);
    evaluatedCount++;
    if (result.error !== undefined) {
      errorCount++;
      firstError ??= result.error;
    }
    return result;
  });

  if (!searchContents) {
    // Names only: search file and folder names
    const filesApi = new fdir()
      .withFullPaths()
      .exclude((dirName, dirPath) => shouldExcludePath(dirName, dirPath))
      .filter((filePath) => !shouldExcludePath(path.basename(filePath), filePath))
      .withAbortSignal(abortSignal)
      .crawl(folderPath);

    // With excludeFolders, folders are never crawled, so they can't take up
    // slots in the mostRecent window either.
    const dirsPromise: Promise<string[]> = excludeFolders
      ? Promise.resolve([])
      : new fdir()
        .withFullPaths()
        .exclude((dirName, dirPath) => shouldExcludePath(dirName, dirPath))
        .onlyDirs()
        .withAbortSignal(abortSignal)
        .crawl(folderPath)
        .withPromise();

    const [files, dirs] = await Promise.all([
      filesApi.withPromise(),
      dirsPromise,
    ]);
    // An aborted fdir crawl resolves early with partial output, so check here.
    signal?.throwIfAborted();

    // fdir's onlyDirs() returns EVERY directory path with a trailing separator
    // (e.g. "/root/sub/"), which causes two distinct problems if left as-is:
    //
    // 1. folderPath arrives without one, so a raw !== comparison never excludes
    //    the search root itself. Normalize both sides with path.resolve (which
    //    strips trailing separators) so the root is dropped.
    // 2. The trailing separator must NOT leak into SearchResult.path. Every
    //    other path in the app (and every file result here) is spelled without
    //    one, and SearchResult's contract is path === join(folderPath,
    //    relativePath). A trailing separator silently breaks last-segment
    //    parsing downstream — e.g. the renderer's getParentPath("/a/b/")
    //    returns "/a/b" (the folder itself, not its parent) and
    //    getFileName("/a/b/") returns "" — so folder results would navigate to
    //    the wrong place and show an empty name. path.relative() happens to
    //    strip it from relativePath, so only the absolute `path` field would
    //    carry the separator — a mismatch that's easy to miss.
    //
    // So: strip the trailing separator from each dir here, at the source, so
    // everything downstream (filterMostRecent, the statCache keys, buildResult)
    // sees one canonical spelling. Stripping cannot produce '' or collide with
    // a file: only the filesystem root reduces to bare separators, and that can
    // only appear as the (already dropped) search root.
    const resolvedRoot = path.resolve(folderPath);
    const dirEntries = dirs
      .filter(d => path.resolve(d) !== resolvedRoot)
      .map(d => d.replace(/[/\\]+$/, ''));
    const allEntries = [...files, ...dirEntries];
    // Folder results are flagged so the UI can tell them from files.
    const dirSet = new Set(dirEntries);

    // When mostRecent is enabled, limit to the 500 most recently modified entries.
    // filterMostRecent already stat'd them, so cache the times by path and feed
    // them to buildResult to avoid a second stat per entry.
    let entriesToSearch = allEntries;
    let statCache: Map<string, StatTimes> | null = null;
    if (mostRecent) {
      const recent = await filterMostRecent(allEntries, signal);
      entriesToSearch = recent.map(e => e.path);
      statCache = new Map(recent.map(e => [e.path, e]));
    }

    // Stat entries with bounded concurrency. mapWithConcurrency preserves input
    // order, so the pre-sort order is deterministic.
    const entryResults = await mapWithConcurrency(
      entriesToSearch,
      SEARCH_FILE_CONCURRENCY,
      async (entryPath): Promise<SearchResult | null> => {
        signal?.throwIfAborted();
        const entryName = path.basename(entryPath);
        const cachedStat = statCache?.get(entryPath);
        let matchCount = 1; // No query — every entry (mostRecent mode with empty query)
        if (matchPredicate) {
          const match = matchPredicate(entryName);
          if (!match.matches) return null;
          matchCount = match.matchCount;
        }
        const result = await buildResult(folderPath, entryPath, matchCount, cachedStat);
        return dirSet.has(entryPath) ? { ...result, isDirectory: true } : result;
      },
    );
    for (const r of entryResults) {
      if (r) results.push(r);
    }
  } else {
    // Match on the file CONTENTS, plus — when searchNames is also on — the file
    // NAME (a file is a hit if either matches).
    //
    // The name half applies to literal/wildcard queries only. An 'advanced' query
    // is a JavaScript expression written against file content: evaluating it
    // against a bare filename is meaningless for `p`/the date helpers, and a
    // negated expression (e.g. !$("draft")) would match nearly every file in the
    // tree. So advanced searches are content-only.
    const nameMatchActive = searchNames && matchPredicate !== null && matchType !== 'advanced';

    // The candidate set is narrowed to a "window" when mostRecent is on, and BOTH
    // halves of the search — name and content — then run inside that window. The
    // window is always drawn from the content candidates (.md/.txt, plus images
    // when searchImageExif is on), never from every file type: the 500 newest
    // must be the same 500 documents whether or not there is a query, without
    // recently touched attachments/binaries taking slots from notes.

    // Other file types (.pdf, .zip, …) can match by name, so the crawl widens
    // past the content candidates — but only when there is a name test and no
    // window, since a window never includes them.
    // A Tags or Type filter rules them out too: a file can only pass it once
    // its contents have been read.
    const broadCrawl = nameMatchActive && !mostRecent && !frontMatterFilter;

    const api = new fdir()
      .withFullPaths()
      .exclude((dirName, dirPath) => shouldExcludePath(dirName, dirPath))
      .filter((filePath) => {
        const fileName = path.basename(filePath);
        if (shouldExcludePath(fileName, filePath)) return false;
        if (broadCrawl) return true;
        return isCandidate(filePath);
      })
      .withAbortSignal(abortSignal)
      .crawl(folderPath);

    const crawled = await api.withPromise();
    // An aborted fdir crawl resolves early with partial output, so check here.
    signal?.throwIfAborted();
    const contentCandidates = broadCrawl
      ? crawled.filter(isCandidate)
      : crawled;

    // Build the window — the 500 most recently modified content candidates —
    // reusing the stats filterMostRecent captured (cached by path, fed to
    // buildResult) so no file is stat'd twice.
    const candidateWindow = mostRecent ? await filterMostRecent(contentCandidates, signal) : null;
    const statCache = candidateWindow ? new Map<string, StatTimes>(candidateWindow.map(e => [e.path, e])) : null;
    let filesToSearch = candidateWindow ? candidateWindow.map(e => e.path) : contentCandidates;

    // Name pass. Pure CPU and zero I/O, so it runs before anything is read: every
    // hit here is a file the content pass below never has to open. Without a
    // candidateWindow, crawled includes the non-content file types (broadCrawl).
    // With a Tags or Type filter a name hit still has to be read to check its
    // front matter, so the name test moves into the read loop below instead.
    const nameHits = new Map<string, number>();
    if (nameMatchActive && matchPredicate && !frontMatterFilter) {
      for (const filePath of candidateWindow ? filesToSearch : crawled) {
        const { matches, matchCount } = matchPredicate(path.basename(filePath));
        if (matches) nameHits.set(filePath, matchCount);
      }
    }
    // The short-circuit this feature exists for: don't read a file we've already
    // matched by name.
    if (nameHits.size > 0) {
      filesToSearch = filesToSearch.filter(fp => !nameHits.has(fp));
    }

    const nameResults = await mapWithConcurrency(
      [...nameHits],
      SEARCH_FILE_CONCURRENCY,
      async ([filePath, matchCount]): Promise<SearchResult> => {
        signal?.throwIfAborted();
        const result = await buildResult(folderPath, filePath, matchCount, statCache?.get(filePath));
        return { ...result, nameMatch: true };
      },
    );
    for (const r of nameResults) {
      results.push(r);
    }

    // Read + stat files with bounded concurrency. mapWithConcurrency preserves
    // input order, so the pre-sort order is deterministic.
    const fileResults = await mapWithConcurrency(
      filesToSearch,
      SEARCH_FILE_CONCURRENCY,
      async (filePath): Promise<SearchResult | null> => {
        signal?.throwIfAborted();
        const ext = path.extname(filePath).toLowerCase();
        const isImage = EXIF_IMAGE_EXTENSIONS.has(ext);
        const cachedStat = statCache?.get(filePath);

        // No query — return all files (mostRecent mode with empty query) —
        // unless a Tags or Type filter means each file must be read to check it.
        if (!matchPredicate && !frontMatterFilter) {
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
          // The query's `f.size`/`f.modified`/… need the stat; a failure just
          // leaves them undefined.
          if (!resultStat) {
            try {
              const stat = await fs.promises.stat(filePath);
              resultStat = { mtimeMs: stat.mtimeMs, birthtimeMs: stat.birthtimeMs, size: stat.size };
            } catch (err) {
              logger.debug('search: failed to stat image', filePath, err);
            }
          }
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

        if (!passesFrontMatterFilter(content, filePath)) return null;

        // Tags/Type alone (no query): every file that passes them is a hit.
        if (!matchPredicate) {
          return withSortKey(await buildResult(folderPath, filePath, 1, resultStat), content, resultStat);
        }

        // The name half, deferred to here when there is a Tags or Type filter
        // (see the name pass above): a name match still has to pass it.
        if (frontMatterFilter && nameMatchActive) {
          const nameMatch = matchPredicate(path.basename(filePath));
          if (nameMatch.matches) {
            const result = await buildResult(folderPath, filePath, nameMatch.matchCount, resultStat);
            return withSortKey({ ...result, nameMatch: true }, content, resultStat);
          }
        }

        const { matches, matchCount } = matchPredicate(content, filePath, resultStat);
        if (!matches) return null;

        // The content is in hand, so evaluate the custom sort key now rather
        // than re-reading the file in the pass below.
        return withSortKey(await buildResult(folderPath, filePath, matchCount, resultStat), content, resultStat);
      },
    );
    for (const r of fileResults) {
      if (r) results.push(r);
    }
  }

  if (evaluatedCount > 0 && errorCount === evaluatedCount) {
    throw new Error(`Advanced search query failed on every file it was evaluated against: ${firstError}`);
  }

  // Custom sort keys for the results whose contents were never read above.
  let sortable = results;
  if (baseSortKeyEvaluator) {
    sortable = await mapWithConcurrency(
      results,
      SEARCH_FILE_CONCURRENCY,
      async (r): Promise<SearchResult> => {
        if (r.sortKey !== undefined) return r;
        signal?.throwIfAborted();
        const { content, stat } = await readSortKeySource(r);
        return withSortKey(r, content, stat);
      },
    );
    if (sortEvaluatedCount > 0 && sortErrorCount === sortEvaluatedCount) {
      throw new Error(`Custom sort expression failed on every file it was evaluated against: ${firstSortError}`);
    }
  }

  // Sort by the user's chosen order, THEN cap, so the kept results are the ones
  // that order puts first — capping first would silently drop, say, the newest
  // matches from a "newest first" search.
  sortable.sort(compareSearchResults(sortBy, sortDirection));
  return { results: sortable.slice(0, SEARCH_RESULT_LIMIT), totalMatches: sortable.length };
}

/** {@link searchFolderWithTotal} without the total: just the capped, sorted results. */
export async function searchFolder(
  ...args: Parameters<typeof searchFolderWithTotal>
): Promise<SearchResult[]> {
  return (await searchFolderWithTotal(...args)).results;
}
