export type FontSize = 'small' | 'medium' | 'large' | 'xlarge';

export type SortOrder = 'alphabetical' | 'created-chron' | 'created-reverse' | 'modified-chron' | 'modified-reverse';

export interface AppSettings {
  fontSize: FontSize;
  sortOrder: SortOrder;
  foldersOnTop: boolean;
}

export interface AppConfig {
  browseFolder: string;
  settings?: AppSettings;
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
}

export interface SearchResult {
  path: string;
  relativePath: string;
  matchCount: number;
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

export interface ElectronAPI {
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  onFolderSelected: (callback: (folderPath: string) => void) => () => void;
  onCutRequested: (callback: () => void) => () => void;
  onPasteRequested: (callback: () => void) => () => void;
  onDeleteRequested: (callback: () => void) => () => void;
  onRenumberRequested: (callback: () => void) => () => void;
  onViewChanged: (callback: (view: 'browser' | 'search-results' | 'settings') => void) => () => void;
  readDirectory: (dirPath: string) => Promise<FileEntry[]>;
  readFile: (filePath: string) => Promise<string>;
  pathExists: (checkPath: string) => Promise<boolean>;
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  writeFileBinary: (filePath: string, base64Data: string) => Promise<boolean>;
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>;
  deleteFile: (filePath: string) => Promise<boolean>;
  openExternal: (filePath: string) => Promise<boolean>;
  createFolder: (folderPath: string) => Promise<boolean>;
  searchFolder: (folderPath: string, query: string, isAdvanced?: boolean) => Promise<SearchResult[]>;
  renumberFiles: (dirPath: string) => Promise<RenumberResult>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
