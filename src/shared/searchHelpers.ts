/**
 * Process-neutral (pure) search helpers, safe to import from either the main
 * process or the renderer. The renderer-only helpers that touch the store / IPC
 * live in `searchUtil.ts`.
 */

import type { SearchDefinition, SearchSortBy, SearchSortDirection } from './shared';
import { HASHTAG_REGEX } from './regexPatterns';

/** The fields of a search result that the result ordering reads. */
interface SortableSearchResult {
  relativePath: string;
  modifiedTime?: number;
  createdTime?: number;
}

/** Last path segment, for either separator. */
function baseName(relativePath: string): string {
  return relativePath.split(/[\\/]/).pop() || relativePath;
}

/**
 * Comparator implementing the user's chosen result order (the Search dialog's
 * "Sort Results By" and "Direction"). The single source of truth for it: the
 * main process sorts with it before applying the result cap, so the results
 * that are kept are the ones the chosen order puts first, and the results view
 * sorts with it for display.
 *
 * File-name order compares base names, ignoring case. Time order treats a
 * missing timestamp as 0 (oldest). Ties fall back to the relative path, so the
 * order — and therefore which results survive the cap — is deterministic.
 */
export function compareSearchResults(
  sortBy: SearchSortBy,
  direction: SearchSortDirection,
): (a: SortableSearchResult, b: SortableSearchResult) => number {
  const sign = direction === 'asc' ? 1 : -1;
  return (a, b) => {
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

/** A new, unnamed search with the Search dialog's default options. */
export function newSearchDefinition(searchText = ''): SearchDefinition {
  return {
    name: '',
    searchText,
    target: 'content',
    matchType: 'literal',
    sortBy: 'modified-time',
    sortDirection: 'desc',
    searchImageExif: false,
    mostRecent: false,
    calendarItemsOnly: false,
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
    searchImageExif: initial.searchImageExif ?? false,
    mostRecent: initial.mostRecent ?? false,
    calendarItemsOnly: initial.calendarItemsOnly ?? false,
  };
}

/**
 * Parse a newline-delimited ignored-paths string into a trimmed, non-empty array.
 */
export function parseIgnoredPaths(raw: string): string[] {
  return raw
    .split('\n')
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Creates the content-matching helpers for an advanced query against one file,
 * and tracks the total number of matches found:
 *  - `$(text)` — the content contains `text` (case-insensitive substring).
 *  - `tag(hashtag)` — the content contains exactly that hashtag as a whole tag:
 *    `tag('#foo')` (or `tag('foo')`) matches `#foo` but not `#foobar`. Tags are
 *    found with HASHTAG_REGEX, the same rule Folder Analysis counts with, and
 *    compared case-sensitively as Analysis does — so a tag's search hits line up
 *    with its count there.
 *
 * @param content - The text content to search within
 * @returns The helpers and a match count getter
 */
export function createContentSearcher(content: string): {
  $: (searchText: string) => boolean;
  tag: (hashtag: string) => boolean;
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

  // Occurrences of each hashtag in the content, built on the first tag() call
  // (one scan, however many tags the query tests).
  let tagCounts: Map<string, number> | null = null;
  const tag = (hashtag: string): boolean => {
    const wanted = hashtag.startsWith('#') ? hashtag : `#${hashtag}`;
    if (!tagCounts) {
      tagCounts = new Map();
      // A private copy: HASHTAG_REGEX is a shared /g regex with mutable lastIndex.
      for (const m of content.matchAll(new RegExp(HASHTAG_REGEX.source, 'g'))) {
        tagCounts.set(m[0], (tagCounts.get(m[0]) ?? 0) + 1);
      }
    }
    const count = tagCounts.get(wanted) ?? 0;
    matchCount += count;
    return count > 0;
  };

  const getMatchCount = (): number => matchCount;

  return { $, tag, getMatchCount };
}

/**
 * Summarize the outcome of a search-and-replace operation as a human-readable
 * string. Reports total replacement count, number of files modified, and (if
 * any) how many files could not be processed.
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
