import type { FileEntry } from "../global";
import type { SortOrder } from "../store";

// Common image file extensions
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif', '.avif']);

/**
 * Return the lowercased extension (including the leading dot) of a file name,
 * or an empty string if the name has no extension.
 */
function getExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i < 0 ? '' : fileName.slice(i).toLowerCase();
}

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

export function isTextFile(fileName: string): boolean {
  return getExtension(fileName) in TEXT_FILE_LANGUAGES;
}

export function isMarkdownFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.md');
}

export function getTextFileLanguage(fileName: string): TextFileLanguage {
  return TEXT_FILE_LANGUAGES[getExtension(fileName)] ?? 'text';
}

export type FileIconType = 'markdown' | 'text' | 'image' | 'generic';

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

export function formatFlyoverInfo(entry: FileEntry): string {
  const fmt = (ms: number) => ms ? new Date(ms).toLocaleString() : 'Unknown';
  return `File Info\n─────────────\nCreated: ${fmt(entry.createdTime)}\nModified: ${fmt(entry.modifiedTime)}`;
}
