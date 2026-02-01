import fs from 'node:fs';
import path from 'node:path';
import { fdir } from 'fdir';

export interface ReplaceResult {
  path: string;
  relativePath: string;
  replacementCount: number;
  success: boolean;
  error?: string;
}

/**
 * Escapes special regex characters in a string so it can be used as a literal match.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Performs search and replace across all .md and .txt files in a folder recursively.
 * 
 * @param folderPath - The root folder to search in
 * @param searchText - The literal text to search for
 * @param replaceText - The literal text to replace with
 * @param ignoredPatterns - Array of RegExp patterns for paths to ignore
 * @returns Array of ReplaceResult with details of each file processed
 */
export async function searchAndReplace(
  folderPath: string,
  searchText: string,
  replaceText: string,
  ignoredPatterns: RegExp[]
): Promise<ReplaceResult[]> {
  const results: ReplaceResult[] = [];

  // Early return if search text is empty
  if (!searchText) {
    return results;
  }

  // Create exclude predicate (returns true to exclude)
  const shouldExcludePath = (name: string, fullPath: string): boolean => {
    return ignoredPatterns.some(pattern => pattern.test(name) || pattern.test(fullPath));
  };

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
  const escapedSearch = escapeRegex(searchText);
  const searchRegex = new RegExp(escapedSearch, 'g');

  // Process each file
  for (const filePath of files) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      
      // Count how many replacements will be made
      const matches = content.match(searchRegex);
      const replacementCount = matches ? matches.length : 0;

      if (replacementCount > 0) {
        // Perform the replacement
        const newContent = content.replace(searchRegex, replaceText);
        
        // Write the modified content back to the file
        await fs.promises.writeFile(filePath, newContent, 'utf-8');

        const relativePath = path.relative(folderPath, filePath);
        results.push({
          path: filePath,
          relativePath,
          replacementCount,
          success: true,
        });
      }
    } catch (err) {
      const relativePath = path.relative(folderPath, filePath);
      results.push({
        path: filePath,
        relativePath,
        replacementCount: 0,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
