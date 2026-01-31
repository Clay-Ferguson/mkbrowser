import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

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

export interface AppConfig {
  browseFolder: string;
  settings?: AppSettings;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isMarkdown: boolean;
  content?: string;
}

export interface SearchResult {
  path: string;
  relativePath: string;
  matchCount: number;
  lineNumber?: number;
  lineText?: string;
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

export interface ElectronAPI {
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  onFolderSelected: (callback: (folderPath: string) => void) => () => void;
  onCutRequested: (callback: () => void) => () => void;
  onUndoCutRequested: (callback: () => void) => () => void;
  onPasteRequested: (callback: () => void) => () => void;
  onDeleteRequested: (callback: () => void) => () => void;
  onSelectAllRequested: (callback: () => void) => () => void;
  onUnselectAllRequested: (callback: () => void) => () => void;
  onRenumberRequested: (callback: () => void) => () => void;
  onViewChanged: (callback: (view: 'browser' | 'search-results' | 'settings') => void) => () => void;
  onOpenSearchDefinition: (callback: (definition: SearchDefinition) => void) => () => void;
  onEditSearchDefinition: (callback: (definition: SearchDefinition) => void) => () => void;
  readDirectory: (dirPath: string) => Promise<FileEntry[]>;
  readFile: (filePath: string) => Promise<string>;
  pathExists: (checkPath: string) => Promise<boolean>;
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  writeFileBinary: (filePath: string, base64Data: string) => Promise<boolean>;
  createFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>;
  deleteFile: (filePath: string) => Promise<boolean>;
  openExternal: (filePath: string) => Promise<boolean>;
  createFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  searchFolder: (folderPath: string, query: string, searchType?: 'literal' | 'wildcard' | 'advanced', searchMode?: 'content' | 'filenames', searchBlock?: 'entire-file' | 'file-lines') => Promise<SearchResult[]>;
  renumberFiles: (dirPath: string) => Promise<RenumberResult>;
}

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config: AppConfig) => ipcRenderer.invoke('save-config', config),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  onFolderSelected: (callback: (folderPath: string) => void) => {
    const handler = (_event: IpcRendererEvent, folderPath: string) => {
      callback(folderPath);
    };
    ipcRenderer.on('folder-selected', handler);
    return () => {
      ipcRenderer.removeListener('folder-selected', handler);
    };
  },
  onCutRequested: (callback: () => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('cut-items', handler);
    return () => {
      ipcRenderer.removeListener('cut-items', handler);
    };
  },
  onUndoCutRequested: (callback: () => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('undo-cut', handler);
    return () => {
      ipcRenderer.removeListener('undo-cut', handler);
    };
  },
  onPasteRequested: (callback: () => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('paste-items', handler);
    return () => {
      ipcRenderer.removeListener('paste-items', handler);
    };
  },
  onDeleteRequested: (callback: () => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('delete-items', handler);
    return () => {
      ipcRenderer.removeListener('delete-items', handler);
    };
  },
  onSelectAllRequested: (callback: () => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('select-all-items', handler);
    return () => {
      ipcRenderer.removeListener('select-all-items', handler);
    };
  },
  onUnselectAllRequested: (callback: () => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('unselect-all-items', handler);
    return () => {
      ipcRenderer.removeListener('unselect-all-items', handler);
    };
  },
  onMoveToFolderRequested: (callback: () => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('move-to-folder', handler);
    return () => {
      ipcRenderer.removeListener('move-to-folder', handler);
    };
  },
  onRenumberRequested: (callback: () => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('renumber-files', handler);
    return () => {
      ipcRenderer.removeListener('renumber-files', handler);
    };
  },
  onViewChanged: (callback: (view: 'browser' | 'search-results' | 'settings') => void) => {
    const handler = (_event: IpcRendererEvent, view: 'browser' | 'search-results' | 'settings') => {
      callback(view);
    };
    ipcRenderer.on('view-changed', handler);
    return () => {
      ipcRenderer.removeListener('view-changed', handler);
    };
  },
  onOpenSearchDefinition: (callback: (definition: SearchDefinition) => void) => {
    const handler = (_event: IpcRendererEvent, definition: SearchDefinition) => {
      callback(definition);
    };
    ipcRenderer.on('open-search-definition', handler);
    return () => {
      ipcRenderer.removeListener('open-search-definition', handler);
    };
  },
  onEditSearchDefinition: (callback: (definition: SearchDefinition) => void) => {
    const handler = (_event: IpcRendererEvent, definition: SearchDefinition) => {
      callback(definition);
    };
    ipcRenderer.on('edit-search-definition', handler);
    return () => {
      ipcRenderer.removeListener('edit-search-definition', handler);
    };
  },
  onOpenBookmark: (callback: (fullPath: string) => void) => {
    const handler = (_event: IpcRendererEvent, fullPath: string) => {
      callback(fullPath);
    };
    ipcRenderer.on('open-bookmark', handler);
    return () => {
      ipcRenderer.removeListener('open-bookmark', handler);
    };
  },
  loadDictionary: () => ipcRenderer.invoke('load-dictionary'),
  readDirectory: (dirPath: string) => ipcRenderer.invoke('read-directory', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  pathExists: (checkPath: string) => ipcRenderer.invoke('path-exists', checkPath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  writeFileBinary: (filePath: string, base64Data: string) => ipcRenderer.invoke('write-file-binary', filePath, base64Data),
  createFile: (filePath: string, content: string) => ipcRenderer.invoke('create-file', filePath, content),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  openExternal: (filePath: string) => ipcRenderer.invoke('open-external', filePath),
  openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),
  createFolder: (folderPath: string) => ipcRenderer.invoke('create-folder', folderPath),
  searchFolder: (folderPath: string, query: string, searchType?: 'literal' | 'wildcard' | 'advanced', searchMode?: 'content' | 'filenames', searchBlock?: 'entire-file' | 'file-lines') => ipcRenderer.invoke('search-folder', folderPath, query, searchType, searchMode, searchBlock),
  renumberFiles: (dirPath: string) => ipcRenderer.invoke('renumber-files', dirPath),
  setWindowTitle: (title: string) => ipcRenderer.invoke('set-window-title', title),
  onExportRequested: (callback: () => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('export-requested', handler);
    return () => {
      ipcRenderer.removeListener('export-requested', handler);
    };
  },
  selectExportFolder: () => ipcRenderer.invoke('select-export-folder'),
  exportFolderContents: (sourceFolder: string, outputFolder: string, outputFileName: string, includeSubfolders: boolean, includeFilenames: boolean, includeDividers: boolean) => 
    ipcRenderer.invoke('export-folder-contents', sourceFolder, outputFolder, outputFileName, includeSubfolders, includeFilenames, includeDividers),
  exportToPdf: (markdownPath: string, pdfPath: string) =>
    ipcRenderer.invoke('export-to-pdf', markdownPath, pdfPath),
} as ElectronAPI);
