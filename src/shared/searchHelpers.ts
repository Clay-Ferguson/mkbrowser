/**
 * Process-neutral (pure) search helpers, safe to import from either the main
 * process or the renderer. The renderer-only helpers that touch the store / IPC
 * live in `searchUtil.ts`.
 */

import type { SearchDefinition, SearchSortBy, SearchSortDirection, SortKey, SortKeyScalar } from './shared';
import { sameTypeName } from './objects/genericObject';
import { datePrefixTimestamp, formatDateTime12 } from './timeUtil';
import { isAllTagCategory } from './tagUtil';

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
 * A copy of `rows` sorted by each row's text (`textOf`), for the Search Results
 * table's click-to-sort columns. Text that starts with a date (see
 * datePrefixTimestamp: `YYYY-MM-DD`, `MM/DD/YYYY` or `MM/DD/YY`, with an optional
 * time) is compared as a date, so no column needs to be declared a date column.
 * Dates always sort above text that isn't a date, in either direction, so blank
 * (`—`) and other non-date values stay at the bottom. Other text is compared
 * case-insensitively, with digit runs compared as numbers (so `p2` comes before
 * `p10`). The sort is stable, so rows with equal values keep their order in
 * `rows`: the search's own order. `rows` itself is left untouched; the copy
 * holds the same row objects.
 *
 * See: (USER_GUIDE.md#sorting-by-a-column)
 */
export function sortByText<T>(rows: readonly T[], textOf: (row: T) => string, direction: SearchSortDirection): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  // Each row's text and date are worked out once, not on every comparison.
  const keyed = rows.map(row => {
    const text = textOf(row);
    return { row, text, time: datePrefixTimestamp(text) };
  });
  keyed.sort((a, b) => {
    const aIsDate = !Number.isNaN(a.time);
    const bIsDate = !Number.isNaN(b.time);
    if (aIsDate !== bIsDate) return aIsDate ? -1 : 1;
    if (aIsDate) return sign * (a.time - b.time);
    return sign * a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: 'base' });
  });
  return keyed.map(k => k.row);
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
    tagCategoryCols: '',
    propertyCols: '',
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
 * Parses a search's Types field, a comma-delimited list of object type names
 * such as `todo, person`, into its trimmed, non-empty names. An empty list means
 * no type filter.
 *
 * See: (USER_GUIDE.md#using-search)
 */
export function parseTypeFilter(text: string): string[] {
  return text.split(',').map(t => t.trim()).filter(t => t.length > 0);
}

/**
 * Whether parsed front matter has any of the object types `types` (a search's
 * Types field, parsed by parseTypeFilter; the types are ORed): its root `type`
 * property is a string equal to one of them, ignoring case (type names are
 * case-insensitive) and surrounding whitespace on both sides. An empty `types`
 * matches every file.
 *
 * See: (USER_GUIDE.md#using-search)
 */
export function matchesTypeFilter(frontMatter: Record<string, unknown> | null, types: readonly string[]): boolean {
  if (types.length === 0) return true;
  // hasOwn, not `frontMatter.type`: never read an inherited property off parsed, untrusted data.
  const raw = frontMatter && Object.hasOwn(frontMatter, 'type') ? frontMatter['type'] : undefined;
  if (typeof raw !== 'string') return false;
  const actual = raw.trim();
  return types.some(wanted => sameTypeName(actual, wanted.trim()));
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

/** Strips leading `#`s and lowercases a tag name, the form tags are compared in. */
function normalizeTagName(tag: string): string {
  return tag.replace(/^#+/, '').trim().toLowerCase();
}

/**
 * Parses a search's Tag Category Columns field (`tagCategoryCols`), such as
 * `priority, ALL`, into the category names it lists, in order: each trimmed,
 * empty entries skipped, and a name repeated (ignoring case) kept only once.
 *
 * See: (USER_GUIDE.md#tag-category-columns)
 */
export function parseTagCategoryCols(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/**
 * The names in `names` that are not tag categories: neither the special ALL
 * category nor (ignoring case) one of `knownCategories`. Used to warn about a
 * likely typo in the Tag Category Columns field.
 *
 * See: (USER_GUIDE.md#tag-category-columns)
 */
export function unknownTagCategories(names: readonly string[], knownCategories: readonly string[]): string[] {
  const known = new Set(knownCategories.map(c => c.toLowerCase()));
  return names.filter(n => !isAllTagCategory(n) && !known.has(n.toLowerCase()));
}

/**
 * The tag-to-category map (`AppState.tagCategoryByTag`) keyed by normalized
 * (lowercased, `#`-less) tag name, for tagCategoryCellValue's case-insensitive
 * lookups. Values are the category names, lowercased.
 */
export function tagCategoryLookup(tagCategoryByTag: Readonly<Record<string, string>>): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [tag, category] of Object.entries(tagCategoryByTag)) {
    const key = normalizeTagName(tag);
    const existing = lookup.get(key);
    // Same preference as tagCategoryByTag itself: a specific category beats "all".
    if (existing === undefined || (isAllTagCategory(existing) && !isAllTagCategory(category))) {
      lookup.set(key, category.toLowerCase());
    }
  }
  return lookup;
}

/**
 * The tags shown in one tag category column for one result, sorted, as they are
 * spelled in its front matter. For an ordinary category: the file's tags in that
 * category (normally just one, since such a category's tags are mutually
 * exclusive; all of them if the file breaks that rule). For ALL: every tag on
 * the file except those defined in some other (non-ALL) category, so tags not
 * in tags.yaml at all are included. Comparison ignores case and a leading `#`.
 *
 * See: (USER_GUIDE.md#tag-category-columns)
 */
export function tagCategoryCellValue(
  fileTags: readonly string[] | undefined,
  category: string,
  lookup: ReadonlyMap<string, string>,
): string[] {
  if (!fileTags || fileTags.length === 0) return [];
  const all = isAllTagCategory(category);
  const wanted = category.toLowerCase();
  const seen = new Set<string>();
  const shown: string[] = [];
  for (const tag of fileTags) {
    const key = normalizeTagName(tag);
    if (!key || seen.has(key)) continue;
    const tagCategory = lookup.get(key);
    const include = all
      ? tagCategory === undefined || isAllTagCategory(tagCategory)
      : tagCategory === wanted;
    if (!include) continue;
    seen.add(key);
    shown.push(tag.replace(/^#+/, '').trim());
  }
  return shown.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** The priority levels a PRIORITY tag category column calls out with color. */
export type PriorityHighlight = 'p1' | 'p2';

/**
 * Which highlight a tag category cell gets: in a column for the category named
 * `priority` (ignoring case), `p1` when the cell holds a `p1` tag and otherwise
 * `p2` for a `p2` tag (tags compared ignoring case), so the most urgent files
 * stand out; null for any other cell.
 *
 * See: (USER_GUIDE.md#tag-category-columns)
 */
export function priorityHighlight(category: string, cellTags: readonly string[]): PriorityHighlight | null {
  if (category.trim().toLowerCase() !== 'priority') return null;
  const tags = new Set(cellTags.map(t => t.toLowerCase()));
  return tags.has('p1') ? 'p1' : tags.has('p2') ? 'p2' : null;
}

/** The Properties field value that asks for every discovered property. */
export const ALL_PROPERTIES = '*';

/** One property name in the Properties field: one or more dot-separated
 * segments of letters, digits, `_`, `$` and `-` (so `due`, `author.name`). */
const PROPERTY_NAME_RE = /^[\p{L}\p{N}_$-]+(\.[\p{L}\p{N}_$-]+)*$/u;

/** The Properties field's entries, trimmed, with empty entries skipped. */
function propertyColEntries(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map(p => p.trim()).filter(p => p !== '');
}

/**
 * Parses a search's Properties field (`propertyCols`), such as `type, due`,
 * into the property names it lists, in order: each trimmed, empty entries
 * skipped, and a repeated name kept only once (names are case-sensitive, like
 * YAML keys). A field that is just `*` returns ALL_PROPERTIES, meaning every
 * property found in the results (see discoverPropertyNames).
 *
 * See: (USER_GUIDE.md#property-columns)
 */
export function parsePropertyCols(raw: string | undefined): string[] | typeof ALL_PROPERTIES {
  if ((raw ?? '').trim() === ALL_PROPERTIES) return ALL_PROPERTIES;
  return [...new Set(propertyColEntries(raw))];
}

/**
 * The entries in a Properties field that are not usable property names (see
 * PROPERTY_NAME_RE): e.g. `due date`, `a..b`, or a `*` alongside other names.
 * A field that is just `*` has none. The Search dialog refuses to search or
 * save while there are any.
 *
 * See: (USER_GUIDE.md#property-columns)
 */
export function invalidPropertyCols(raw: string | undefined): string[] {
  if ((raw ?? '').trim() === ALL_PROPERTIES) return [];
  return propertyColEntries(raw).filter(p => !PROPERTY_NAME_RE.test(p));
}

/** A plain (non-array, non-Date) object, such as a parsed YAML mapping. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * The value at a dotted property path (`due`, `author.name`) in a result's
 * front matter, or undefined when any step along the path is missing or not an
 * object.
 *
 * See: (USER_GUIDE.md#property-columns)
 */
export function propertyValue(frontMatter: Record<string, unknown> | undefined, propertyPath: string): unknown {
  let value: unknown = frontMatter;
  for (const key of propertyPath.split('.')) {
    if (!isPlainObject(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

/** Two digits, zero-padded. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * A property value as a property column shows it, or null for no value
 * (missing, null, or a blank string). Strings (whitespace collapsed to single
 * spaces), numbers and booleans are shown as they are, so a date such as
 * `2026-03-01` (which our YAML loader keeps as a string) shows as written. A
 * Date object, should one ever arrive (a YAML 1.1 timestamp loader makes them),
 * is shown as `YYYY-MM-DD`, plus ` HH:mm` when it has a time of day; YAML
 * timestamps are UTC, so UTC fields give back what was typed. Anything else (a
 * list or a mapping) is shown as `obj.`.
 *
 * See: (USER_GUIDE.md#property-columns)
 */
export function formatPropertyValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const date = `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
    const hasTime = value.getUTCHours() !== 0 || value.getUTCMinutes() !== 0 || value.getUTCSeconds() !== 0;
    return hasTime ? `${date} ${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}` : date;
  }
  return 'obj.';
}

/**
 * Every top-level front matter property found in `results`, in the order each
 * is first seen, for a Properties field of `*`. `tags` is left out, since the
 * tag category columns already show tags.
 *
 * See: (USER_GUIDE.md#property-columns)
 */
export function discoverPropertyNames(results: readonly { frontMatter?: Record<string, unknown> }[]): string[] {
  const names = new Set<string>();
  for (const result of results) {
    for (const key of Object.keys(result.frontMatter ?? {})) {
      if (key !== 'tags') names.add(key);
    }
  }
  return [...names];
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
    tagCategoryCols: initial.tagCategoryCols ?? '',
    propertyCols: initial.propertyCols ?? '',
    searchImageExif: initial.searchImageExif ?? false,
    mostRecent: initial.mostRecent ?? false,
  };
}

/**
 * Whether the Search dialog's form differs from the saved definition it is
 * editing, i.e. whether Save would change anything. Both sides are normalized
 * the way the dialog loads and saves them (missing optional flags count as
 * false, the query, sort expression, sort title, tags, type, tag category
 * columns and properties are saved trimmed), so merely opening a saved search never
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
    || (a.sortTitle ?? '').trim() !== (b.sortTitle ?? '').trim()
    || (a.tags ?? '').trim() !== (b.tags ?? '').trim()
    || (a.type ?? '').trim() !== (b.type ?? '').trim()
    || (a.tagCategoryCols ?? '').trim() !== (b.tagCategoryCols ?? '').trim()
    || (a.propertyCols ?? '').trim() !== (b.propertyCols ?? '').trim()
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
