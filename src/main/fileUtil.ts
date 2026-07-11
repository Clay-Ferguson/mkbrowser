import path from 'node:path';
import fs from 'node:fs';
import type { FileEntry } from "../global";
import { logger } from '../shared/logUtil';
import { readAiHint } from './ai/aiHint';
import { readIndexYaml, compareByIndexOrder } from './indexUtil';
import { ATTACH_SUFFIX } from '../shared/specialFiles';
import { compareNames } from '../shared/fileTypes';

interface FsOperations {
  stat: (path: string) => Promise<unknown>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
}

interface DirentLike {
  name: string;
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

