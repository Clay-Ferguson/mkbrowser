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
   * Current content being edited (only set while in edit mode).
   */
  editContent?: string;

  /**
   * Whether the file/folder is currently being renamed.
   */
  renaming?: boolean;

  /**
   * Line number to scroll to when editing starts (1-based).
   * Set when initiating edit from search results with a line match.
   */
  goToLine?: number;

  /**
   * Whether the file is currently in diff review mode (showing rewrite diff).
   */
  reviewing?: boolean;

  /**
   * Rewritten content for diff comparison (only set while reviewing).
   */
  rewrittenContent?: string;

  /**
   * Preview text from HUMAN.md or AI.md for AI conversation folders.
   * Only populated when aiEnabled is true in AppConfig.
   */
  aiHint?: string;

  /**
   * Tags parsed from the file's Front Matter YAML.
   * Populated alongside content when the file is first read or saved.
   */
  tags?: string[];

  /**
   * All non-tags Front Matter properties, keyed by property name.
   * Values retain their parsed YAML types (string, number, boolean, array, etc.).
   * Populated alongside content when the file is first read or saved.
   */
  props?: Record<string, unknown>;
}

/**
 * Represents which application page (aka view or panel) is currently displayed
 */
export type AppView = 'browser' | 'search-results' | 'settings' | 'folder-analysis' | 'ai-settings' | 'thread';

/**
 * A single hashtag entry with its occurrence count
 */
export interface HashtagEntry {
  tag: string;
  count: number;
}

/**
 * State for the folder analysis feature
 */
export interface FolderAnalysisState {
  /** Map of hashtag -> count */
  hashtags: HashtagEntry[];
  /** The folder path that was analyzed */
  folderPath: string;
  /** Total number of files scanned */
  totalFiles: number;
}

/**
 * Search result from the file search
 */
export interface SearchResultItem {
  path: string;
  relativePath: string;
  matchCount: number;
  lineNumber?: number; // 1-based line number (0 or undefined for entire file matches)
  lineText?: string; // The matching line text (only for line-by-line search)
  extraLine?: string; // First non-empty line below match that isn't itself a match
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
 * Folder tree sidebar visibility and width options
 */
export type IndexTreeWidth = 'hidden' | 'narrow' | 'medium' | 'wide';

/**
 * Search mode: content or filenames
 */
export type SearchMode = 'content' | 'filenames';

/**
 * Search type: literal, wildcard, or advanced
 */
export type SearchType = 'literal' | 'wildcard' | 'advanced';

/**
 * Sort order for search results
 */
export type SearchSortBy = 'modified-time' | 'created-time' | 'line-time';

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
  /** Sort order for search results */
  sortBy: SearchSortBy;
  /** Sort direction: ascending (oldest first) or descending (newest first) */
  sortDirection: SearchSortDirection;
  /** Whether to include image EXIF metadata in content search */
  searchImageExif?: boolean;
  /** Whether to limit search to the 500 most recently modified files */
  mostRecent?: boolean;
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
  /** Whether to show the table of contents panel */
  showToc: boolean;
  /** Newline-separated list of folder/file names to ignore in search */
  ignoredPaths: string;
  /** Saved search definitions */
  searchDefinitions: SearchDefinition[];
  /** Content width for the main content area */
  contentWidth: ContentWidth;
  /** Array of bookmarked file paths */
  bookmarks: string[];
  /** Folder path where OCR tool utilities are stored */
  ocrToolsFolder: string;
  /** Folder tree sidebar visibility and width */
  indexTreeWidth: IndexTreeWidth;
  /** Whether to show front matter (Properties) in the editor */
  showPropsInEditor: boolean;
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
  /** Folder analysis view scroll position */
  'folder-analysis': number;
  /** AI settings view scroll position */
  'ai-settings': number;
  /** Thread view scroll position */
  thread: number;
}

/**
 * Base node in the IndexTree hierarchy. Holds expansion/loading state and children.
 * Concrete node types (e.g. FileNode) extend this with their own identity fields.
 */
export interface TreeNode {
  isExpanded: boolean;
  isLoading: boolean;
  /** null = never loaded; populated array = loaded (may be empty) */
  children: TreeNode[] | null;
}

/**
 * A file or directory node in the IndexTree file/folder hierarchy.
 */
export interface FileNode extends TreeNode {
  path: string;
  name: string;
  isDirectory: boolean;
  children: TreeNode[] | null;
}

/**
 * A markdown file node. Structurally identical to FileNode; when expanded,
 * its children are MarkdownHeadingNode[] rather than FileNode[].
 */
export interface MarkdownFileNode extends FileNode {
  isDirectory: false;
}

/**
 * A heading node inside an expanded markdown file. Uses a synthetic path key
 * (filePath + '#' + flatIndex) so the store's path-based updater can locate it.
 */
export interface MarkdownHeadingNode extends TreeNode {
  path: string;
  heading: string;
  slug: string;
  depth: number;
  children: MarkdownHeadingNode[] | null;
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
   * Full file path to scroll into view after navigation completes.
   * Set when navigating from search results, cleared after scrolling.
   */
  pendingScrollToFile: string | null;

  /**
   * Heading slug to scroll to after the file entry finishes rendering.
   * Set alongside pendingScrollToFile when navigating from a heading node
   * in the IndexTree; cleared after the heading scroll completes.
   */
  pendingScrollToHeadingSlug: string | null;

  /**
   * The search query that produced the current search results
   */
  searchQuery: string;

  /**
   * The folder path where the search was performed
   */
  searchFolder: string;

  /**
   * Name of the saved search definition that produced the current results, if any
   */
  searchName: string;

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
   * Full path of the currently highlighted item in the browser view
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
   * Which view should consume the pending edit.
   * Set alongside pendingEditFile so only the correct view acts on it.
   */
  pendingEditView: AppView | null;

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

  /**
   * Folder analysis results (null until an analysis is run)
   */
  folderAnalysis: FolderAnalysisState | null;

  /**
   * Root node of the IndexTree sidebar.
   * Null until the tree has been initialized for a root path.
   */
  indexTreeRoot: FileNode | null;

  /**
   * When set, IndexTree should expand to reveal this path and scroll it into view.
   * Cleared immediately when the IndexTree picks it up.
   */
  pendingIndexTreeReveal: string | null;

  /**
   * When true, ThreadView should scroll to the bottom after a short delay.
   * Set by actions like "Reply" that append new content to the thread.
   */
  pendingThreadScrollToBottom: boolean;

  /**
   * The root folder path for the current browsing session.
   * Set at startup from config or when user picks a new folder.
   */
  rootPath: string;

  /**
   * Set of tab IDs that should be visible in the tab bar.
   * Not persisted — resets to defaults on restart.
   */
  visibleTabs: Set<AppView>;

  /**
   * True when the current directory contains a .INDEX.yaml file.
   * Controls sort behavior and related UI across the app.
   */
  hasIndexFile: boolean;

  /**
   * Parsed contents of .INDEX.yaml for the current directory.
   * Null when no index file exists or has not yet been loaded.
   */
  indexYaml: { files?: { name: string; id?: string }[]; options?: { edit_mode?: boolean } } | null;

  /**
   * When true, BrowseView hides all entries except the one being edited,
   * giving the CodeMirror editor the full scrollable area.
   * Not persisted — defaults to false on restart.
   */
  expandedEditor: boolean;

}

/**
 * A single entry in an AI conversation thread.
 * Designed for extensibility — future versions may include
 * image attachments or other artifacts alongside the markdown content.
 */
export interface ThreadEntry {
  /** Role of this conversation turn */
  role: 'human' | 'ai';
  /** Absolute path to the H or A folder containing this turn */
  folderPath: string;
  /** Absolute path to the HUMAN.md or AI.md file */
  filePath: string;
  /** File name (HUMAN.md or AI.md) */
  fileName: string;
  /** Last modified timestamp in milliseconds since epoch */
  modifiedTime: number;
  /** Created timestamp in milliseconds since epoch */
  createdTime: number;
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
  createdTime: number = modifiedTime,
  aiHint?: string
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
    aiHint,
  };
}
