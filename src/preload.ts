import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for the exposed API
export type FontSize = 'small' | 'medium' | 'large' | 'xlarge';
export type SortOrder = 'alphabetical' | 'created-chron' | 'created-reverse' | 'modified-chron' | 'modified-reverse';
export type ContentWidth = 'narrow' | 'medium' | 'wide' | 'full';
export type SearchMode = 'content' | 'filenames';
export type SearchType = 'literal' | 'wildcard' | 'advanced';
export type SearchBlock = 'entire-file' | 'file-lines';

export interface SearchDefinition {
  name: string;
  searchText: string;
  searchTarget: SearchMode;
  searchMode: SearchType;
  searchBlock: SearchBlock;
  mostRecent?: boolean;
}

export interface AppSettings {
  fontSize: FontSize;
  sortOrder: SortOrder;
  foldersOnTop: boolean;
  ignoredPaths: string;
  searchDefinitions: SearchDefinition[];
  contentWidth?: ContentWidth;
  bookmarks: string[];
}

export interface AIModelConfig {
  name: string;
  provider: 'ANTHROPIC' | 'OPENAI' | 'GOOGLE' | 'LLAMACPP';
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

export interface AppConfig {
  browseFolder: string;
  settings?: AppSettings;
  aiModels?: AIModelConfig[];
  aiModel?: string;
  llamacppBaseUrl?: string;
  llamacppFolder?: string;
  agenticMode?: boolean;
  agenticAllowedFolders?: string;
  /** Whether the Tags picker panel is expanded. Defaults to false (collapsed). */
  tagsPanelVisible?: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isMarkdown: boolean;
  content?: string;
  aiHint?: string;
}

export interface SearchResult {
  path: string;
  relativePath: string;
  matchCount: number;
  lineNumber?: number;
  lineText?: string;
  extraLine?: string;
  foundTime?: number; // Timestamp found by ts() function in advanced search (milliseconds since epoch)
}

export interface RenameOperation {
  oldPath: string;
  newPath: string;
  oldName: string;
  newName: string;
}

export interface RenumberResult {
  success: boolean;
  error?: string;
  operations?: RenameOperation[];
}

export interface FolderAnalysisResult {
  hashtags: Array<{ tag: string; count: number }>;
  totalFiles: number;
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

export interface ElectronAPI {
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  quit: () => Promise<void>;
  readDirectory: (dirPath: string) => Promise<FileEntry[]>;
  readFile: (filePath: string) => Promise<string>;
  pathExists: (checkPath: string) => Promise<boolean>;
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  getFileSize: (filePath: string) => Promise<number>;
  getFileMtime: (filePath: string) => Promise<number>;
  writeFileBinary: (filePath: string, base64Data: string) => Promise<boolean>;
  createFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>;
  deleteFile: (filePath: string) => Promise<boolean>;
  openExternal: (filePath: string) => Promise<boolean>;
  createFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  searchFolder: (folderPath: string, query: string, searchType?: 'literal' | 'wildcard' | 'advanced', searchMode?: 'content' | 'filenames', searchBlock?: 'entire-file' | 'file-lines', searchImageExif?: boolean, mostRecent?: boolean) => Promise<SearchResult[]>;
  analyzeFolderHashtags: (folderPath: string) => Promise<FolderAnalysisResult>;
  collectAncestorTags: (filePath: string) => Promise<string[]>;
  renumberFiles: (dirPath: string) => Promise<RenumberResult>;
  askAi: (prompt: string, parentFolderPath: string) => Promise<{ outputPath: string; responseFolder: string; usage?: { input_tokens: number; output_tokens: number; total_tokens: number } } | { error: string }>;
  replyToAi: (parentFolderPath: string, createSubFolder: boolean) => Promise<{ folderPath: string; filePath: string } | { error: string }>;
  getAiUsage: () => Promise<AIUsageWithCosts>;
  resetAiUsage: () => Promise<void>;
  gatherThreadEntries: (folderPath: string) => Promise<{ isThread: boolean; entries: Array<{ role: 'human' | 'ai'; folderPath: string; filePath: string; fileName: string; modifiedTime: number; createdTime: number }> }>;
  rewriteContent: (content: string) => Promise<{ rewrittenContent: string; usage?: { input_tokens: number; output_tokens: number; total_tokens: number } } | { error: string }>;
  rewriteContentSelection: (content: string, selectionFrom: number, selectionTo: number) => Promise<{ rewrittenContent: string; usage?: { input_tokens: number; output_tokens: number; total_tokens: number } } | { error: string }>;

  runInExternalTerminal: (command: string) => Promise<{ success: boolean; error?: string }>;
}

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  quit: () => ipcRenderer.invoke('quit'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config: AppConfig) => ipcRenderer.invoke('save-config', config),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  searchAndReplace: (folderPath: string, searchText: string, replaceText: string) =>
    ipcRenderer.invoke('search-and-replace', folderPath, searchText, replaceText),
  loadDictionary: () => ipcRenderer.invoke('load-dictionary'),
  readDirectory: (dirPath: string) => ipcRenderer.invoke('read-directory', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  readExif: (filePath: string) => ipcRenderer.invoke('read-exif', filePath),
  writeExif: (filePath: string, data: Record<string, Record<string, string>>) => ipcRenderer.invoke('write-exif', filePath, data),
  pathExists: (checkPath: string) => ipcRenderer.invoke('path-exists', checkPath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  getFileSize: (filePath: string) => ipcRenderer.invoke('get-file-size', filePath),
  getFileMtime: (filePath: string) => ipcRenderer.invoke('get-file-mtime', filePath),
  writeFileBinary: (filePath: string, base64Data: string) => ipcRenderer.invoke('write-file-binary', filePath, base64Data),
  createFile: (filePath: string, content: string) => ipcRenderer.invoke('create-file', filePath, content),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  openExternal: (filePath: string) => ipcRenderer.invoke('open-external', filePath),
  openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),
  createFolder: (folderPath: string) => ipcRenderer.invoke('create-folder', folderPath),
  searchFolder: (folderPath: string, query: string, searchType?: 'literal' | 'wildcard' | 'advanced', searchMode?: 'content' | 'filenames', searchBlock?: 'entire-file' | 'file-lines', searchImageExif?: boolean, mostRecent?: boolean) => ipcRenderer.invoke('search-folder', folderPath, query, searchType, searchMode, searchBlock, searchImageExif, mostRecent),
  analyzeFolderHashtags: (folderPath: string) => ipcRenderer.invoke('analyze-folder-hashtags', folderPath),
  collectAncestorTags: (filePath: string) => ipcRenderer.invoke('collect-ancestor-tags', filePath),
  renumberFiles: (dirPath: string) => ipcRenderer.invoke('renumber-files', dirPath),
  setWindowTitle: (title: string) => ipcRenderer.invoke('set-window-title', title),
  selectExportFolder: () => ipcRenderer.invoke('select-export-folder'),
  exportFolderContents: (sourceFolder: string, outputFolder: string, outputFileName: string, includeSubfolders: boolean, includeFilenames: boolean, includeDividers: boolean) => 
    ipcRenderer.invoke('export-folder-contents', sourceFolder, outputFolder, outputFileName, includeSubfolders, includeFilenames, includeDividers),
  exportToPdf: (markdownPath: string, pdfPath: string, sourceFolder?: string) =>
    ipcRenderer.invoke('export-to-pdf', markdownPath, pdfPath, sourceFolder),
  askAi: (prompt: string, parentFolderPath: string) =>
    ipcRenderer.invoke('ask-ai', prompt, parentFolderPath),
  replyToAi: (parentFolderPath: string, createSubFolder: boolean) =>
    ipcRenderer.invoke('reply-to-ai', parentFolderPath, createSubFolder),
  getAiUsage: () => ipcRenderer.invoke('get-ai-usage'),
  resetAiUsage: () => ipcRenderer.invoke('reset-ai-usage'),
  queueScriptedAnswer: (answer: string) => ipcRenderer.invoke('queue-scripted-answer', answer),
  gatherThreadEntries: (folderPath: string) => ipcRenderer.invoke('gather-thread-entries', folderPath),
  rewriteContent: (content: string) => ipcRenderer.invoke('rewrite-content', content),
  rewriteContentSelection: (content: string, selectionFrom: number, selectionTo: number) => ipcRenderer.invoke('rewrite-content-selection', content, selectionFrom, selectionTo),

  // llama.cpp server lifecycle
  checkLlamaHealth: () => ipcRenderer.invoke('check-llama-health'),
  startLlamaServer: () => ipcRenderer.invoke('start-llama-server'),
  stopLlamaServer: () => ipcRenderer.invoke('stop-llama-server'),

  // AI streaming events
  onAiStreamChunk: (callback: (text: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, text: string) => callback(text);
    ipcRenderer.on('ai-stream-chunk', listener);
    return () => { ipcRenderer.removeListener('ai-stream-chunk', listener); };
  },
  onAiStreamThinking: (callback: (text: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, text: string) => callback(text);
    ipcRenderer.on('ai-stream-thinking', listener);
    return () => { ipcRenderer.removeListener('ai-stream-thinking', listener); };
  },
  onAiStreamTool: (callback: (toolName: string, summary: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, toolName: string, summary: string) => callback(toolName, summary);
    ipcRenderer.on('ai-stream-tool', listener);
    return () => { ipcRenderer.removeListener('ai-stream-tool', listener); };
  },
  onAiStreamDone: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('ai-stream-done', listener);
    return () => { ipcRenderer.removeListener('ai-stream-done', listener); };
  },
  onAiStreamError: (callback: (message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on('ai-stream-error', listener);
    return () => { ipcRenderer.removeListener('ai-stream-error', listener); };
  },
  cancelAiStream: () => ipcRenderer.send('ai-stream-cancel'),

  runInExternalTerminal: (command: string) => ipcRenderer.invoke('run-in-external-terminal', command),
  insertIntoIndexYaml: (dirPath: string, newName: string, insertAfterName: string | null) =>
    ipcRenderer.invoke('insert-into-index-yaml', dirPath, newName, insertAfterName),
  moveInIndexYaml: (dirPath: string, name: string, direction: 'up' | 'down') =>
    ipcRenderer.invoke('move-in-index-yaml', dirPath, name, direction),
  reconcileIndexedFiles: (dirPath: string, createIfMissing?: boolean) =>
    ipcRenderer.invoke('reconcile-indexed-files', dirPath, createIfMissing),
} as ElectronAPI);
