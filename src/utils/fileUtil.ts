import path from 'node:path';
import fs from 'node:fs';
import type { FileEntry } from "../global";
import { logger } from './logUtil';
import yaml from 'js-yaml';
import { readAiHint } from '../ai/aiHint';
import { readIndexYaml } from './indexUtil';
import { ATTACH_SUFFIX } from './specialFiles';

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
export function parseFrontMatter(rawContent: string): FrontMatterResult {
  // Front matter must start at the very beginning of the file
  if (!rawContent.startsWith('---')) {
    return { yaml: null, content: rawContent };
  }

  // Find the closing delimiter (--- or ...) on its own line.
  // Allow only spaces/tabs (not newlines) after the delimiter so a blank line
  // following the front matter is preserved as part of the body rather than
  // being silently swallowed — Markdown is whitespace-sensitive.
  const afterOpen = rawContent.slice(3);
  const closingMatch = afterOpen.match(/\n(---|\.\.\.)[^\S\n]*(\n|$)/);
  if (!closingMatch || closingMatch.index === undefined) {
    return { yaml: null, content: rawContent };
  }

  const yamlSource = afterOpen.slice(0, closingMatch.index);
  const bodyStart = closingMatch.index + closingMatch[0].length + 3; // +3 for the opening '---'
  const body = rawContent.slice(bodyStart);

  try {
    const parsed = yaml.load(yamlSource);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { yaml: parsed as Record<string, unknown>, content: body };
    }
  } catch {
    // Malformed YAML — treat as no front matter
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
    } catch {
      // Broken symlink — skip it silently.
      if (entry.isSymbolicLink()) return null;
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
      } catch {
        // Unreadable attach folder — leave attachments undefined
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

  // Sort: directories first, then files, alphabetically within each group
  fileEntries.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  const indexYaml = await readIndexYaml(dirPath);
  const indexFiles = indexYaml?.files;
  if (indexFiles) {
    const nameToOrder = new Map(indexFiles.map((f, i) => [f.name, i]));
    for (const entry of fileEntries) {
      const order = nameToOrder.get(entry.name);
      if (order !== undefined) entry.indexOrder = order;
    }
    fileEntries.sort((a, b) => {
      const aOrder = a.indexOrder ?? Infinity;
      const bOrder = b.indexOrder ?? Infinity;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.name.localeCompare(b.name);
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

