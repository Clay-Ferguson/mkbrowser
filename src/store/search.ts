import type { HighlightedSearchResult, SearchResultItem, SearchSortBy, SearchSortDirection } from '../shared/types';
import { getState } from './core';
import type { StoreSet } from './core';

// ============================================================================
// Search - results, query, and the persistent result highlight
// ============================================================================

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts`.
 */
export interface SearchSlice {
  setHighlightedSearchResult: (result: HighlightedSearchResult | null) => void;
  setSearchResults: (
    results: SearchResultItem[],
    query: string,
    folder: string,
    sortBy?: SearchSortBy,
    sortDirection?: SearchSortDirection,
    searchName?: string
  ) => void;
  clearSearchResults: () => void;
}

/**
 * Slice creator called by `core.ts` inside `create()`. A function declaration
 * (not a `const`) so it is hoisted and safe under the core ↔ slice import
 * cycle regardless of module load order.
 */
export function createSearchSlice(set: StoreSet): SearchSlice {
  return {
    /** Set the highlighted search result (for persistent highlighting). */
    setHighlightedSearchResult: (result) => set({ highlightedSearchResult: result }),

    /** Set search results along with the query and folder they came from. */
    setSearchResults: (results, query, folder, sortBy, sortDirection, searchName) =>
      set({
        searchResults: results,
        searchQuery: query,
        searchFolder: folder,
        ...(searchName !== undefined && { searchName }),
        ...(sortBy !== undefined && { searchSortBy: sortBy }),
        ...(sortDirection !== undefined && { searchSortDirection: sortDirection }),
      }),

    /** Clear search results. */
    clearSearchResults: () =>
      set({
        searchResults: [],
        searchQuery: '',
        searchFolder: '',
        searchName: '',
        searchSortBy: 'modified-time',
        searchSortDirection: 'desc',
      }),
  };
}

// Thin non-hook wrappers so the barrel API (and every caller) is unchanged;
// they delegate to the actions living inside the store.

export function setHighlightedSearchResult(result: HighlightedSearchResult | null): void {
  getState().setHighlightedSearchResult(result);
}

export function setSearchResults(
  results: SearchResultItem[],
  query: string,
  folder: string,
  sortBy?: SearchSortBy,
  sortDirection?: SearchSortDirection,
  searchName?: string
): void {
  getState().setSearchResults(results, query, folder, sortBy, sortDirection, searchName);
}

export function clearSearchResults(): void {
  getState().clearSearchResults();
}
