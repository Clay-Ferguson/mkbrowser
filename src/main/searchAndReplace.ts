import fs from 'node:fs';
import path from 'node:path';
import { fdir } from 'fdir';
import { escapeRegexLiteral, buildExcludePredicate } from '../shared/pathPattern';
import { mapWithConcurrency } from '../shared/asyncUtil';
import { writeFileAtomic } from './atomicWrite';

/** Max number of files read/written concurrently during a search-and-replace.
 * Bounded so huge trees don't exhaust file descriptors (EMFILE) while still
 * overlapping I/O. Mirrors SEARCH_FILE_CONCURRENCY in search.ts. */
const REPLACE_FILE_CONCURRENCY = 32;

/** Upper bound (bytes) on a single file read fully into memory for replacement.
 * Markdown/text notes are tiny; a multi-hundred-MB or multi-GB file (a stray
 * log, exported data, an accidentally-renamed binary) that happens to match
 * .md/.txt would otherwise be slurped into one V8 string in the Electron MAIN
 * process — risking a memory spike (amplified by REPLACE_FILE_CONCURRENCY) or
 * blowing past V8's maximum string length. Files larger than this are skipped
 * and reported as a failed ReplaceResult rather than read. Mirrors
 * MAX_SEARCH_FILE_BYTES in search.ts. */
const MAX_REPLACE_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

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

  // Use fdir to crawl for .md and .txt files.
  //
  // excludeSymlinks: this is a DESTRUCTIVE bulk write, so we deliberately do NOT
  // follow symlinks — every matched path is read and rewritten, and a symlink can
  // point outside `folderPath`. Confirmed behavior for fdir 6.5.0:
  //   - DEFAULT (no option): a symlink whose name ends in .md/.txt is emitted as a
  //     file entry. We would then read its target's bytes (possibly outside the
  //     tree) and the atomic write would clobber the link with a regular file.
  //     (Symlinked *directories* are not descended into by default, but symlinked
  //     files still leak in.)
  //   - excludeSymlinks: true — all symlinks (to files and to directories) are
  //     skipped entirely, so the operation only ever touches regular files that
  //     physically live under `folderPath`. This is the safest least-surprise
  //     policy for "replace in this folder" and is the explicit, pinned default
  //     here rather than relying on fdir's behavior for non-symlink entries.
  const api = new fdir({ excludeSymlinks: true })
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
        // Bound the per-file read: stat first and skip anything larger than
        // MAX_REPLACE_FILE_BYTES so a pathological file can't memory-spike or
        // crash the main process. Reported as a failed result (not silently
        // dropped) so the user sees why it was left untouched.
        const { size } = await fs.promises.stat(filePath);
        if (size > MAX_REPLACE_FILE_BYTES) {
          return {
            path: filePath,
            relativePath: path.relative(folderPath, filePath),
            replacementCount: 0,
            success: false,
            error: `File too large to process (${size} bytes exceeds the ${MAX_REPLACE_FILE_BYTES}-byte limit); skipped`,
          };
        }

        // Read raw bytes, not a decoded string. Decoding with 'utf-8'
        // eagerly is lossy for a legacy-encoded (e.g. Latin-1/Windows-1252)
        // .md/.txt file: every non-ASCII byte becomes U+FFFD. If the ASCII
        // search text then matched anywhere, we'd write the mangled string
        // back and permanently replace every accented character with `�` —
        // even in regions far from any match. Guard by requiring the bytes to
        // round-trip through UTF-8 losslessly; anything that doesn't is not a
        // UTF-8 text file we can safely rewrite, so report it as failed and
        // leave it untouched.
        const buf = await fs.promises.readFile(filePath);
        const content = buf.toString('utf8');
        if (!Buffer.from(content, 'utf8').equals(buf)) {
          return {
            path: filePath,
            relativePath: path.relative(folderPath, filePath),
            replacementCount: 0,
            success: false,
            error: 'File is not valid UTF-8 (possibly a legacy encoding); skipped to avoid corrupting its contents',
          };
        }

        // Replace and count in a SINGLE pass: the replacer function runs once
        // per match, so incrementing here yields the match count without a
        // second `content.match(searchRegex)` scan (and its throwaway match
        // array). Using a replacer FUNCTION (not a string) also inserts
        // replaceText verbatim: a string second argument would interpret
        // `$$`, `$&`, `` $` ``, `$'`, and `$1`/`$2`… as special replacement
        // patterns, breaking the documented "literal text" contract for any
        // replacement containing `$`.
        let replacementCount = 0;
        const newContent = content.replace(searchRegex, () => {
          replacementCount++;
          return replaceText;
        });

        // Skip files whose bytes didn't actually change. This covers the
        // zero-match case AND the no-op case where the replacement reproduces
        // the original content (e.g. searchText === replaceText): there the
        // count is > 0 yet nothing changed. Writing anyway would churn the
        // file's mtime for nothing, which is user-visible here because the
        // search feature sorts by most-recent. Such files are reported as
        // zero effective replacements (omitted from results entirely).
        if (replacementCount === 0 || newContent === content) {
          return null;
        }

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
