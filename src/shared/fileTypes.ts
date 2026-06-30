import type { FileEntry } from "../global";
import type { SortOrder } from "../store";

// Common image file extensions
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif', '.avif']);

// Shared collator for name comparisons. `numeric: true` gives natural ordering
// (file2 before file10), and a single reused instance is significantly faster
// than repeated String.localeCompare calls on large directory listings.
const nameCollator = new Intl.Collator(undefined, { numeric: true });

/** Compare two file names using natural (numeric-aware) ordering. */
export function compareNames(a: string, b: string): number {
  return nameCollator.compare(a, b);
}

/**
 * Return the lowercased extension (including the leading dot) of a file name,
 * or an empty string if the name has no extension.
 */
function getExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i < 0 ? '' : fileName.slice(i).toLowerCase();
}

/** Returns true if the file's extension is a recognized image format. */
export function isImageFile(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(fileName));
}
export type TextFileLanguage = 'javascript' | 'typescript' | 'python' | 'text';

const TEXT_FILE_LANGUAGES: Record<string, TextFileLanguage> = {
  '.txt': 'text',
  '.js': 'javascript',
  '.ts': 'typescript',
  '.py': 'python',
};

/** Returns true if the file's extension maps to a known text language (js/ts/py/txt). */
export function isTextFile(fileName: string): boolean {
  return getExtension(fileName) in TEXT_FILE_LANGUAGES;
}

/** Returns true if the file has a `.md` extension. */
export function isMarkdownFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.md');
}

/** Returns the syntax-highlight language for a text file, defaulting to `'text'`. */
export function getTextFileLanguage(fileName: string): TextFileLanguage {
  return TEXT_FILE_LANGUAGES[getExtension(fileName)] ?? 'text';
}

export type FileIconType = 'markdown' | 'text' | 'image' | 'generic';

/** Returns the icon category for a file based on its extension. */
export function getIconForFileExtension(fileName: string): FileIconType {
  const ext = getExtension(fileName);
  if (ext === '.md') return 'markdown';
  if (ext in TEXT_FILE_LANGUAGES) return 'text';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return 'generic';
}

/**
 * Apply sort comparison based on the selected sort order.
 */
export function compareByOrder(a: FileEntry, b: FileEntry, sortOrder: SortOrder): number {
  switch (sortOrder) {
    case 'alphabetical':
      return compareNames(a.name, b.name);
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
    default: {
      // Exhaustiveness check: adding a new SortOrder without handling it here
      // becomes a compile error rather than silently falling through.
      const _exhaustive: never = sortOrder;
      return compareNames(a.name, b.name);
    }
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

/** Formats a file's created/modified timestamps as a multi-line tooltip string. */
export function formatFlyoverInfo(entry: FileEntry): string {
  const fmt = (ms: number) => ms ? new Date(ms).toLocaleString() : 'Unknown';
  return `File Info\n─────────────\nCreated: ${fmt(entry.createdTime)}\nModified: ${fmt(entry.modifiedTime)}`;
}
