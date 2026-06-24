import fs from 'node:fs';
import path from 'node:path';
import { fdir } from 'fdir';
import { escapeRegexLiteral, buildExcludePredicate } from './utils/pathPattern';
import { mapWithConcurrency } from './utils/asyncUtil';
import { writeFileAtomic } from './utils/atomicWrite';

/** Max number of files read/written concurrently during a search-and-replace.
 * Bounded so huge trees don't exhaust file descriptors (EMFILE) while still
 * overlapping I/O. Mirrors SEARCH_FILE_CONCURRENCY in search.ts. */
const REPLACE_FILE_CONCURRENCY = 32;

export interface ReplaceResult {
  path: string;
  relativePath: string;
  replacementCount: number;
  success: boolean;
  error?: string;
}

/**
 * Performs search and replace across all .md and .txt files in a folder recursively.
 * 
 * @param folderPath - The root folder to search in
 * @param searchText - The literal text to search for
 * @param replaceText - The literal text to replace with
 * @param ignoredPaths - Array of path patterns to exclude (supports wildcards)
 * @returns Array of ReplaceResult with details of each file processed
 */
export async function searchAndReplace(
  folderPath: string,
  searchText: string,
  replaceText: string,
  ignoredPaths: string[] = []
): Promise<ReplaceResult[]> {
  const results: ReplaceResult[] = [];

  // Early return if search text is empty
  if (!searchText) {
    return results;
  }

  // Exclude hidden files plus user ignore patterns — shared with searchFolder.
  const shouldExcludePath = buildExcludePredicate(ignoredPaths);

  // Use fdir to crawl for .md and .txt files
  const api = new fdir()
    .withFullPaths()
    .exclude((dirName, dirPath) => shouldExcludePath(dirName, dirPath))
    .filter((filePath) => {
      const fileName = path.basename(filePath);
      if (shouldExcludePath(fileName, filePath)) return false;

      const ext = path.extname(filePath).toLowerCase();
      return ext === '.md' || ext === '.txt';
    })
    .crawl(folderPath);

  const files = await api.withPromise();

  // Create a regex that matches the literal search text globally
  const escapedSearch = escapeRegexLiteral(searchText);
  const searchRegex = new RegExp(escapedSearch, 'g');

  // Process files with bounded concurrency so independent disk I/O overlaps
  // without exhausting file descriptors (see REPLACE_FILE_CONCURRENCY). The
  // try/catch stays INSIDE the callback and never rethrows: mapWithConcurrency
  // fails fast on a thrown error, but here every file must be reported
  // independently, so a single unreadable/unwritable file yields a
  // `success: false` result instead of aborting the whole batch.
  // Files with zero replacements return null and are filtered out below,
  // matching the prior "only push when replacementCount > 0" behavior.
  const fileResults = await mapWithConcurrency(
    files,
    REPLACE_FILE_CONCURRENCY,
    async (filePath): Promise<ReplaceResult | null> => {
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');

        // Count how many replacements will be made
        const matches = content.match(searchRegex);
        const replacementCount = matches ? matches.length : 0;

        if (replacementCount === 0) {
          return null;
        }

        // Perform the replacement and write the modified content back.
        // Use a replacer FUNCTION (not a string) so replaceText is inserted
        // verbatim: a string second argument would interpret `$$`, `$&`,
        // `` $` ``, `$'`, and `$1`/`$2`… as special replacement patterns,
        // breaking the documented "literal text" contract for any
        // replacement containing `$`.
        const newContent = content.replace(searchRegex, () => replaceText);
        // Write atomically (temp file + rename) so a crash, power loss, or
        // disk-full mid-write can never leave the user's document truncated or
        // half-written — readers see either the full old file or the full new
        // file. This is a bulk rewrite of the user's own docs, where data
        // integrity matters most.
        await writeFileAtomic(filePath, newContent);

        return {
          path: filePath,
          relativePath: path.relative(folderPath, filePath),
          replacementCount,
          success: true,
        };
      } catch (err) {
        return {
          path: filePath,
          relativePath: path.relative(folderPath, filePath),
          replacementCount: 0,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  for (const r of fileResults) {
    if (r) results.push(r);
  }

  return results;
}
