/**
 * Creates a search function that checks if content contains given text (case-insensitive)
 * and tracks the total number of matches found.
 * 
 * @param content - The text content to search within
 * @returns An object containing the search function and match count getter
 */
export function createContentSearcher(content: string): {
  $: (searchText: string) => boolean;
  getMatchCount: () => number;
} {
  const contentLower = content.toLowerCase();
  let matchCount = 0;
  
  /**
   * The '$' function checks if content contains the given text (case-insensitive)
   * and increments matchCount for each call that returns true
   */
  const $ = (searchText: string): boolean => {
    const searchLower = searchText.toLowerCase();
    const found = contentLower.includes(searchLower);
    if (found) {
      // Count occurrences for matchCount
      let count = 0;
      let idx = 0;
      while ((idx = contentLower.indexOf(searchLower, idx)) !== -1) {
        count++;
        idx += searchLower.length;
      }
      matchCount += count;
      return true;
    }
    return false;
  };
  
  const getMatchCount = (): number => matchCount;
  
  return { $, getMatchCount };
}
