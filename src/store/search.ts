import type { HighlightedSearchResult, SearchResultItem, SearchSortBy, SearchSortDirection } from '../types/types';
import { setState, useStoreValue } from './core';

// ============================================================================
// Search - results, query, and the persistent result highlight
// ============================================================================

/**
 * Set the highlighted search result (for persistent highlighting)
 */
export function setHighlightedSearchResult(result: HighlightedSearchResult | null): void {
  setState({ highlightedSearchResult: result });
}

/**
 * Set search results along with the query and folder they came from
 */
export function setSearchResults(
  results: SearchResultItem[],
  query: string,
  folder: string,
  sortBy?: SearchSortBy,
  sortDirection?: SearchSortDirection,
  searchName?: string
): void {
  setState({
    searchResults: results,
    searchQuery: query,
    searchFolder: folder,
    ...(searchName !== undefined && { searchName }),
    ...(sortBy !== undefined && { searchSortBy: sortBy }),
    ...(sortDirection !== undefined && { searchSortDirection: sortDirection }),
  });
}

/**
 * Clear search results
 */
export function clearSearchResults(): void {
  setState({
    searchResults: [],
    searchQuery: '',
    searchFolder: '',
    searchName: '',
    searchSortBy: 'modified-time',
    searchSortDirection: 'desc',
  });
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
