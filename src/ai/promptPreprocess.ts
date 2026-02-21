/**
 * Prompt preprocessing utilities — #file: directive parsing and expansion.
 *
 * This module is intentionally free of Electron and LangChain imports so that
 * it can be unit-tested in a plain Node environment.
 */
import { fdir } from 'fdir';
import fs from 'node:fs/promises';
import path from 'node:path';

const debug = false;

/** Matches a #file: directive on its own line. Captures the pattern after the colon. */
export const FILE_DIRECTIVE_REGEX = /^\s*#file:(.+?)\s*$/;

/**
 * Convert a simple wildcard pattern (where `*` matches any sequence of characters)
 * into a RegExp. All other regex-special characters are escaped.
 *
 * Examples:
 *   `*`       → /^.*$/
 *   `*.md`    → /^.*\.md$/
 *   `data.*`  → /^data\..*$/
 *   `notes.txt` → /^notes\.txt$/
 */
export function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\*/g, '.*');
  return new RegExp(`^${withWildcards}$`);
}

/**
 * Parse `#file:<pattern>` directives from prompt text, resolve them against
 * the given folder (non-recursive), read matching files, and return the
 * cleaned prompt with an `<attached_files>` block appended.
 *
 * - Directives must be on their own line.
 * - `HUMAN.md` is always excluded from matches.
 * - Duplicate files (by absolute path) are deduplicated.
 * - Patterns that match zero files are silently ignored.
 *
 * @param rawText    The raw HUMAN.md content (may contain #file: directives).
 * @param folderPath Absolute path of the folder containing the HUMAN.md.
 * @returns          The processed prompt text with directives stripped and
 *                   attached file contents appended.
 */
export async function preprocessPrompt(
  rawText: string,
  folderPath: string
): Promise<string> {
  const lines = rawText.split('\n');
  const promptLines: string[] = [];
  const patterns: string[] = [];

  // Separate directive lines from prompt lines
  for (const line of lines) {
    const match = FILE_DIRECTIVE_REGEX.exec(line);
    if (match) {
      patterns.push(match[1]);
    } else {
      promptLines.push(line);
    }
  }

  // No directives found — return the original text unchanged
  if (patterns.length === 0) {
    return rawText;
  }

  // List all files in the folder (non-recursive, depth 0)
  let allFiles: string[] = [];
  try {
    allFiles = await new fdir()
      .withFullPaths()
      .withMaxDepth(0)
      .crawl(folderPath)
      .withPromise();
  } catch {
    // Folder unreadable — return prompt with directives stripped
    return promptLines.join('\n');
  }

  // Build set of matched files, deduplicating by absolute path
  const matchedFiles = new Set<string>();

  for (const pattern of patterns) {
    const regex = wildcardToRegex(pattern);
    for (const filePath of allFiles) {
      const fileName = path.basename(filePath);
      if (fileName === 'HUMAN.md') continue; // Always exclude
      if (regex.test(fileName)) {
        matchedFiles.add(filePath);
      }
    }
  }

  // No files matched — return prompt with directives stripped
  if (matchedFiles.size === 0) {
    return promptLines.join('\n');
  }

  // Read matched files and build the <attached_files> block
  const fileBlocks: string[] = [];
  for (const filePath of matchedFiles) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const relativeName = path.basename(filePath);
      fileBlocks.push(`<file path="${relativeName}">\n${content}\n</file>`);
    } catch {
      // Skip unreadable files silently
    }
  }

  if (fileBlocks.length === 0) {
    return promptLines.join('\n');
  }

  const attachedBlock = `<attached_files>\n${fileBlocks.join('\n')}\n</attached_files>`;
  const finalPrompt = `${promptLines.join('\n')}\n\n${attachedBlock}`;
  if (debug) {
    console.log('[preprocessPrompt] Final prompt with attached files:\n', finalPrompt);
  }
  return finalPrompt;
}
