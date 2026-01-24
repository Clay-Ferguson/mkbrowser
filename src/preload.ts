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

export interface ElectronAPI {
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  onFolderSelected: (callback: (folderPath: string) => void) => () => void;
  onCutRequested: (callback: () => void) => () => void;
  readDirectory: (dirPath: string) => Promise<FileEntry[]>;
  readFile: (filePath: string) => Promise<string>;
  pathExists: (checkPath: string) => Promise<boolean>;
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  renameFile: (oldPath: string, newPath: string) => Promise<boolean>;
  deleteFile: (filePath: string) => Promise<boolean>;
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
  readDirectory: (dirPath: string) => ipcRenderer.invoke('read-directory', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  pathExists: (checkPath: string) => ipcRenderer.invoke('path-exists', checkPath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
} as ElectronAPI);
