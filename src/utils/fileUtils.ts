import type { FileEntry } from "src/global";
import type { SortOrder } from "src/store";
import path from 'node:path';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { AI_FOLDER_REGEX, HUMAN_FOLDER_REGEX } from '../ai/aiPatterns';

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

  // Find the closing delimiter (--- or ...) on its own line
  const afterOpen = rawContent.slice(3);
  const closingMatch = afterOpen.match(/\n(---|\.\.\.)\s*(\n|$)/);
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
          console.warn(`Cannot auto-trim "${entry.name}": "${trimmedName}" already exists`);
        } catch {
          // Target doesn't exist, safe to rename
          await fsOps.rename(oldPath, newPath);
          entry.name = trimmedName;
        }
      }
    }
  }
}

// Common image file extensions
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif', '.avif']);export function isImageFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  return IMAGE_EXTENSIONS.has(ext);
}
export function isTextFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.txt');
}
/**
 * Apply sort comparison based on the selected sort order.
 */
export function compareByOrder(a: FileEntry, b: FileEntry, sortOrder: SortOrder): number {
  switch (sortOrder) {
    case 'alphabetical':
      return a.name.localeCompare(b.name);
    case 'created-chron':
      // Older files first (ascending)
      return a.createdTime - b.createdTime;
    case 'created-reverse':
      // Newer files first (descending)
      return b.createdTime - a.createdTime;
    case 'modified-chron':
      // Older modifications first (ascending)
      return a.modifiedTime - b.modifiedTime;
    case 'modified-reverse':
      // More recently modified first (descending)
      return b.modifiedTime - a.modifiedTime;
    default:
      return a.name.localeCompare(b.name);
  }
}
/**
 * Sort entries based on the selected sort order and foldersOnTop preference.
 * When foldersOnTop is true, directories are sorted first, then files.
 * When false, all items are sorted together.
 */
export function sortEntries(entries: FileEntry[], sortOrder: SortOrder, foldersOnTop: boolean): FileEntry[] {
  if (foldersOnTop) {
    // Separate folders and files
    const folders = entries.filter(e => e.isDirectory);
    const files = entries.filter(e => !e.isDirectory);

    // Sort each list independently
    folders.sort((a, b) => compareByOrder(a, b, sortOrder));
    files.sort((a, b) => compareByOrder(a, b, sortOrder));

    // Merge: folders first, then files
    return [...folders, ...files];
  } else {
    // Sort all items together
    return [...entries].sort((a, b) => compareByOrder(a, b, sortOrder));
  }
}

/**
 * Read directory contents and return FileEntry[] for the renderer.
 * Pure file-system logic — no Electron APIs.
 */
export async function readDirectory(dirPath: string, aiEnabled: boolean): Promise<FileEntry[]> {
  // First check if directory exists
  try {
    const dirStat = await fs.promises.stat(dirPath);
    if (!dirStat.isDirectory()) {
      throw new Error(`Path is not a directory: ${dirPath}`);
    }
  } catch {
    throw new Error(`Directory does not exist: ${dirPath}`);
  }

  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const fileEntries: FileEntry[] = [];

  // Auto-fix any filenames with leading whitespace by renaming them on disk
  await trimLeadingWhitespaceFromNames(dirPath, entries, path.join, fs.promises);

  for (const entry of entries) {
    // Skip hidden files/folders (starting with .)
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);
    const isDirectory = entry.isDirectory();
    const isMarkdown = !isDirectory && entry.name.toLowerCase().endsWith('.md');

    // Get file stats for modification and creation time
    let modifiedTime = 0;
    let createdTime = 0;
    try {
      const stat = await fs.promises.stat(fullPath);
      modifiedTime = stat.mtimeMs;
      createdTime = stat.birthtimeMs;
    } catch {
      modifiedTime = Date.now();
      createdTime = Date.now();
    }

    const fileEntry: FileEntry = {
      name: entry.name,
      path: fullPath,
      isDirectory,
      isMarkdown,
      modifiedTime,
      createdTime,
    };

    // Load AI conversation hint for H*/A* folders when aiEnabled
    if (isDirectory && aiEnabled) {
      const folderName = entry.name;
      let hintFile: string | undefined;
      if (HUMAN_FOLDER_REGEX.test(folderName)) {
        hintFile = 'HUMAN.md';
      } else if (AI_FOLDER_REGEX.test(folderName)) {
        hintFile = 'AI.md';
      }
      if (hintFile) {
        try {
          const hintContent = await fs.promises.readFile(path.join(fullPath, hintFile), 'utf8');
          fileEntry.aiHint = hintContent.slice(0, 120).trim();
        } catch {
          // File doesn't exist or can't be read — no hint
        }
      }
    }

    fileEntries.push(fileEntry);
  }

  // Sort: directories first, then files, alphabetically within each group
  fileEntries.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  // Check for .INDEX.yaml to override display ordering
  const indexFilePath = path.join(dirPath, '.INDEX.yaml');
  try {
    const indexContent = await fs.promises.readFile(indexFilePath, 'utf8');
    const parsed = yaml.load(indexContent) as { files?: Array<{ name: string; id?: string }> };
    if (parsed && Array.isArray(parsed.files)) {
      const nameToOrder = new Map(parsed.files.map((f, i) => [f.name, i]));
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
  } catch {
    // No .INDEX.yaml or parse error — use default ordering
  }

  return fileEntries;
}

