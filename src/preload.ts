import { contextBridge, ipcRenderer } from 'electron';
import type { AppConfig, ElectronAPI, CalendarEventResult, HtmlExportOptions, SearchDefinition } from './shared/shared';
import { TEST_HOOKS_ARG } from './shared/shared';

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  pathSep: process.platform === 'win32' ? '\\' : '/',
  testHooksEnabled: process.argv.includes(TEST_HOOKS_ARG),
  quit: () => ipcRenderer.invoke('quit'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  updateConfig: (updates: Partial<AppConfig>) => ipcRenderer.invoke('update-config', updates),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getHelpDocsPath: () => ipcRenderer.invoke('get-help-docs-path'),
  getStartupFile: () => ipcRenderer.invoke('get-startup-file'),
  selectFile: (title: string) => ipcRenderer.invoke('select-file', title),  searchAndReplace: (folderPath: string, searchText: string, replaceText: string) =>
    ipcRenderer.invoke('search-and-replace', folderPath, searchText, replaceText),
  loadDictionary: () => ipcRenderer.invoke('load-dictionary'),
  // Synonyms for the editor's thesaurus strip. See: (docs/technical_notes/thesaurus_view.md#the-ipc-surface)
  lookupThesaurus: (word: string) => ipcRenderer.invoke('lookup-thesaurus', word),
  fetchUrlTitle: (url: string) => ipcRenderer.invoke('fetch-url-title', url),
  readDirectory: (dirPath: string) => ipcRenderer.invoke('read-directory', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  readFileWithMtime: (filePath: string) => ipcRenderer.invoke('read-file-with-mtime', filePath),
  readExif: (filePath: string) => ipcRenderer.invoke('read-exif', filePath),
  writeExif: (filePath: string, data: Record<string, Record<string, string>>) => ipcRenderer.invoke('write-exif', filePath, data),
  getImageDimensions: (filePath: string) => ipcRenderer.invoke('get-image-dimensions', filePath),
  pathExists: (checkPath: string) => ipcRenderer.invoke('path-exists', checkPath),
  isDirectory: (checkPath: string) => ipcRenderer.invoke('is-directory', checkPath),
  ensureFrontMatterId: (filePath: string) => ipcRenderer.invoke('ensure-front-matter-id', filePath),
  findMarkdownById: (id: string, likelyDir: string, rootDir: string) =>
    ipcRenderer.invoke('find-markdown-by-id', id, likelyDir, rootDir),
  findFileByIdSuffix: (id: string, ext: string, likelyDir: string, rootDir: string) =>
    ipcRenderer.invoke('find-file-by-id-suffix', id, ext, likelyDir, rootDir),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  getFileSize: (filePath: string) => ipcRenderer.invoke('get-file-size', filePath),
  getFileMtime: (filePath: string) => ipcRenderer.invoke('get-file-mtime', filePath),
  writeFileBinary: (filePath: string, base64Data: string) => ipcRenderer.invoke('write-file-binary', filePath, base64Data),
  createFile: (filePath: string, content: string) => ipcRenderer.invoke('create-file', filePath, content),
  // Main also renames the file's sibling `.attach` folder. See: (docs/technical_notes/file_attachments.md#rename-synchronization-srcmaints)
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  openExternal: (filePath: string) => ipcRenderer.invoke('open-external', filePath),
  openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),
  createFolder: (folderPath: string) => ipcRenderer.invoke('create-folder', folderPath),
  isFolderEmpty: (folderPath: string) => ipcRenderer.invoke('is-folder-empty', folderPath),
  deleteEmptyFolder: (folderPath: string) => ipcRenderer.invoke('delete-empty-folder', folderPath),
  searchFolder: (folderPath: string, definition: SearchDefinition) => ipcRenderer.invoke('search-folder', folderPath, definition),
  checkAdvancedQuerySyntax: (query: string) => ipcRenderer.invoke('check-advanced-query-syntax', query),
  analyzeFolderHashtags: (folderPath: string) => ipcRenderer.invoke('analyze-folder-hashtags', folderPath),
  loadCalendarEvents: (folderPath: string) => ipcRenderer.invoke('load-calendar-events', folderPath),
  loadCalendarEventsForFiles: (filePaths: string[]) => ipcRenderer.invoke('load-calendar-events-for-files', filePaths),
  scanFolderTree: (folderPath: string, markdownOnly?: boolean) => ipcRenderer.invoke('scan-folder-tree', folderPath, markdownOnly),
  scanFolderGraphLinks: (folderPath: string, nodeIds: string[]) => ipcRenderer.invoke('scan-folder-graph-links', folderPath, nodeIds),
  loadTags: () => ipcRenderer.invoke('load-tags'),
  saveTags: (yamlContent: string) => ipcRenderer.invoke('save-tags', yamlContent),
  setWindowTitle: (title: string) => ipcRenderer.invoke('set-window-title', title),
  selectExportFolder: () => ipcRenderer.invoke('select-export-folder'),
  exportFolderContents: (sourceFolder: string, outputFolder: string, outputFileName: string, includeSubfolders: boolean, includeFilenames: boolean, includeDividers: boolean) => 
    ipcRenderer.invoke('export-folder-contents', sourceFolder, outputFolder, outputFileName, includeSubfolders, includeFilenames, includeDividers),
  exportToPdf: (markdownPath: string, pdfPath: string, sourceFolder?: string) =>
    ipcRenderer.invoke('export-to-pdf', markdownPath, pdfPath, sourceFolder),
  exportFolderToHtml: (sourceFolder: string, outputFolder: string, options: HtmlExportOptions) =>
    ipcRenderer.invoke('export-folder-html', sourceFolder, outputFolder, options),
  checkHtmlExportTarget: (sourceFolder: string, outputFolder: string) =>
    ipcRenderer.invoke('check-html-export-target', sourceFolder, outputFolder),
  runShellScript: (filePath: string) =>
    ipcRenderer.invoke('run-shell-script', filePath),
  // AI Chat: Ask AI and Reply. See: (docs/technical_notes/ai_chat.md#code-map)
  askAi: (prompt: string, parentFolderPath: string) =>
    ipcRenderer.invoke('ask-ai', prompt, parentFolderPath),
  replyToAi: (parentFolderPath: string, createSubFolder: boolean) =>
    ipcRenderer.invoke('reply-to-ai', parentFolderPath, createSubFolder),
  getAiUsage: () => ipcRenderer.invoke('get-ai-usage'),
  resetAiUsage: () => ipcRenderer.invoke('reset-ai-usage'),
  queueScriptedAnswer: (answer: string) => ipcRenderer.invoke('queue-scripted-answer', answer),
  // Builds the AI Chat tab's thread. See: (docs/technical_notes/ai_chat.md#how-the-thread-is-gathered)
  gatherThreadEntries: (folderPath: string) => ipcRenderer.invoke('gather-thread-entries', folderPath),
  rewriteContent: (content: string, filePath: string, hasIndexFile: boolean) => ipcRenderer.invoke('rewrite-content', content, filePath, hasIndexFile),
  rewriteContentSelection: (content: string, selectionFrom: number, selectionTo: number, filePath: string, hasIndexFile: boolean) => ipcRenderer.invoke('rewrite-content-selection', content, selectionFrom, selectionTo, filePath, hasIndexFile),

  // AI streaming events (drive the streaming dialog). See: (docs/technical_notes/ai_chat.md#asking-the-ai)
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

  // Document Mode (.INDEX.yaml) operations. See: (docs/technical_notes/document_mode.md#code-locations)
  insertIntoIndexYaml: (dirPath: string, newNames: string | string[], insertAfterName: string | null) =>
    ipcRenderer.invoke('insert-into-index-yaml', dirPath, newNames, insertAfterName),
  moveInIndexYaml: (dirPath: string, name: string, direction: 'up' | 'down') =>
    ipcRenderer.invoke('move-in-index-yaml', dirPath, name, direction),
  moveToEdgeInIndexYaml: (dirPath: string, name: string, edge: 'top' | 'bottom') =>
    ipcRenderer.invoke('move-to-edge-in-index-yaml', dirPath, name, edge),
  reconcileIndexedFiles: (dirPath: string, createIfMissing?: boolean) =>
    ipcRenderer.invoke('reconcile-indexed-files', dirPath, createIfMissing),
  readIndexYaml: (dirPath: string) =>
    ipcRenderer.invoke('read-index-yaml', dirPath),
} as ElectronAPI);
