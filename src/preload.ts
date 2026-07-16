import { contextBridge, ipcRenderer } from 'electron';
import type { AppConfig, ElectronAPI, CalendarEventResult, OcrTarget } from './shared/shared';

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  pathSep: process.platform === 'win32' ? '\\' : '/',
  quit: () => ipcRenderer.invoke('quit'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (updates: Partial<AppConfig>) => ipcRenderer.invoke('update-config', updates),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  searchAndReplace: (folderPath: string, searchText: string, replaceText: string) =>
    ipcRenderer.invoke('search-and-replace', folderPath, searchText, replaceText),
  loadDictionary: () => ipcRenderer.invoke('load-dictionary'),
  readDirectory: (dirPath: string) => ipcRenderer.invoke('read-directory', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  readFileWithMtime: (filePath: string) => ipcRenderer.invoke('read-file-with-mtime', filePath),
  readExif: (filePath: string) => ipcRenderer.invoke('read-exif', filePath),
  writeExif: (filePath: string, data: Record<string, Record<string, string>>) => ipcRenderer.invoke('write-exif', filePath, data),
  getImageDimensions: (filePath: string) => ipcRenderer.invoke('get-image-dimensions', filePath),
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
  searchFolder: (folderPath: string, query: string, searchType?: 'literal' | 'wildcard' | 'advanced', searchMode?: 'content' | 'filenames', searchImageExif?: boolean, mostRecent?: boolean) => ipcRenderer.invoke('search-folder', folderPath, query, searchType, searchMode, searchImageExif, mostRecent),
  analyzeFolderHashtags: (folderPath: string) => ipcRenderer.invoke('analyze-folder-hashtags', folderPath),
  loadCalendarEvents: (folderPath: string) => ipcRenderer.invoke('load-calendar-events', folderPath),
  scanFolderTree: (folderPath: string) => ipcRenderer.invoke('scan-folder-tree', folderPath),
  loadTags: () => ipcRenderer.invoke('load-tags'),
  saveTags: (yamlContent: string) => ipcRenderer.invoke('save-tags', yamlContent),
  setWindowTitle: (title: string) => ipcRenderer.invoke('set-window-title', title),
  selectExportFolder: () => ipcRenderer.invoke('select-export-folder'),
  exportFolderContents: (sourceFolder: string, outputFolder: string, outputFileName: string, includeSubfolders: boolean, includeFilenames: boolean, includeDividers: boolean) => 
    ipcRenderer.invoke('export-folder-contents', sourceFolder, outputFolder, outputFileName, includeSubfolders, includeFilenames, includeDividers),
  exportToPdf: (markdownPath: string, pdfPath: string, sourceFolder?: string) =>
    ipcRenderer.invoke('export-to-pdf', markdownPath, pdfPath, sourceFolder),
  runShellScript: (filePath: string) =>
    ipcRenderer.invoke('run-shell-script', filePath),
  askAi: (prompt: string, parentFolderPath: string) =>
    ipcRenderer.invoke('ask-ai', prompt, parentFolderPath),
  replyToAi: (parentFolderPath: string, createSubFolder: boolean) =>
    ipcRenderer.invoke('reply-to-ai', parentFolderPath, createSubFolder),
  getAiUsage: () => ipcRenderer.invoke('get-ai-usage'),
  resetAiUsage: () => ipcRenderer.invoke('reset-ai-usage'),
  queueScriptedAnswer: (answer: string) => ipcRenderer.invoke('queue-scripted-answer', answer),
  gatherThreadEntries: (folderPath: string) => ipcRenderer.invoke('gather-thread-entries', folderPath),
  rewriteContent: (content: string, filePath: string, hasIndexFile: boolean) => ipcRenderer.invoke('rewrite-content', content, filePath, hasIndexFile),
  rewriteContentSelection: (content: string, selectionFrom: number, selectionTo: number, filePath: string, hasIndexFile: boolean) => ipcRenderer.invoke('rewrite-content-selection', content, selectionFrom, selectionTo, filePath, hasIndexFile),

  // llama.cpp server lifecycle
  checkLlamaHealth: () => ipcRenderer.invoke('check-llama-health'),
  startLlamaServer: () => ipcRenderer.invoke('start-llama-server'),
  stopLlamaServer: () => ipcRenderer.invoke('stop-llama-server'),

  // AI streaming events
  onAiStreamStart: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('ai-stream-start', listener);
    return () => { ipcRenderer.removeListener('ai-stream-start', listener); };
  },
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

  // Calendar file-change events (chokidar → renderer)
  onCalendarFileChanged: (callback: (results: CalendarEventResult[], filePath: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, results: CalendarEventResult[], filePath: string) => callback(results, filePath);
    ipcRenderer.on('calendar-file-changed', listener);
    return () => { ipcRenderer.removeListener('calendar-file-changed', listener); };
  },

  // Calendar file/folder delete events (chokidar → renderer)
  onCalendarFileDeleted: (callback: (deletedPath: string, isFolder: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, deletedPath: string, isFolder: boolean) => callback(deletedPath, isFolder);
    ipcRenderer.on('calendar-file-deleted', listener);
    return () => { ipcRenderer.removeListener('calendar-file-deleted', listener); };
  },

  // Calendar watcher error (e.g. inotify exhaustion) — surfaced once so the user
  // knows live updates degraded (chokidar → renderer)
  onCalendarWatcherError: (callback: (message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on('calendar-watcher-error', listener);
    return () => { ipcRenderer.removeListener('calendar-watcher-error', listener); };
  },

  runOcrInTerminal: (ocrToolsFolder: string, targets: OcrTarget[]) => ipcRenderer.invoke('run-ocr-in-terminal', ocrToolsFolder, targets),
  insertIntoIndexYaml: (dirPath: string, newName: string, insertAfterName: string | null) =>
    ipcRenderer.invoke('insert-into-index-yaml', dirPath, newName, insertAfterName),
  moveInIndexYaml: (dirPath: string, name: string, direction: 'up' | 'down') =>
    ipcRenderer.invoke('move-in-index-yaml', dirPath, name, direction),
  moveToEdgeInIndexYaml: (dirPath: string, name: string, edge: 'top' | 'bottom') =>
    ipcRenderer.invoke('move-to-edge-in-index-yaml', dirPath, name, edge),
  reconcileIndexedFiles: (dirPath: string, createIfMissing?: boolean) =>
    ipcRenderer.invoke('reconcile-indexed-files', dirPath, createIfMissing),
  readIndexYaml: (dirPath: string) =>
    ipcRenderer.invoke('read-index-yaml', dirPath),
  writeIndexOptions: (dirPath: string, options: Record<string, unknown>) =>
    ipcRenderer.invoke('write-index-options', dirPath, options),
} as ElectronAPI);
