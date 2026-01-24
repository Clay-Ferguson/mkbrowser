import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// Type definitions for the exposed API
export interface AppConfig {
  browseFolder: string;
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
}

export interface ElectronAPI {
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  onFolderSelected: (callback: (folderPath: string) => void) => () => void;
  onCutRequested: (callback: () => void) => () => void;
  onPasteRequested: (callback: () => void) => () => void;
  onDeleteRequested: (callback: () => void) => () => void;
  onViewChanged: (callback: (view: 'browser' | 'search-results') => void) => () => void;
  readDirectory: (dirPath: string) => Promise<FileEntry[]>;
  readFile: (filePath: string) => Promise<string>;
  pathExists: (checkPath: string) => Promise<boolean>;
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  writeFileBinary: (filePath: string, base64Data: string) => Promise<boolean>;
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>;
  deleteFile: (filePath: string) => Promise<boolean>;
  createFolder: (folderPath: string) => Promise<boolean>;
  searchFolder: (folderPath: string, query: string) => Promise<SearchResult[]>;
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
  onViewChanged: (callback: (view: 'browser' | 'search-results') => void) => {
    const handler = (_event: IpcRendererEvent, view: 'browser' | 'search-results') => {
      callback(view);
    };
    ipcRenderer.on('view-changed', handler);
    return () => {
      ipcRenderer.removeListener('view-changed', handler);
    };
  },
  readDirectory: (dirPath: string) => ipcRenderer.invoke('read-directory', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  pathExists: (checkPath: string) => ipcRenderer.invoke('path-exists', checkPath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  writeFileBinary: (filePath: string, base64Data: string) => ipcRenderer.invoke('write-file-binary', filePath, base64Data),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  createFolder: (folderPath: string) => ipcRenderer.invoke('create-folder', folderPath),
  searchFolder: (folderPath: string, query: string) => ipcRenderer.invoke('search-folder', folderPath, query),
} as ElectronAPI);
