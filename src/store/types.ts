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

  /**
   * Line number to scroll to when editing starts (1-based).
   * Set when initiating edit from search results with a line match.
   */
  goToLine?: number;
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
  modifiedTime?: number; // File modification timestamp (milliseconds since epoch)
  createdTime?: number; // File creation timestamp (milliseconds since epoch)
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
 * Available content width options for the main content area
 */
export type ContentWidth = 'narrow' | 'medium' | 'wide' | 'full';

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
 * Sort order for search results
 */
export type SearchSortBy = 'modified-time' | 'created-time';

/**
 * Sort direction for search results (chronological ordering)
 */
export type SearchSortDirection = 'asc' | 'desc';

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
  /** Sort order for search results */
  sortBy: SearchSortBy;
  /** Sort direction: ascending (oldest first) or descending (newest first) */
  sortDirection: SearchSortDirection;
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
  /** Content width for the main content area */
  contentWidth: ContentWidth;
  /** Array of bookmarked file paths */
  bookmarks: string[];
}

/**
 * Scroll position storage for each view
 * Browser view uses a Map to track per-path scroll positions
 */
export interface ScrollPositions {
  /** Browser view scroll positions, keyed by path */
  browser: Map<string, number>;
  /** Search results view scroll position */
  'search-results': number;
  /** Settings view scroll position */
  settings: number;
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
   * Sort order applied to the current search results
   */
  searchSortBy: SearchSortBy;

  /**
   * Sort direction applied to the current search results
   */
  searchSortDirection: SearchSortDirection;

  /**
   * Application settings (persisted to config file)
   */
  settings: AppSettings;

  /**
   * Name of the currently highlighted item in the browser view
   */
  highlightItem: string | null;

  /**
   * Full file path to start editing after navigation completes.
   * Set when clicking edit from search results, cleared after editing starts.
   */
  pendingEditFile: string | null;

  /**
   * Line number to scroll to when editing starts (1-based).
   * Used with pendingEditFile when navigating from search results.
   */
  pendingEditLineNumber: number | null;

  /**
   * Scroll positions for each view.
   * Browser view stores per-path positions, other views store a single position.
   */
  scrollPositions: ScrollPositions;

  /**
   * Path and line number of the highlighted search result.
   * Used to highlight the result when returning to search results view.
   */
  highlightedSearchResult: { path: string; lineNumber?: number } | null;
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
