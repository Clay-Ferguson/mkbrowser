import type { FileEntry } from "src/global";
import type { SortOrder } from "src/store";

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

