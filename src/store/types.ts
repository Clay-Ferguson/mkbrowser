/**
 * Represents a file or folder item that has been encountered during browsing.
 * Items are stored in a Map keyed by their full file path.
 */
export interface ItemData {
  /** Full path to the file or folder (serves as the unique key) */
  path: string;

  /** File name (without path) */
  name: string;

  /** Whether this is a directory */
  isDirectory: boolean;

  /** Last modified timestamp from the file system (milliseconds since epoch) */
  modifiedTime: number;

  /** Whether this item is selected (for checkbox selection, defaults to false) */
  isSelected: boolean;

  /** Whether this item has been cut (hidden from view) */
  isCut: boolean;

  /** Whether the file's content is currently expanded (visible) */
  isExpanded: boolean;

  /**
   * Cached content for markdown files.
   * Only populated for .md files when they are displayed.
   * Used to avoid re-reading files that haven't changed.
   */
  content?: string;

  /**
   * The modifiedTime at which the content was cached.
   * Used to determine if the cached content is still valid.
   */
  contentCachedAt?: number;

  /**
   * Whether the file is currently being edited.
   * Multiple files can be edited simultaneously.
   */
  editing?: boolean;

  /**
   * Whether the file/folder is currently being renamed.
   */
  renaming?: boolean;
}

/**
 * Represents which view/panel is currently displayed
 */
export type AppView = 'browser' | 'search-results';

/**
 * Search result from the file search
 */
export interface SearchResultItem {
  path: string;
  relativePath: string;
  matchCount: number;
}

/**
 * Global application state
 */
export interface AppState {
  /**
   * Collection of all items (files/folders) encountered during browsing.
   * Keyed by full file path for fast lookup.
   */
  items: Map<string, ItemData>;

  /**
   * Current view being displayed
   */
  currentView: AppView;

  /**
   * The search query that produced the current search results
   */
  searchQuery: string;

  /**
   * The folder path where the search was performed
   */
  searchFolder: string;

  /**
   * Search results from the most recent search
   */
  searchResults: SearchResultItem[];
}

/**
 * Creates a new ItemData with default values
 */
export function createItemData(
  path: string,
  name: string,
  isDirectory: boolean,
  modifiedTime: number
): ItemData {
  const isMarkdownFile = !isDirectory && name.toLowerCase().endsWith('.md');

  return {
    path,
    name,
    isDirectory,
    modifiedTime,
    isSelected: false,
    isCut: false,
    isExpanded: isMarkdownFile,
  };
}
