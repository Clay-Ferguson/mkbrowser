import type { HighlightedSearchResult, SearchResultItem, SearchSortBy, SearchSortDirection } from '../shared/types';
import { getState, useStoreValue } from './core';
import type { StoreSet } from './core';

// ============================================================================
// Search - results, query, and the persistent result highlight
// ============================================================================

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts` (Zustand slices pattern — see ZUSTAND_CONVERSION.md §2b).
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

/**
 * Hook to subscribe to search results
 */
export function useSearchResults(): SearchResultItem[] {
  return useStoreValue(s => s.searchResults);
}

/**
 * Hook to subscribe to search query
 */
export function useSearchQuery(): string {
  return useStoreValue(s => s.searchQuery);
}

/**
 * Hook to subscribe to search folder
 */
export function useSearchFolder(): string {
  return useStoreValue(s => s.searchFolder);
}

/**
 * Hook to subscribe to the saved-search name (empty if results are not from a named search)
 */
export function useSearchName(): string {
  return useStoreValue(s => s.searchName);
}

/**
 * Hook to subscribe to search sort by
 */
export function useSearchSortBy(): SearchSortBy {
  return useStoreValue(s => s.searchSortBy);
}

/**
 * Hook to subscribe to search sort direction
 */
export function useSearchSortDirection(): SearchSortDirection {
  return useStoreValue(s => s.searchSortDirection);
}

/**
 * Hook to subscribe to highlighted search result
 */
export function useHighlightedSearchResult(): HighlightedSearchResult | null {
  return useStoreValue(s => s.highlightedSearchResult);
}
