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

  /** Created timestamp from the file system (milliseconds since epoch) */
  createdTime: number;

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
 * Represents which application page (aka view or panel) is currently displayed
 */
export type AppView = 'browser' | 'search-results' | 'settings';

/**
 * Search result from the file search
 */
export interface SearchResultItem {
  path: string;
  relativePath: string;
  matchCount: number;
  lineNumber?: number; // 1-based line number (0 or undefined for entire file matches)
  lineText?: string; // The matching line text (only for line-by-line search)
  foundTime?: number; // Timestamp found by ts() function in advanced search (milliseconds since epoch)
}

/**
 * Available font size options for the application
 */
export type FontSize = 'small' | 'medium' | 'large' | 'xlarge';

/**
 * Available sort order options for file/folder listing
 */
export type SortOrder = 'alphabetical' | 'created-chron' | 'created-reverse' | 'modified-chron' | 'modified-reverse';

/**
 * Search mode: content or filenames
 */
export type SearchMode = 'content' | 'filenames';

/**
 * Search type: literal, wildcard, or advanced
 */
export type SearchType = 'literal' | 'wildcard' | 'advanced';

/**
 * Search block: entire-file or file-lines
 */
export type SearchBlock = 'entire-file' | 'file-lines';

/**
 * Saved search definition
 */
export interface SearchDefinition {
  /** Name of the search definition */
  name: string;
  /** The search query text */
  searchText: string;
  /** Search target: content or filenames */
  searchTarget: SearchMode;
  /** Search type: literal, wildcard, or advanced */
  searchMode: SearchType;
  /** Search block: entire-file or file-lines */
  searchBlock: SearchBlock;
}

/**
 * Application settings that are persisted to config file
 */
export interface AppSettings {
  /** Font size for the application UI */
  fontSize: FontSize;
  /** Sort order for file/folder listing */
  sortOrder: SortOrder;
  /** Whether to display folders above files */
  foldersOnTop: boolean;
  /** Newline-separated list of folder/file names to ignore in search */
  ignoredPaths: string;
  /** Saved search definitions */
  searchDefinitions: SearchDefinition[];
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
   * Current path being browsed
   */
  currentPath: string;

  /**
   * Current view being displayed
   */
  currentView: AppView;

  /**
   * File name to scroll into view after navigation completes.
   * Set when navigating from search results, cleared after scrolling.
   */
  pendingScrollToFile: string | null;

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

  /**
   * Application settings (persisted to config file)
   */
  settings: AppSettings;

  /**
   * Name of the currently highlighted item in the browser view
   */
  highlightItem: string | null;
}

/**
 * Common image file extensions
 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif', '.avif']);

function isImageFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Creates a new ItemData with default values
 */
export function createItemData(
  path: string,
  name: string,
  isDirectory: boolean,
  modifiedTime: number,
  createdTime: number = modifiedTime
): ItemData {
  const isMarkdownFile = !isDirectory && name.toLowerCase().endsWith('.md');
  const isImage = !isDirectory && isImageFile(name);

  return {
    path,
    name,
    isDirectory,
    modifiedTime,
    createdTime,
    isSelected: false,
    isCut: false,
    isExpanded: isMarkdownFile || isImage,
  };
}
