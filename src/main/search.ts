/**
 * Core search logic extracted from the IPC handler for testability.
 *
 * This module implements folder-level search across .md and .txt files,
 * supporting literal, wildcard, and advanced (JavaScript expression) search types.
 *
 * Two search targets ("Search Target" in the Search dialog):
 *  - 'content' — "File Contents+Names": a file is a hit when the query matches its
 *    NAME *or* its CONTENTS. Contents are only read for .md/.txt (plus images when
 *    searchImageExif is on), but the *name* half covers every file extension —
 *    except under mostRecent/calendarItemsOnly, where both halves run inside a
 *    window drawn from those content files only. The name test is pure CPU, so it
 *    runs first and short-circuits: a name-matched file is never read. Folders are
 *    never matched in this mode.
 *  - 'filenames' — "File Names": names only, but including folder names.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fdir } from 'fdir';
import * as ExifReader from 'exifreader';
import { loadYaml } from '../shared/yamlUtil';
import { parseDateString, past, future, today } from '../shared/timeUtil';
import { createContentSearcher, compareSearchResults } from '../shared/searchHelpers';
import type { SearchDefinition, SearchMatchType } from '../shared/shared';
import { compileAdvancedQuery, AdvancedQueryRuntimeError, AdvancedQueryTimeoutError } from './advancedQuery';
import { splitFrontMatter } from '../shared/frontMatterUtil';
import { isCalendarFrontMatter } from '../shared/calendarUtil';
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

/** Image extensions supported by ExifReader for EXIF metadata search */
const EXIF_IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.bmp', '.ico', '.tiff', '.tif', '.avif',
]);

/**
 * True if a file's *contents* are searchable in 'content' mode. The name half of
 * that mode deliberately does NOT consult this — every extension can match by
 * name. Shared by the crawl filter and the candidate partition so the two can
 * never disagree about what "readable" means.
 */
function isContentCandidate(filePath: string, searchImageExif: boolean, calendarItemsOnly: boolean): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md') return true;
  // Calendar items are markdown-only, so nothing else can be a candidate —
  // not .txt, and not images even with searchImageExif on.
  if (calendarItemsOnly) return false;
  if (ext === '.txt') return true;
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
  /** Set (in 'content' mode only) when this file matched on its NAME, meaning its
   * contents were never read — so matchCount counts occurrences within the file
   * name, not within the body. The renderer shows "name match" rather than a count. */
  nameMatch?: boolean;
  /** Set when the result is a folder (only 'filenames' mode returns folders). */
  isDirectory?: boolean;
}

/** Match predicate result */
interface MatchResult {
  matches: boolean;
  matchCount: number;
  /** Set (advanced mode only) when the query threw while being evaluated
   * against this input, which then counts as a non-match. */
  error?: string;
}

/** Convert a wildcard pattern to a global, case-insensitive regex (each * matches up to 25 chars). */
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
  type: SearchMatchType,
  cache: YamlCache = new Map()
): (content: string, filePath?: string) => MatchResult {
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

    return (content: string, filePath?: string) => {
      if (timedOut) throw timedOut;
      const { $, tag, getMatchCount } = createContentSearcher(content);
      const prop = createPropFunction(cache, content, filePath);
      try {
        const matches = evalFunction({ $, tag, prop, past, future, today });
        const matchCount = getMatchCount();
        return {
          matches,
          matchCount: matches ? Math.max(matchCount, 1) : 0,
        };
      } catch (err) {
        // A runtime error while evaluating the (validly-compiled) query against
        // this file's content — e.g. `prop('a').b` on a file without `a`. Treat
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

/**
 * Predicate for a Wild Card search in the File Names target: a glob over the
 * WHOLE name, where `*` matches any number of characters — `*.md` matches names
 * ending in .md (not `notes.md.bak`), `report*` names starting with "report".
 * Case-insensitive. Content wildcards (and the name half of a File
 * Contents+Names search) stay unanchored substring matches; see
 * createMatchPredicate.
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

/** Sort already-stat'd entries newest-first and keep the top MOST_RECENT_LIMIT.
 * Split out from filterMostRecent so a candidate set that has *already* been
 * stat'd (the calendar pre-pass below) can be trimmed without a second stat. */
function takeMostRecent(entries: StatEntry[]): StatEntry[] {
  // Copy before sorting: the caller's array is its own candidate list, and the
  // pre-pass ordering shouldn't be clobbered as a side effect of trimming.
  return [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MOST_RECENT_LIMIT);
}

/**
 * Filter an array of file paths to the MOST_RECENT_LIMIT most recently modified,
 * carrying each one's captured stat times along for buildResult to reuse.
 */
async function filterMostRecent(filePaths: string[], signal?: AbortSignal): Promise<StatEntry[]> {
  return takeMostRecent(await statEntries(filePaths, signal));
}

/**
 * Reduce a candidate list to the *calendar files* in it — markdown files whose
 * front matter carries a parseable `due:` (see isCalendarFrontMatter, which is
 * the boolean form of the rule calendarLoader.ts uses to admit a calendar item,
 * so search and the Calendar view can never disagree).
 *
 * Runs as a pre-pass, before the mostRecent trim, so "Recent Files + Calendar
 * Items Only" yields the newest *calendar* items rather than the calendar subset
 * of the newest files (which is frequently empty in a large tree).
 *
 * Each file is read once here and its front matter parsed into `yamlCache`, so
 * the match phase's advanced-query prop() lookups don't re-parse it; the returned
 * StatEntry values also feed buildResult's cachedStat, removing the stat the
 * match phase would otherwise do. Net extra I/O is therefore one re-read of the
 * (much smaller) surviving calendar subset.
 */
async function filterCalendarFiles(filePaths: string[], yamlCache: YamlCache, signal?: AbortSignal): Promise<StatEntry[]> {
  const mdFiles = filePaths.filter(fp => path.extname(fp).toLowerCase() === '.md');
  const entries = await mapWithConcurrency(
    mdFiles,
    SEARCH_FILE_CONCURRENCY,
    async (fp): Promise<StatEntry | null> => {
      signal?.throwIfAborted();
      // Only the stat/read is wrapped: an unreadable or oversized file is an
      // expected I/O condition we skip the same way the match phase does. The
      // calendar test itself stays outside the catch so a genuine bug there
      // surfaces instead of being miscategorized as "file skipped".
      let times: StatTimes;
      let content: string;
      try {
        const stat = await fs.promises.stat(fp);
        times = { mtimeMs: stat.mtimeMs, birthtimeMs: stat.birthtimeMs, size: stat.size };
        if (times.size > MAX_SEARCH_FILE_BYTES) {
          logger.debug('search: skipping oversized file', fp, times.size);
          return null;
        }
        content = await fs.promises.readFile(fp, 'utf-8');
      } catch (err) {
        logger.debug('search: skipping unreadable file in calendar filter', fp, err);
        return null;
      }
      if (!isCalendarFrontMatter(getYaml(yamlCache, content, fp))) return null;
      return { path: fp, ...times };
    },
  );
  return entries.filter((e): e is StatEntry => e !== null);
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
 * - `target` — 'content' (file bodies OR file names — see the module header;
 *   the name half is skipped for 'advanced', which stays content-only) or 'filenames'
 *   (file *and folder* names only)
 * - `ignoredPaths` — path patterns to exclude (supports wildcards)
 * - `searchImageExif` — whether to include image files and search their EXIF metadata
 * - `mostRecent` — whether to limit search to the 500 most recently modified files.
 *   In 'content' mode those are the 500 newest content files (.md/.txt, plus images
 *   with searchImageExif), and both name and content matching run inside that set;
 *   in 'filenames' mode, the 500 newest files and folders.
 * - `calendarItemsOnly` — whether to restrict the search to calendar files (markdown
 *   with a parseable `due:` front-matter property). Applied *before* the mostRecent trim,
 *   and it also makes searchImageExif moot since an image can never be a calendar file.
 *   Ignored in 'filenames' mode (the Search dialog disables the option there).
 * - `sortBy` — result order (see compareSearchResults); decides which
 *   results survive the cap
 * - `sortDirection` — 'asc' or 'desc'
 * - `signal` — cancels the search: it is checked after each crawl and
 *   before each file is stat'd, read or matched, and an abort rejects the search
 *   with the signal's reason. Partial results are never returned.
 * @returns The results in the requested order, capped at SEARCH_RESULT_LIMIT,
 *   plus the total number of matches before the cap
 */
export async function searchFolderWithTotal(
  folderPath: string,
  query: string,
  {
    matchType = 'literal',
    target = 'content',
    ignoredPaths = [],
    searchImageExif = false,
    mostRecent = false,
    calendarItemsOnly = false,
    sortBy = 'modified-time',
    sortDirection = 'desc',
    signal,
  }: SearchFolderOptions = {},
): Promise<{ results: SearchResult[]; totalMatches: number }> {
  signal?.throwIfAborted();
  // fdir's withAbortSignal needs a real signal; one that never aborts stands in.
  const abortSignal = signal ?? new AbortController().signal;
  const yamlCache: YamlCache = new Map();
  const results: SearchResult[] = [];
  const shouldExcludePath = buildExcludePredicate(ignoredPaths);
  const hasQuery = query.trim().length > 0;
  const basePredicate: ((content: string, filePath?: string) => MatchResult) | null = !hasQuery
    ? null
    : target === 'filenames' && matchType === 'wildcard'
      ? createFileNameGlobPredicate(query)
      : createMatchPredicate(query, matchType, yamlCache);

  // Track advanced-query runtime errors. One file throwing is normal (the query
  // may assume front matter only some files have), but a query that threw on
  // EVERY file it was evaluated against — typically a typo such as `Prop(...)`
  // — would otherwise look exactly like "no results".
  let evaluatedCount = 0;
  let errorCount = 0;
  let firstError: string | undefined;
  const matchPredicate = basePredicate && ((content: string, filePath?: string): MatchResult => {
    // Every name/content match goes through here, so this is also the
    // cancellation checkpoint for the CPU-only name passes.
    signal?.throwIfAborted();
    const result = basePredicate(content, filePath);
    evaluatedCount++;
    if (result.error !== undefined) {
      errorCount++;
      firstError ??= result.error;
    }
    return result;
  });

  if (target === 'filenames') {
    // Search file and folder names
    const filesApi = new fdir()
      .withFullPaths()
      .exclude((dirName, dirPath) => shouldExcludePath(dirName, dirPath))
      .filter((filePath) => !shouldExcludePath(path.basename(filePath), filePath))
      .withAbortSignal(abortSignal)
      .crawl(folderPath);

    const dirsApi = new fdir()
      .withFullPaths()
      .exclude((dirName, dirPath) => shouldExcludePath(dirName, dirPath))
      .onlyDirs()
      .withAbortSignal(abortSignal)
      .crawl(folderPath);

    const [files, dirs] = await Promise.all([
      filesApi.withPromise(),
      dirsApi.withPromise(),
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
    // "File Contents+Names": match on the file NAME or the file CONTENTS.
    //
    // The name half applies to literal/wildcard queries only. An 'advanced' query
    // is a JavaScript expression written against file content: evaluating it
    // against a bare filename is meaningless for prop()/the date helpers, and a
    // negated expression (e.g. !$("draft")) would match nearly every file in the
    // tree. So advanced searches are content-only.
    const nameMatchActive = matchPredicate !== null && matchType !== 'advanced';

    // The candidate set is narrowed to a "window" when calendarItemsOnly or
    // mostRecent is on, and BOTH halves of the search — name and content — then
    // run inside that window. The window is always drawn from the content
    // candidates (.md/.txt, plus images when searchImageExif is on), never from
    // every file type: "only calendar items" must stay true, and the 500 newest
    // must be the same 500 documents whether or not there is a query, without
    // recently touched attachments/binaries taking slots from notes.
    const narrowed = calendarItemsOnly || mostRecent;

    // Other file types (.pdf, .zip, …) can match by name, so the crawl widens
    // past the content candidates — but only when there is a name test and no
    // window, since a window never includes them.
    const broadCrawl = nameMatchActive && !narrowed;

    const api = new fdir()
      .withFullPaths()
      .exclude((dirName, dirPath) => shouldExcludePath(dirName, dirPath))
      .filter((filePath) => {
        const fileName = path.basename(filePath);
        if (shouldExcludePath(fileName, filePath)) return false;
        if (broadCrawl) return true;
        return isContentCandidate(filePath, searchImageExif, calendarItemsOnly);
      })
      .withAbortSignal(abortSignal)
      .crawl(folderPath);

    const crawled = await api.withPromise();
    // An aborted fdir crawl resolves early with partial output, so check here.
    signal?.throwIfAborted();
    const contentCandidates = broadCrawl
      ? crawled.filter(fp => isContentCandidate(fp, searchImageExif, calendarItemsOnly))
      : crawled;

    // Build the window, reusing the stats each filter captured (cached by path,
    // fed to buildResult) so no file is stat'd twice:
    //  - calendarItemsOnly: the calendar files, then — with mostRecent — the
    //    newest 500 *of those* (see filterCalendarFiles).
    //  - mostRecent alone: the 500 most recently modified content candidates.
    let candidateWindow: StatEntry[] | null = null;
    if (calendarItemsOnly) {
      candidateWindow = await filterCalendarFiles(contentCandidates, yamlCache, signal);
      if (mostRecent) candidateWindow = takeMostRecent(candidateWindow);
    } else if (mostRecent) {
      candidateWindow = await filterMostRecent(contentCandidates, signal);
    }
    const statCache = candidateWindow ? new Map<string, StatTimes>(candidateWindow.map(e => [e.path, e])) : null;
    let filesToSearch = candidateWindow ? candidateWindow.map(e => e.path) : contentCandidates;

    // Name pass. Pure CPU and zero I/O, so it runs before anything is read: every
    // hit here is a file the content pass below never has to open. Without a
    // candidateWindow, crawled includes the non-content file types (broadCrawl).
    const nameHits = new Map<string, number>();
    if (nameMatchActive && matchPredicate) {
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

  if (evaluatedCount > 0 && errorCount === evaluatedCount) {
    throw new Error(`Advanced search query failed on every file it was evaluated against: ${firstError}`);
  }

  // Sort by the user's chosen order, THEN cap, so the kept results are the ones
  // that order puts first — capping first would silently drop, say, the newest
  // matches from a "newest first" search.
  results.sort(compareSearchResults(sortBy, sortDirection));
  return { results: results.slice(0, SEARCH_RESULT_LIMIT), totalMatches: results.length };
}

/** {@link searchFolderWithTotal} without the total: just the capped, sorted results. */
export async function searchFolder(
  ...args: Parameters<typeof searchFolderWithTotal>
): Promise<SearchResult[]> {
  return (await searchFolderWithTotal(...args)).results;
}
