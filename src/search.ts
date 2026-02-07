/**
 * Core search logic extracted from the IPC handler for testability.
 * 
 * This module implements folder-level search across .md and .txt files,
 * supporting literal, wildcard, and advanced (JavaScript expression) search types.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fdir } from 'fdir';
import { extractTimestamp, past, future, today } from './utils/timeUtil';
import { createContentSearcher } from './utils/searchUtil';

/**
 * Search result from the file search
 */
export interface SearchResult {
  path: string;
  relativePath: string;
  matchCount: number;
  lineNumber?: number;
  lineText?: string;
  foundTime?: number;
  modifiedTime?: number;
  createdTime?: number;
}

export type SearchType = 'literal' | 'wildcard' | 'advanced';
export type SearchMode = 'content' | 'filenames';
export type SearchBlock = 'entire-file' | 'file-lines';

/** Match predicate result */
interface MatchResult {
  matches: boolean;
  matchCount: number;
  foundTime?: number;
}

/** Helper to escape regex special characters (except *) */
function escapeRegexExceptWildcard(str: string): string {
  return str.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** Convert wildcard pattern to regex (each * matches up to 25 chars) */
function wildcardToRegex(pattern: string): RegExp {
  const escaped = escapeRegexExceptWildcard(pattern);
  const regexPattern = escaped.replace(/\*/g, '.{0,25}');
  return new RegExp(regexPattern, 'i');
}

/**
 * Create a predicate function that tests content against the query.
 * Exported for unit testing individual match predicates.
 */
export function createMatchPredicate(
  queryStr: string,
  type: SearchType
): (content: string) => MatchResult {
  if (type === 'advanced') {
    return (content: string) => {
      const ts = extractTimestamp(content);
      const { $, getMatchCount } = createContentSearcher(content);
      try {
        const expressionCode = `return (${queryStr});`;
        const evalFunction = new Function('$', 'ts', 'past', 'future', 'today', expressionCode);
        const rawResult = evalFunction($, ts, past, future, today);
        const matches = Boolean(rawResult);
        const matchCount = getMatchCount();
        return {
          matches,
          matchCount: matches ? Math.max(matchCount, 1) : 0,
          foundTime: ts > 0 ? ts : undefined,
        };
      } catch {
        return { matches: false, matchCount: 0 };
      }
    };
  } else if (type === 'wildcard') {
    const regex = wildcardToRegex(queryStr);
    return (content: string) => {
      const matches = regex.test(content);
      if (matches) {
        const allMatches = content.match(new RegExp(regex.source, 'gi'));
        return { matches: true, matchCount: allMatches ? allMatches.length : 1, foundTime: undefined };
      }
      return { matches: false, matchCount: 0, foundTime: undefined };
    };
  } else {
    // Literal mode: case-insensitive text search
    const queryLower = queryStr.toLowerCase();
    return (content: string) => {
      const contentLower = content.toLowerCase();
      let matchCount = 0;
      let searchIndex = 0;
      while ((searchIndex = contentLower.indexOf(queryLower, searchIndex)) !== -1) {
        matchCount++;
        searchIndex += queryLower.length;
      }
      return { matches: matchCount > 0, matchCount, foundTime: undefined };
    };
  }
}

/**
 * Build the exclude predicate from an array of ignored path patterns.
 * Patterns support wildcards via `*`.
 */
function buildExcludePredicate(ignoredPaths: string[]): (name: string, fullPath: string) => boolean {
  const ignoredPatterns = ignoredPaths.map(pattern => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\/]/g, '\\$&');
    const regexPattern = escaped.replace(/\*/g, '.*');
    return new RegExp(`^${regexPattern}$`, 'i');
  });

  return (name: string, fullPath: string): boolean => {
    return ignoredPatterns.some(p => p.test(name) || p.test(fullPath));
  };
}

/**
 * Search a folder for files matching the given query.
 *
 * @param folderPath   - Root folder to search
 * @param query        - Search text or JavaScript expression
 * @param searchType   - 'literal' | 'wildcard' | 'advanced'
 * @param searchMode   - 'content' (search file bodies) or 'filenames'
 * @param searchBlock  - 'entire-file' or 'file-lines'
 * @param ignoredPaths - Array of path patterns to exclude (supports wildcards)
 * @returns Array of SearchResult sorted by matchCount descending
 */
export async function searchFolder(
  folderPath: string,
  query: string,
  searchType: SearchType = 'literal',
  searchMode: SearchMode = 'content',
  searchBlock: SearchBlock = 'entire-file',
  ignoredPaths: string[] = [],
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const shouldExcludePath = buildExcludePredicate(ignoredPaths);
  const matchPredicate = createMatchPredicate(query, searchType);

  if (searchMode === 'filenames') {
    // Search file and folder names
    const filesApi = new fdir()
      .withFullPaths()
      .exclude((dirName, dirPath) => shouldExcludePath(dirName, dirPath))
      .filter((filePath) => !shouldExcludePath(path.basename(filePath), filePath))
      .crawl(folderPath);

    const dirsApi = new fdir()
      .withFullPaths()
      .exclude((dirName, dirPath) => shouldExcludePath(dirName, dirPath))
      .onlyDirs()
      .crawl(folderPath);

    const [files, dirs] = await Promise.all([
      filesApi.withPromise(),
      dirsApi.withPromise(),
    ]);

    const allEntries = [...files, ...dirs.filter(d => d !== folderPath)];

    for (const entryPath of allEntries) {
      const entryName = path.basename(entryPath);
      const { matches, matchCount, foundTime } = matchPredicate(entryName);

      if (matches) {
        const relativePath = path.relative(folderPath, entryPath);
        let modifiedTime: number | undefined;
        let createdTime: number | undefined;
        try {
          const stat = await fs.promises.stat(entryPath);
          modifiedTime = stat.mtimeMs;
          createdTime = stat.birthtimeMs;
        } catch { /* ignore stat errors */ }
        results.push({
          path: entryPath,
          relativePath,
          matchCount,
          ...(foundTime !== undefined && { foundTime }),
          ...(modifiedTime !== undefined && { modifiedTime }),
          ...(createdTime !== undefined && { createdTime }),
        });
      }
    }
  } else {
    // Search file contents - only .md and .txt files
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

    for (const filePath of files) {
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');

        if (searchBlock === 'file-lines') {
          const lines = content.split(/\r?\n/);
          const relativePath = path.relative(folderPath, filePath);
          let modifiedTime: number | undefined;
          let createdTime: number | undefined;
          try {
            const stat = await fs.promises.stat(filePath);
            modifiedTime = stat.mtimeMs;
            createdTime = stat.birthtimeMs;
          } catch { /* ignore stat errors */ }

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const { matches, matchCount, foundTime } = matchPredicate(line);

            if (matches) {
              results.push({
                path: filePath,
                relativePath,
                matchCount,
                lineNumber: i + 1,
                lineText: line,
                ...(foundTime !== undefined && { foundTime }),
                ...(modifiedTime !== undefined && { modifiedTime }),
                ...(createdTime !== undefined && { createdTime }),
              });
            }
          }
        } else {
          const { matches, matchCount, foundTime } = matchPredicate(content);

          if (matches) {
            const relativePath = path.relative(folderPath, filePath);
            let modifiedTime: number | undefined;
            let createdTime: number | undefined;
            try {
              const fileStat = await fs.promises.stat(filePath);
              modifiedTime = fileStat.mtimeMs;
              createdTime = fileStat.birthtimeMs;
            } catch { /* ignore stat errors */ }
            results.push({
              path: filePath,
              relativePath,
              matchCount,
              ...(foundTime !== undefined && { foundTime }),
              ...(modifiedTime !== undefined && { modifiedTime }),
              ...(createdTime !== undefined && { createdTime }),
            });
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }
  }

  // Sort by match count (descending)
  results.sort((a, b) => b.matchCount - a.matchCount);
  return results;
}
