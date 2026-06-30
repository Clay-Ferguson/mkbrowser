/**
 * Process-neutral (pure) search helpers, safe to import from either the main
 * process or the renderer. The renderer-only helpers that touch the store / IPC
 * live in `searchUtil.ts`.
 */

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

  const $ = (searchText: string): boolean => {
    const searchLower = searchText.toLowerCase();
    const found = contentLower.includes(searchLower);
    if (found) {
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
