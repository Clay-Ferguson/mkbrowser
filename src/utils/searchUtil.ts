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

/**
 * Finds the first non-empty line below a matched line that isn't itself a match.
 * Used in file-lines search mode to provide extra context for each result.
 *
 * Scans up to maxBlankLines consecutive blank lines before giving up.
 * If the first non-empty line found is itself a match, returns undefined
 * (it will appear as its own search result).
 *
 * @param lines - All lines of the file
 * @param fromIndex - 0-based index of the matched line
 * @param matchPredicate - The same predicate used for the search
 * @param maxBlankLines - Max consecutive blank lines to scan through (default 5)
 * @returns The extra context line, or undefined if none qualifies
 */
export function findExtraLine(
  lines: string[],
  fromIndex: number,
  matchPredicate: (content: string) => { matches: boolean },
  maxBlankLines = 5,
): string | undefined {
  let blanks = 0;
  for (let i = fromIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      blanks++;
      if (blanks > maxBlankLines) return undefined;
      continue;
    }
    // Skip lines without enough alphanumeric content (e.g. '---', '***')
    const alphanumCount = (lines[i].match(/[a-zA-Z0-9]/g) || []).length;
    if (alphanumCount < 10) continue;
    // Found a substantive line — check if it's itself a match
    if (matchPredicate(lines[i]).matches) return undefined;
    return lines[i];
  }
  return undefined;
}
