import type { HashtagDefinition, TagCategory } from '../utils/tagUtil';

export type { HashtagDefinition, TagCategory };

export type FontSize = 'small' | 'medium' | 'large' | 'xlarge';
export type ImageSize = 'small' | 'large';
export type SortOrder = 'alphabetical' | 'created-chron' | 'created-reverse' | 'modified-chron' | 'modified-reverse';
export type ContentWidth = 'narrow' | 'medium' | 'wide' | 'full';
export type SearchMode = 'content' | 'filenames';
export type SearchType = 'literal' | 'wildcard' | 'advanced';
export type SearchSortBy = 'modified-time' | 'created-time' | 'file-name';
export type SearchSortDirection = 'asc' | 'desc';

/**
 * A single OCR job to run in the external terminal. `path` is passed to ocr.sh
 * as its argument; the optional `label` is echoed as a progress header before it.
 * Both are treated as data and shell-quoted in the main process, never interpolated.
 */
export interface OcrTarget {
  path: string;
  label?: string;
}

/** A single EXIF group's tags, keyed by tag name. */
export type ExifSection = Record<string, string>;
/** EXIF metadata grouped by section (e.g. 'exif', 'gps'), keyed by group name. */
export type ExifData = Record<string, ExifSection>;

export interface SearchDefinition {
  name: string;
  searchText: string;
  searchTarget: SearchMode;
  searchMode: SearchType;
  sortBy: SearchSortBy;
  sortDirection: SearchSortDirection;
  mostRecent?: boolean;
}

export interface Bookmark {
  path: string;
  name: string;
}

export interface AppSettings {
  fontSize: FontSize;
  sortOrder: SortOrder;
  foldersOnTop: boolean;
  showToc: boolean;
  ignoredPaths: string;
  searchDefinitions: SearchDefinition[];
  contentWidth: ContentWidth;
  bookmarks: Bookmark[];
  ocrToolsFolder: string;
  calendarItemsFolder: string;
  showPropsInEditor?: boolean;
}

/** Supported AI providers. Single source of truth for both the {@link AIProvider}
 *  union type and any UI that lists providers (e.g. the model editor dropdown). */
export const AI_PROVIDERS = ['ANTHROPIC', 'OPENAI', 'GOOGLE', 'LLAMACPP'] as const;
export type AIProvider = typeof AI_PROVIDERS[number];

export interface AIModelConfig {
  name: string;
  provider: AIProvider;
  model: string;
  /** USD per 1M input tokens */
  inputPer1M: number;
  /** USD per 1M output tokens */
  outputPer1M: number;
  /** Whether the model supports image/vision input. */
  vision: boolean;
  /** Built-in model that cannot be edited or deleted in the UI. */
  readonly: boolean;
}

export interface AIRewritePromptDef {
  name: string;
  prompt: string;
}

export interface AppConfig {
  browseFolder: string;
  curSubFolder?: string;
  settings?: AppSettings;
  lastExportFolder?: string;
  aiEnabled?: boolean;
  aiModels?: AIModelConfig[];
  aiModel?: string;
  llamacppBaseUrl?: string;
  llamacppFolder?: string;
  agenticMode?: boolean;
  agenticAllowedFolders?: string;
  /** The name of the currently selected rewrite prompt. */
  aiRewritePrompt?: string;
  /** Named rewrite prompts available to the user. */
  aiRewritePrompts?: AIRewritePromptDef[];
  /** Whether to include the full document as context when rewriting. */
  fullDocContext?: boolean;
  /** Whether the Tags picker panel is expanded. Defaults to false (collapsed). */
  tagsPanelVisible?: boolean;
  /** Whether the AI Rewrite button is shown in entry editors. */
  aiRewriteMode?: boolean;
  /** Last selected calendar view type (month/week/day/agenda). */
  calendarViewType?: 'month' | 'week' | 'work_week' | 'day' | 'agenda';
  /** Recently browsed folders, most recent first, max 10. */
  recentFolders?: string[];
  /** Image display size: 'small' (default, max-h-96) or 'large' (max-h-[48rem]). */
  imageSize?: ImageSize;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isMarkdown: boolean;
  /** Last modified timestamp in milliseconds since epoch */
  modifiedTime: number;
  /** Created timestamp in milliseconds since epoch */
  createdTime: number;
  content?: string;
  /** Preview text from HUMAN.md or AI.md for AI conversation folders */
  aiHint?: string;
  /** Position from .INDEX.yaml; undefined means not listed (appears after indexed entries) */
  indexOrder?: number;
  /** Contents of an associated .attach folder, pre-loaded by readDirectory */
  attachments?: FileEntry[];
  /** True when a sibling .attach folder exists for this file */
  hasAttachFolder?: boolean;
}

export interface SearchResult {
  path: string;
  relativePath: string;
  matchCount: number;
  lineNumber?: number;
  lineText?: string;
  extraLine?: string;
  modifiedTime?: number;
  createdTime?: number;
}

export interface ReplaceResult {
  path: string;
  relativePath: string;
  replacementCount: number;
  success: boolean;
  error?: string;
}

export interface ExportResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export interface FolderAnalysisResult {
  hashtags: Array<{ tag: string; count: number }>;
  totalFiles: number;
}

export interface CalendarEventResult {
  id: string;
  title: string;
  /** Milliseconds since epoch */
  start: number;
  /** Milliseconds since epoch */
  end: number;
  filePath: string;
  /** First 5 lines (up to 400 chars) of body content after front matter */
  snippet: string;
}

export interface FolderGraphScanResult {
  folderPath: string;
  nodes: Array<{ id: string; name: string; isDirectory: boolean; depth: number }>;
  links: Array<{ source: string; target: string }>;
  truncated: boolean;
  /** True if the full scan exceeded the node cap and we fell back to folders-only. */
  foldersOnly: boolean;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export interface AIUsageWithCosts {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  byProvider: Record<string, ProviderUsage>;
  estimatedCosts: Record<string, number>;
  totalEstimatedCost: number;
}

// todo-0: this interface/wrapper is new and there are no unit tests yet to directly exercise this interface
//         which is possible now that this interface has decoupled the GUI from the API backend
export interface ElectronAPI {
  /** Platform path separator: '\\' on Windows, '/' elsewhere. */
  pathSep: string;
  quit: () => Promise<void>;
  loadDictionary: () => Promise<{ affData: string; dicData: string }>;
  getConfig: () => Promise<AppConfig>;
  updateConfig: (updates: Partial<AppConfig>) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  readDirectory: (dirPath: string) => Promise<FileEntry[]>;
  readFile: (filePath: string) => Promise<string>;
  readExif: (filePath: string) => Promise<ExifData>;
  writeExif: (filePath: string, data: ExifData) => Promise<boolean>;
  pathExists: (checkPath: string) => Promise<boolean>;
  writeFile: (filePath: string, content: string) => Promise<{ ok: boolean; content: string }>;
  getFileSize: (filePath: string) => Promise<number>;
  getFileMtime: (filePath: string) => Promise<number>;
  writeFileBinary: (filePath: string, base64Data: string) => Promise<boolean>;
  createFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>;
  deleteFile: (filePath: string) => Promise<boolean>;
  openExternal: (filePath: string) => Promise<boolean>;
  openExternalUrl: (url: string) => Promise<boolean>;
  createFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  searchFolder: (folderPath: string, query: string, searchType?: 'literal' | 'wildcard' | 'advanced', searchMode?: 'content' | 'filenames', searchImageExif?: boolean, mostRecent?: boolean) => Promise<SearchResult[]>;
  searchAndReplace: (folderPath: string, searchText: string, replaceText: string) => Promise<ReplaceResult[]>;
  analyzeFolderHashtags: (folderPath: string) => Promise<FolderAnalysisResult>;
  loadCalendarEvents: (folderPath: string) => Promise<CalendarEventResult[]>;
  scanFolderTree: (folderPath: string) => Promise<FolderGraphScanResult>;
  loadTags: () => Promise<TagCategory[]>;
  saveTags: (yamlContent: string) => Promise<void>;
  setWindowTitle: (title: string) => Promise<void>;
  selectExportFolder: () => Promise<string | null>;
  exportFolderContents: (sourceFolder: string, outputFolder: string, outputFileName: string, includeSubfolders: boolean, includeFilenames: boolean, includeDividers: boolean) => Promise<ExportResult>;
  exportToPdf: (markdownPath: string, pdfPath: string, sourceFolder?: string) => Promise<{ success: boolean; error?: string }>;
  runShellScript: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  askAi: (prompt: string, parentFolderPath: string) => Promise<{ outputPath: string; responseFolder: string; usage?: { input_tokens: number; output_tokens: number; total_tokens: number } } | { error: string }>;
  replyToAi: (parentFolderPath: string, createSubFolder: boolean) => Promise<{ folderPath: string; filePath: string } | { error: string }>;
  getAiUsage: () => Promise<AIUsageWithCosts>;
  resetAiUsage: () => Promise<void>;
  queueScriptedAnswer: (answer: string) => Promise<void>;
  gatherThreadEntries: (folderPath: string) => Promise<{ isThread: boolean; entries: Array<{ role: 'human' | 'ai'; folderPath: string; filePath: string; fileName: string; modifiedTime: number; createdTime: number }>; childFolders: Array<{ role: 'human' | 'ai'; name: string; path: string; aiHint?: string }> }>;
  rewriteContent: (content: string, filePath: string, hasIndexFile: boolean) => Promise<{ rewrittenContent: string; usage?: { input_tokens: number; output_tokens: number; total_tokens: number } } | { error: string }>;
  rewriteContentSelection: (content: string, selectionFrom: number, selectionTo: number, filePath: string, hasIndexFile: boolean) => Promise<{ rewrittenContent: string; usage?: { input_tokens: number; output_tokens: number; total_tokens: number } } | { error: string }>;

  // llama.cpp server lifecycle
  checkLlamaHealth: () => Promise<string>;
  startLlamaServer: () => Promise<{ success: boolean; error?: string }>;
  stopLlamaServer: () => Promise<{ success: boolean; error?: string }>;

  // AI streaming events
  onAiStreamStart: (callback: () => void) => () => void;
  onAiStreamChunk: (callback: (text: string) => void) => () => void;
  onAiStreamThinking: (callback: (text: string) => void) => () => void;
  onAiStreamTool: (callback: (toolName: string, summary: string) => void) => () => void;
  onAiStreamDone: (callback: () => void) => () => void;
  onAiStreamError: (callback: (message: string) => void) => () => void;
  cancelAiStream: () => void;

  // Calendar file-change and delete events
  onCalendarFileChanged: (callback: (results: CalendarEventResult[], filePath: string) => void) => () => void;
  onCalendarFileDeleted: (callback: (deletedPath: string, isFolder: boolean) => void) => () => void;

  runOcrInTerminal: (ocrToolsFolder: string, targets: OcrTarget[]) => Promise<{ success: boolean; error?: string }>;
  insertIntoIndexYaml: (dirPath: string, newName: string, insertAfterName: string | null) => Promise<{ success: boolean; error?: string }>;
  moveInIndexYaml: (dirPath: string, name: string, direction: 'up' | 'down') => Promise<{ success: boolean; error?: string }>;
  moveToEdgeInIndexYaml: (dirPath: string, name: string, edge: 'top' | 'bottom') => Promise<{ success: boolean; error?: string }>;
  reconcileIndexedFiles: (dirPath: string, createIfMissing?: boolean) => Promise<void>;
  readIndexYaml: (dirPath: string) => Promise<{ files?: { name: string; id?: string }[]; options?: Record<string, unknown> } | null>;
  writeIndexOptions: (dirPath: string, options: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
}
