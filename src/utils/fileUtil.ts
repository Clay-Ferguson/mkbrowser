import path from 'node:path';
import fs from 'node:fs';
import { load } from 'js-yaml';
import type { FileEntry } from "../global";
import { logger } from './logUtil';
import { readAiHint } from '../ai/aiHint';
import { readIndexYaml, compareByIndexOrder } from './indexUtil';
import { ATTACH_SUFFIX } from './specialFiles';
import { compareNames } from './fileTypes';

export interface FrontMatterResult {
  /** Parsed YAML front matter as a plain object, or null if none was found. */
  yaml: Record<string, unknown> | null;
  /** The body of the file with the front matter block removed. */
  content: string;
}

/**
 * Parses YAML front matter from the beginning of a file's content.
 *
 * Front matter is a block delimited by `---` on its own line at the very start
 * of the content and a closing `---` (or `...`) on its own line. Everything
 * after the closing delimiter is returned as `content`.
 *
 * Returns `yaml: null` when no valid front matter block is detected.
 */
/** Length of the opening front-matter delimiter (`---`). */
const OPEN_DELIM_LEN = 3;

export function parseFrontMatter(rawContent: string): FrontMatterResult {
  // Front matter must start at the very beginning of the file
  if (!rawContent.startsWith('---')) {
    return { yaml: null, content: rawContent };
  }

  // Find the closing delimiter (--- or ...) on its own line.
  // Allow only spaces/tabs (not newlines) after the delimiter so a blank line
  // following the front matter is preserved as part of the body rather than
  // being silently swallowed — Markdown is whitespace-sensitive.
  const afterOpen = rawContent.slice(OPEN_DELIM_LEN);
  const closingMatch = afterOpen.match(/\n(---|\.\.\.)[^\S\n]*(\n|$)/);
  if (!closingMatch || closingMatch.index === undefined) {
    return { yaml: null, content: rawContent };
  }

  const yamlSource = afterOpen.slice(0, closingMatch.index);
  const bodyStart = closingMatch.index + closingMatch[0].length + OPEN_DELIM_LEN;
  const body = rawContent.slice(bodyStart);

  try {
    const parsed = load(yamlSource);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { yaml: parsed as Record<string, unknown>, content: body };
    }
  } catch (err) {
    // Malformed YAML — treat as no front matter
    logger.debug(`parseFrontMatter: ignoring malformed YAML front matter: ${err}`);
  }

  return { yaml: null, content: rawContent };
}

interface FsOperations {
  stat: (path: string) => Promise<unknown>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
}

interface DirentLike {
  name: string;
}

/**
 * Auto-fix filenames with leading whitespace by renaming them on disk.
 * Mutates the entry.name in place so callers see the corrected name.
 * Skips entries where the trimmed name already exists to avoid collisions.
 */
export async function trimLeadingWhitespaceFromNames(
  dirPath: string,
  entries: DirentLike[],
  joinPath: (...segments: string[]) => string,
  fsOps: FsOperations,
): Promise<void> {
  for (const entry of entries) {
    if (/^\s/.test(entry.name)) {
      const trimmedName = entry.name.replace(/^\s+/, '');
      if (trimmedName.length > 0) {
        const oldPath = joinPath(dirPath, entry.name);
        const newPath = joinPath(dirPath, trimmedName);
        try {
          // Only rename if the trimmed name doesn't already exist
          await fsOps.stat(newPath);
          logger.warn(`Cannot auto-trim "${entry.name}": "${trimmedName}" already exists`);
        } catch {
          // Target doesn't exist, safe to rename
          try {
            await fsOps.rename(oldPath, newPath);
            entry.name = trimmedName;
          } catch (renameErr) {
            logger.warn(`Failed to auto-trim "${entry.name}": ${renameErr}`);
          }
        }
      }
    }
  }
}

/**
 * Read directory contents and return FileEntry[] for the renderer.
 * Pure file-system logic — no Electron APIs.
 */
export async function readDirectory(dirPath: string, aiEnabled: boolean): Promise<FileEntry[]> {
  // First check if directory exists and is accessible
  let dirStat: fs.Stats;
  try {
    dirStat = await fs.promises.stat(dirPath);
  } catch (err) {
    throw new Error(`Cannot access directory: ${dirPath}`, { cause: err });
  }
  if (!dirStat.isDirectory()) {
    throw new Error(`Path is not a directory: ${dirPath}`);
  }

  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const fileEntries: FileEntry[] = [];

  // Auto-fix any filenames with leading whitespace by renaming them on disk
  await trimLeadingWhitespaceFromNames(dirPath, entries, path.join, fs.promises);

  // Build each entry independently and resolve in parallel; the per-entry I/O
  // (stat, recursive reads, AI hints) is independent, so serial awaits here
  // would add up to N filesystem round-trips on large or slow directories.
  const built = await Promise.all(entries.map(async (entry): Promise<FileEntry | null> => {
    // Skip hidden files/folders (starting with .)
    if (entry.name.startsWith('.')) return null;

    const fullPath = path.join(dirPath, entry.name);

    // stat() follows symlinks, so it resolves the real type for symlinks.
    // Dirent.isDirectory() does NOT follow symlinks on Linux.
    let modifiedTime = 0;
    let createdTime = 0;
    let isDirectory = entry.isDirectory();
    try {
      const stat = await fs.promises.stat(fullPath);
      modifiedTime = stat.mtimeMs;
      createdTime = stat.birthtimeMs;
      if (entry.isSymbolicLink()) {
        isDirectory = stat.isDirectory();
      }
    } catch (err) {
      // Broken symlink — skip it.
      if (entry.isSymbolicLink()) {
        logger.debug(`readDirectory: skipping broken symlink "${fullPath}": ${err}`);
        return null;
      }
      logger.debug(`readDirectory: stat failed for "${fullPath}", using current time: ${err}`);
      modifiedTime = Date.now();
      createdTime = Date.now();
    }

    const isMarkdown = !isDirectory && entry.name.toLowerCase().endsWith('.md');

    const fileEntry: FileEntry = {
      name: entry.name,
      path: fullPath,
      isDirectory,
      isMarkdown,
      modifiedTime,
      createdTime,
    };

    // Pre-load contents of .attach folders so the renderer needs no extra I/O
    if (isDirectory && entry.name.endsWith(ATTACH_SUFFIX)) {
      try {
        fileEntry.attachments = await readDirectory(fullPath, aiEnabled);
      } catch (err) {
        // Unreadable attach folder — leave attachments undefined
        logger.debug(`readDirectory: cannot read attach folder "${fullPath}": ${err}`);
      }
    }

    // Load AI conversation hint for H*/A* folders when aiEnabled
    if (isDirectory && aiEnabled) {
      fileEntry.aiHint = await readAiHint(fullPath, entry.name);
    }

    return fileEntry;
  }));

  for (const fileEntry of built) {
    if (fileEntry) fileEntries.push(fileEntry);
  }

  // Sort once, choosing the comparator based on whether an .INDEX is present.
  // An index defines an explicit order (with name as the tiebreaker); otherwise
  // we fall back to directories-first, then natural name order within each group.
  const indexYaml = await readIndexYaml(dirPath);
  const indexFiles = indexYaml?.files;
  if (indexFiles) {
    // Order by the canonical .INDEX.yaml rule shared with document export
    // (getSortedDirEntries), so on-screen order can never diverge from exported
    // order for an indexed folder. (issue 015)
    const nameToOrder = new Map(indexFiles.map((f, i) => [f.name, i]));
    for (const entry of fileEntries) {
      const order = nameToOrder.get(entry.name);
      if (order !== undefined) entry.indexOrder = order;
    }
    const compare = compareByIndexOrder(indexFiles);
    fileEntries.sort((a, b) => compare(a.name, b.name));
  } else {
    fileEntries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return compareNames(a.name, b.name);
    });
  }

  // Mark files that have a sibling .attach folder so the GUI can skip the paperclip button
  const attachNames = new Set(fileEntries.filter(e => e.isDirectory && e.name.endsWith(ATTACH_SUFFIX)).map(e => e.name));
  for (const entry of fileEntries) {
    if (!entry.isDirectory && attachNames.has(`${entry.name}${ATTACH_SUFFIX}`)) {
      entry.hasAttachFolder = true;
    }
  }

  return fileEntries;
}

