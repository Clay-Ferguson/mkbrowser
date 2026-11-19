/**
 * Process-neutral (pure) search helpers, safe to import from either the main
 * process or the renderer. The renderer-only helpers that touch the store / IPC
 * live in `searchUtil.ts`.
 */

import type { SearchDefinition, SearchSortBy, SearchSortDirection, SortKey, SortKeyScalar } from './shared';
import { sameTypeName } from './objects/genericObject';
import { formatDateTime12 } from './timeUtil';

/** The fields of a search result that the result ordering reads. */
interface SortableSearchResult {
  relativePath: string;
  modifiedTime?: number;
  createdTime?: number;
  sortKey?: SortKey;
}

/** Last path segment, for either separator. */
function baseName(relativePath: string): string {
  return relativePath.split(/[\\/]/).pop() || relativePath;
}

/** Compares two non-null sort-key values: numbers numerically and before
 * strings; strings case-insensitively, with digit runs compared as numbers. */
function compareSortScalars(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Compares two custom sort keys, element by element (a scalar counts as a
 * one-element array, and a shorter key counts as padded with nulls). `sign`
 * applies the direction to values only: a null (no value) sorts after any value
 * in either direction, both as a whole key and at any element.
 */
function compareSortKeys(a: SortKey | undefined, b: SortKey | undefined, sign: number): number {
  const aa: SortKeyScalar[] = Array.isArray(a) ? a : [a ?? null];
  const bb: SortKeyScalar[] = Array.isArray(b) ? b : [b ?? null];
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) {
    const x = aa[i] ?? null;
    const y = bb[i] ?? null;
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
      continue;
    }
    const cmp = compareSortScalars(x, y);
    if (cmp) return sign * cmp;
  }
  return 0;
}

/**
 * Comparator implementing the user's chosen result order (the Search dialog's
 * "Order" section: "Sort By" and "Direction"). The single source of truth for it: the
 * main process sorts with it before applying the result cap, so the results
 * that are kept are the ones the chosen order puts first, and the results view
 * sorts with it for display.
 *
 * File-name order compares base names, ignoring case. Time order treats a
 * missing timestamp as 0 (oldest). Custom order compares each result's
 * `sortKey` (see compareSortKeys), keeping results with no value last in
 * either direction. Ties fall back to the relative path, so the
 * order — and therefore which results survive the cap — is deterministic.
 *
 * See: (USER_GUIDE.md#search-results)
 */
export function compareSearchResults(
  sortBy: SearchSortBy,
  direction: SearchSortDirection,
): (a: SortableSearchResult, b: SortableSearchResult) => number {
  const sign = direction === 'asc' ? 1 : -1;
  return (a, b) => {
    if (sortBy === 'custom') {
      return compareSortKeys(a.sortKey, b.sortKey, sign) || a.relativePath.localeCompare(b.relativePath);
    }
    let cmp: number;
    if (sortBy === 'file-name') {
      cmp = baseName(a.relativePath).localeCompare(baseName(b.relativePath), undefined, { sensitivity: 'base' });
    } else if (sortBy === 'created-time') {
      cmp = (a.createdTime || 0) - (b.createdTime || 0);
    } else {
      cmp = (a.modifiedTime || 0) - (b.modifiedTime || 0);
    }
    return sign * cmp || a.relativePath.localeCompare(b.relativePath);
  };
}

/** Shown in the sort-value column when a result has no value for its sort. */
const NO_ORDER_VALUE = '—';

/**
 * The text of a search result's sort-value column (headed Created, Modified,
 * Name or Custom): the value the results were
 * sorted by, so the column is never blank. File-name order shows the base name
 * (what compareSearchResults compares), time orders show the timestamp, and
 * custom order shows the expression's formatted value. A missing value (a stat
 * that failed, a filesystem with no creation time, or a custom expression with
 * no result) shows as an em dash.
 *
 * See: (USER_GUIDE.md#search-results)
 */
export function formatOrderValue(
  result: SortableSearchResult & { sortLabel?: string },
  sortBy: SearchSortBy,
): string {
  switch (sortBy) {
    case 'custom':
      return result.sortLabel || NO_ORDER_VALUE;
    case 'file-name':
      return baseName(result.relativePath);
    case 'created-time':
      return result.createdTime ? formatDateTime12(result.createdTime) : NO_ORDER_VALUE;
    case 'modified-time':
      return result.modifiedTime ? formatDateTime12(result.modifiedTime) : NO_ORDER_VALUE;
  }
}

/**
 * A new, unnamed search with the Search dialog's default options.
 *
 * See: (USER_GUIDE.md#using-search)
 */
export function newSearchDefinition(searchText = ''): SearchDefinition {
  return {
    name: '',
    searchText,
    searchContents: true,
    searchNames: false,
    matchType: 'literal',
    sortBy: 'modified-time',
    sortDirection: 'desc',
    tags: '',
    type: '',
    searchImageExif: false,
    mostRecent: false,
  };
}

/**
 * The parsed form of a search's Tags field: the tag names a file must have
 * (`include`) and must not have (`exclude`), lowercased and without `#`.
 *
 * See: (USER_GUIDE.md#using-search)
 */
export interface TagFilter {
  include: string[];
  exclude: string[];
}

/**
 * Parses a Tags field such as `purchased, #P1, !done`: comma-separated names,
 * each trimmed, a leading `!` marking a tag that must be absent, leading `#`s
 * dropped (tags are stored without one), and lowercased so matching ignores
 * case. Empty entries are skipped. Returns null when no tag is left, meaning
 * "no tag filter".
 *
 * See: (USER_GUIDE.md#using-search)
 */
export function parseTagFilter(raw: string | undefined): TagFilter | null {
  if (!raw) return null;
  const include: string[] = [];
  const exclude: string[] = [];
  for (const part of raw.split(',')) {
    let name = part.trim();
    const negated = name.startsWith('!');
    if (negated) name = name.slice(1).trim();
    name = name.replace(/^#+/, '').trim().toLowerCase();
    if (!name) continue;
    (negated ? exclude : include).push(name);
  }
  return include.length || exclude.length ? { include, exclude } : null;
}

/**
 * Whether parsed front matter has the object type `type` (a search's Type
 * field): its root `type` property is a string equal to `type`, ignoring case
 * (type names are case-insensitive) and surrounding whitespace on both sides.
 * An empty `type` matches every file.
 *
 * See: (USER_GUIDE.md#using-search)
 */
export function matchesTypeFilter(frontMatter: Record<string, unknown> | null, type: string): boolean {
  const wanted = type.trim();
  if (!wanted) return true;
  // hasOwn, not `frontMatter.type`: never read an inherited property off parsed, untrusted data.
  const raw = frontMatter && Object.hasOwn(frontMatter, 'type') ? frontMatter['type'] : undefined;
  return typeof raw === 'string' && sameTypeName(raw.trim(), wanted);
}

/**
 * Whether a file with front matter tags `fileTags` passes `filter`: it has every
 * included tag and none of the excluded ones, comparing whole names ignoring case.
 *
 * See: (USER_GUIDE.md#using-search)
 */
export function matchesTagFilter(fileTags: readonly string[], filter: TagFilter): boolean {
  const have = new Set(fileTags.map(t => t.replace(/^#+/, '').toLowerCase()));
  return filter.include.every(t => have.has(t)) && !filter.exclude.some(t => have.has(t));
}

/**
 * The built-in "Recent Files" search (Tools → Recent Files): the 500 most
 * recently modified entries under the folder, newest first, with no query.
 *
 * It searches names only (`searchContents: false`) on purpose. With File
 * Contents on, the Recent Files window is drawn only from content candidates
 * (.md/.txt), whereas the names-only path takes the newest entries of every
 * file type, which is what this listing is meant to show. `excludeFolders`
 * keeps folders (which the names-only path would otherwise include) out of it.
 *
 * `internal` marks it as never-to-be-saved; see saveSearchDefinitionToConfig.
 *
 * See: (USER_GUIDE.md#recent-files)
 */
export function recentFilesSearchDefinition(): SearchDefinition {
  return {
    ...newSearchDefinition(),
    name: 'Recent Files',
    searchContents: false,
    searchNames: true,
    mostRecent: true,
    excludeFolders: true,
    sortBy: 'modified-time',
    sortDirection: 'desc',
    internal: true,
  };
}

/**
 * The search the Search dialog starts with. Editing a saved search always shows
 * that search's own query — even an empty one (a Recent Files search with no
 * text) — never the global highlight, or saving from the dialog would quietly
 * replace the stored query with unrelated text. Only a brand-new search (no
 * initial definition) is prefilled with the current highlight text. The
 * optional flags are filled in, so everything the dialog produces has them.
 */
export function initialSearchDefinition(
  initial: SearchDefinition | undefined,
  highlightText: string | null,
): SearchDefinition {
  if (!initial) return newSearchDefinition(highlightText ?? '');
  return {
    ...initial,
    tags: initial.tags ?? '',
    type: initial.type ?? '',
    searchImageExif: initial.searchImageExif ?? false,
    mostRecent: initial.mostRecent ?? false,
  };
}

/**
 * Whether the Search dialog's form differs from the saved definition it is
 * editing, i.e. whether Save would change anything. Both sides are normalized
 * the way the dialog loads and saves them (missing optional flags count as
 * false, the query and sort expression are saved trimmed), so merely opening a saved search never
 * reads as an unsaved change. The name is not compared: renames are saved
 * separately, straight from the definitions list.
 */
export function isSearchDefinitionDirty(form: SearchDefinition, saved: SearchDefinition): boolean {
  const a = initialSearchDefinition(form, null);
  const b = initialSearchDefinition(saved, null);
  return a.searchText.trim() !== b.searchText.trim()
    || a.searchContents !== b.searchContents
    || a.searchNames !== b.searchNames
    || a.matchType !== b.matchType
    || a.sortBy !== b.sortBy
    || a.sortDirection !== b.sortDirection
    || (a.sortExpression ?? '').trim() !== (b.sortExpression ?? '').trim()
    || (a.tags ?? '').trim() !== (b.tags ?? '').trim()
    || (a.type ?? '').trim() !== (b.type ?? '').trim()
    || a.searchImageExif !== b.searchImageExif
    || a.mostRecent !== b.mostRecent;
}

/**
 * Validates a name typed for a saved search (new or renamed). Returns an error
 * message, or null when the name is usable. Names are compared trimmed and
 * case-insensitively, so "Foo" and "foo " can't both exist; `currentName` (the
 * definition being renamed) is excluded, so a case-only rename is allowed.
 *
 * See: (USER_GUIDE.md#saving-search-definitions)
 */
export function validateSearchDefinitionName(
  name: string,
  existingNames: string[],
  currentName?: string,
): string | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return 'Name is required.';
  const clash = existingNames.some((n) => n !== currentName && n.trim().toLowerCase() === wanted);
  return clash ? `A search named "${name.trim()}" already exists.` : null;
}

/**
 * Parse a newline-delimited ignored-paths string into a trimmed, non-empty array.
 *
 * See: (USER_GUIDE.md#files-to-ignore)
 */
export function parseIgnoredPaths(raw: string): string[] {
  return raw
    .split('\n')
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Builds an advanced query that matches files whose text contains `hashtag` (e.g.
 * `#foo`) as a whole, case-sensitive hashtag: `#foo` but not `#foobar`,
 * `#foo-bar` or `x#foo`. The boundaries mirror HASHTAG_REGEX, the rule Folder
 * Analysis counts content hashtags with. Used by Ctrl+click on a Content Hashtag.
 *
 * See: (USER_GUIDE.md#clicking-a-tag)
 */
export function exactHashtagQuery(hashtag: string): string {
  const escaped = hashtag.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return `/(?<![^\\s])${escaped}(?![\\w-])/.test(f.content)`;
}

/**
 * Creates the content-matching helpers for an advanced query against one file,
 * and tracks the total number of matches found:
 *  - `$(text)` — the content contains `text` (case-insensitive substring).
 *  - `tag(name)` — the file's front matter `tags` list contains exactly `name`
 *    (case-sensitive, whole name). Tags are stored without a `#`, so
 *    `tag('foo')` is the way to ask for one; `tag('#foo')` never matches.
 *
 * @param content - The text content to search within
 * @param getTags - Returns the file's front matter tag names. Called lazily, on
 *   the first tag() call only, so queries that never use tag() don't pay for it.
 * @returns The helpers and a match count getter
 *
 * See: (USER_GUIDE.md#using-search)
 */
export function createContentSearcher(content: string, getTags: () => readonly string[]): {
  $: (searchText: string) => boolean;
  tag: (name: string) => boolean;
  getMatchCount: () => number;
} {
  const contentLower = content.toLowerCase();
  let matchCount = 0;

  const $ = (searchText: string): boolean => {
    const searchLower = searchText.toLowerCase();
    // Guard the empty needle: indexOf('', idx) always returns idx (never -1) and
    // idx += 0 never advances, so the counting loop below would spin forever. An
    // empty search text is treated as "no match" (this runs in the main process
    // against user-supplied advanced queries like `$('')`, which must not hang it).
    if (searchLower.length === 0) return false;
    // Count occurrences with a single scan; the first indexOf also answers
    // "found?" (count > 0), so no separate includes() pre-check is needed.
    let count = 0;
    let idx = 0;
    while ((idx = contentLower.indexOf(searchLower, idx)) !== -1) {
      count++;
      idx += searchLower.length;
    }
    if (count > 0) {
      matchCount += count;
      return true;
    }
    return false;
  };

  // The file's front matter tags, read on the first tag() call (once, however
  // many tags the query tests).
  let tags: readonly string[] | null = null;
  const tag = (name: string): boolean => {
    tags ??= getTags();
    const found = tags.includes(name);
    if (found) matchCount += 1;
    return found;
  };

  const getMatchCount = (): number => matchCount;

  return { $, tag, getMatchCount };
}

/**
 * Summarize the outcome of a search-and-replace operation as a human-readable
 * string. Reports total replacement count, number of files modified, and (if
 * any) how many files could not be processed.
 *
 * See: (USER_GUIDE.md#results-summary)
 */
export function buildReplaceResultMessage(results: Array<{ success: boolean; replacementCount: number }>): string {
  const successfulFiles = results.filter((r) => r.success);
  const totalReplacements = successfulFiles.reduce((sum, r) => sum + r.replacementCount, 0);
  const failedFiles = results.filter((r) => !r.success);

  let message = totalReplacements > 0
    ? `Replaced ${totalReplacements} occurrence${totalReplacements === 1 ? '' : 's'} in ${successfulFiles.length} file${successfulFiles.length === 1 ? '' : 's'}.`
    : 'No matches found.';

  if (failedFiles.length > 0) {
    message += `\n\n${failedFiles.length} file${failedFiles.length === 1 ? '' : 's'} could not be processed.`;
  }

  return message;
}
