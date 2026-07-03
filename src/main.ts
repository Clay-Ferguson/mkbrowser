import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { initConfig, getConfig, updateConfig, flushConfig } from './main/configMgr';
import type { AppConfig, OcrTarget } from './shared/shared';

import { readDirectory } from './main/fileUtil';
import { parseFrontMatter } from './shared/frontMatterUtil';
import { reconcileIndexedFiles, insertIntoIndexYaml, moveInIndexYaml, moveToEdgeInIndexYaml, readIndexYaml, writeIndexOptions, ensureFrontMatterIdIfIndexed, recordFrontMatterIdInIndex, renameInIndexYaml } from './main/indexUtil';
import { frontMatterFileSaved } from './main/frontMatterHandler';
import { processTOC } from './shared/tocUtil';
import { searchAndReplace, type ReplaceResult } from './main/searchAndReplace';
import { parseIgnoredPaths } from './shared/searchHelpers';
import { searchFolder, type SearchResult } from './main/search';
import { analyzeFolderHashtags, type FolderAnalysisResult } from './main/folderAnalysis';
import { loadCalendarEvents, type CalendarEventResult } from './main/calendarLoader';
import { startCalendarWatcher, stopCalendarWatcher, getCalendarWatcherFolder } from './main/calendarWatcher';
import { scanFolderTree, type FolderGraphResult } from './main/folderGraph';
import { loadTags } from './main/tagLoader';
import type { TagCategory } from './shared/tagUtil';
import { handleAskAI, handleRewriteContent, handleRewriteContentSection, handleReplyToAI, gatherThreadEntries, friendlyAIError } from './main/ai/aiUtil';
import { hasScriptedAnswer, queueScriptedAnswer } from './main/ai/langGraph';
import type { StreamCallbacks } from './main/ai/langGraph';
import { getUsageWithCosts, resetUsage } from './main/ai/usageTracker';
import { checkHealth, ensureRunning, stopServer } from './main/ai/llamaServer';
import { readExifMetadata, writeExifMetadata } from './main/exifUtil';
import { logger } from './shared/logUtil';
import { exportFolderContents, exportToPdf } from './main/exportUtil';
import { runShellScript, runOcrInTerminal } from './main/launcherUtil';

// Feature flag: set to false to revert to non-streaming AI responses (no popup).
const ENABLE_STREAM_RESPONSE = true;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Register custom protocol for serving local files (must be done before app ready)
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
]);

import type { FileEntry } from './global';
import { ATTACH_SUFFIX } from './shared/specialFiles';

let mainWindow: BrowserWindow | null = null;

// Setup the local-file protocol handler
function setupLocalFileProtocol(): void {
  protocol.handle('local-file', (request) => {
    // URL format: local-file:///absolute/path/to/file
    const filePath = decodeURIComponent(request.url.slice('local-file://'.length));
    return net.fetch(`file://${filePath}`);
  });
}

const createWindow = () => {
  // Load app icon - handle both development and production paths
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon-256.png')
    : path.join(app.getAppPath(), 'icon-256.png');
  
  logger.log('Icon path:', iconPath, 'Exists:', fs.existsSync(iconPath));
  const icon = nativeImage.createFromPath(iconPath);
  logger.log('Icon isEmpty:', icon.isEmpty());

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: icon,

    // need transparent backgrount to fix the classic Linux "ghost border" syndrome
    transparent: true, // This often snaps the border out of existence
    backgroundColor: '#00000000', // Ensure the background starts fully clear
    
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Electron shows no native right-click menu by default, so provide one for
  // copying selected text and for cut/paste in editable fields. Without this,
  // right-clicking a text selection does nothing at all.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' },
      );
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy' });
    }
    if (items.length > 0) {
      Menu.buildFromTemplate(items).popup();
    }
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
      .catch((err: unknown) => logger.error('Failed to load dev server URL:', err));
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    ).catch((err: unknown) => logger.error('Failed to load index.html:', err));
  }

  // Open the DevTools in development
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL && mainWindow) {
    mainWindow.webContents.openDevTools();
  }
};

// IPC Handlers
function setupIpcHandlers(): void {
  // Quit the application
  ipcMain.handle('quit', () => {
    app.quit();
  });

  // Load dictionary files for spell checking
  ipcMain.handle('load-dictionary', async (): Promise<{ affData: string; dicData: string }> => {
    const dictionaryPath = app.isPackaged
      ? path.join(process.resourcesPath, 'dictionaries')
      : path.join(app.getAppPath(), 'resources', 'dictionaries');

    const affPath = path.join(dictionaryPath, 'en_US.aff');
    const dicPath = path.join(dictionaryPath, 'en_US.dic');

    const [affData, dicData] = await Promise.all([
      fs.promises.readFile(affPath, 'utf-8'),
      fs.promises.readFile(dicPath, 'utf-8'),
    ]);

    return { affData, dicData };
  });

  // Get the in-memory config (no file I/O after startup)
  ipcMain.handle('get-config', () => {
    return getConfig();
  });

  // Merge partial config updates into in-memory state and flush to disk.
  // Renderer callers send only the keys they own; the merge happens here on
  // the single main-process thread, so concurrent updates can't clobber.
  ipcMain.handle('update-config', (_event, updates: Partial<AppConfig>): Promise<void> => {
    // updateConfig mutates in-memory state synchronously and returns a promise
    // that resolves once the change is flushed to disk. Returning it lets the
    // renderer's `await api.updateConfig(...)` resolve after persist (and surface
    // write errors) without blocking the main-process event loop.
    return updateConfig(updates);
  });

  // Set window title
  ipcMain.handle('set-window-title', (_event, title: string): void => {
    if (mainWindow) {
      mainWindow.setTitle(title);
    }
  });

  // Open folder selection dialog
  ipcMain.handle('select-folder', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select a folder to browse',
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // Read directory contents
  ipcMain.handle('read-directory', async (_event, dirPath: string): Promise<FileEntry[]> => {
    return readDirectory(dirPath, getConfig().aiEnabled ?? false);
  });

  // Read a single file's content
  ipcMain.handle('read-file', async (_event, filePath: string): Promise<string> => {
    try {
      return await fs.promises.readFile(filePath, 'utf-8');
    } catch (error) {
      logger.error('Error reading file:', error);
      return '';
    }
  });

  // Read EXIF metadata from an image file
  ipcMain.handle('read-exif', async (_event, filePath: string): Promise<Record<string, Record<string, string>>> => {
    try {
      return await readExifMetadata(filePath);
    } catch (error) {
      logger.error('Error reading EXIF data:', error);
      return {};
    }
  });

  // Write EXIF metadata to an image file
  ipcMain.handle('write-exif', async (_event, filePath: string, data: Record<string, Record<string, string>>): Promise<boolean> => {
    try {
      return await writeExifMetadata(filePath, data);
    } catch (error) {
      logger.error('Error writing EXIF data:', error);
      return false;
    }
  });

  // Check if path exists
  ipcMain.handle('path-exists', async (_event, checkPath: string): Promise<boolean> => {
    try {
      await fs.promises.stat(checkPath);
      return true;
    } catch {
      return false;
    }
  });

  // Write content to a file
  ipcMain.handle('write-file', async (_event, filePath: string, content: string): Promise<{ ok: boolean; content: string }> => {
    try {
      let finalContent = content;
      let addedIndexId: string | null = null;

      if (filePath.toLowerCase().endsWith('.md')) {
        finalContent = await processTOC(content);
        const ensured = await ensureFrontMatterIdIfIndexed(filePath, finalContent);
        finalContent = ensured.content;
        addedIndexId = ensured.addedId;
      }

      await fs.promises.writeFile(filePath, finalContent, 'utf-8');

      // Record a freshly-injected Document Mode id in .INDEX.yaml only AFTER the
      // file content (which now carries that id) is on disk, so the index can
      // never reference an id that isn't in the file (issue 014).
      if (addedIndexId) {
        await recordFrontMatterIdInIndex(filePath, addedIndexId);
      }

      // Post-save: run front-matter autogen for Markdown files
      if (filePath.toLowerCase().endsWith('.md')) {
        const { yaml: frontMatter, content: body } = parseFrontMatter(finalContent);
        if (frontMatter) {
          frontMatterFileSaved(filePath, frontMatter, body).catch((err: unknown) => {
            logger.error(`Front-matter post-save processing failed for ${filePath}:`, err);
          });
        }
      }

      return { ok: true, content: finalContent };
    } catch (error) {
      logger.error('Error writing file:', error);
      return { ok: false, content };
    }
  });

  // Get file size in bytes
  ipcMain.handle('get-file-size', async (_event, filePath: string): Promise<number> => {
    try {
      const stats = await fs.promises.stat(filePath);
      return stats.size;
    } catch (error) {
      logger.error('Error getting file size:', error);
      return -1;
    }
  });

  // Get file last-modified time (mtimeMs) so the renderer can detect external changes
  ipcMain.handle('get-file-mtime', async (_event, filePath: string): Promise<number> => {
    try {
      const stats = await fs.promises.stat(filePath);
      return stats.mtimeMs;
    } catch (error) {
      logger.error('Error getting file mtime:', error);
      return -1;
    }
  });

  // Write binary content to a file (for images)
  ipcMain.handle('write-file-binary', async (_event, filePath: string, base64Data: string): Promise<boolean> => {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.promises.writeFile(filePath, buffer);
      return true;
    } catch (error) {
      logger.error('Error writing binary file:', error);
      return false;
    }
  });

  // Create a new file (checks if it already exists first)
  ipcMain.handle('create-file', async (_event, filePath: string, content: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // Check if file already exists
      try {
        await fs.promises.access(filePath);
        // If we get here, the file exists
        return { success: false, error: 'A file/folder with this name already exists' };
      } catch {
        // File doesn't exist, we can create it
      }
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch (error) {
      logger.error('Error creating file:', error);
      const err = error as NodeJS.ErrnoException;
      let errorMessage = 'Failed to create file';
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        errorMessage = 'Permission denied';
      } else if (err.message) {
        errorMessage = err.message;
      }
      return { success: false, error: errorMessage };
    }
  });

  // Rename a file or folder
  ipcMain.handle('rename-file', async (_event, oldPath: string, newPath: string): Promise<boolean> => {
    try {
      // Refuse to clobber a *different* existing entry at the destination.
      // fs.rename silently overwrites the target on POSIX, and on Windows
      // (libuv uses MoveFileEx with MOVEFILE_REPLACE_EXISTING), so without this
      // guard a move/paste onto an occupied path would destroy the existing
      // file. On case-insensitive filesystems (NTFS/APFS) this is also how a
      // paste of two items differing only in case would silently lose data.
      //
      // The "different" qualifier matters: a pure case-only rename of a single
      // file (Readme.md -> README.md) targets the SAME on-disk entry on a
      // case-insensitive FS, where stat(newPath) resolves back to the source.
      // That must still succeed, so we only block when the target is a distinct
      // entry (different dev/ino).
      if (oldPath !== newPath) {
        let targetStat: import('fs').Stats | null = null;
        try {
          targetStat = await fs.promises.stat(newPath);
        } catch {
          targetStat = null; // nothing at the destination — safe to rename
        }
        if (targetStat) {
          const sourceStat = await fs.promises.stat(oldPath);
          const sameEntry = targetStat.dev === sourceStat.dev && targetStat.ino === sourceStat.ino;
          if (!sameEntry) {
            logger.warn(`Refusing to rename ${oldPath} -> ${newPath}: a different entry already exists at the destination`);
            return false;
          }
        }
      }
      await fs.promises.rename(oldPath, newPath);
      const dirPath = path.dirname(oldPath);
      const oldName = path.basename(oldPath);
      const newName = path.basename(newPath);
      // Update the file's entry in .INDEX.yaml if present
      await renameInIndexYaml(dirPath, oldName, newName);
      // Rename the associated attach folder if it exists, and update its index entry
      const oldAttachName = `${oldName}${ATTACH_SUFFIX}`;
      const newAttachName = `${newName}${ATTACH_SUFFIX}`;
      try {
        await fs.promises.access(path.join(dirPath, oldAttachName));
        await fs.promises.rename(path.join(dirPath, oldAttachName), path.join(dirPath, newAttachName));
        await renameInIndexYaml(dirPath, oldAttachName, newAttachName);
      } catch {
        // No attach folder exists, nothing to do
      }
      return true;
    } catch (error) {
      logger.error('Error renaming file:', error);
      return false;
    }
  });

  // Delete a file or folder (moves to OS trash)
  ipcMain.handle('delete-file', async (_event, filePath: string): Promise<boolean> => {
    try {
      await shell.trashItem(filePath);
      return true;
    } catch (error) {
      logger.error('Error moving to trash:', error);
      return false;
    }
  });

  // Create a new folder
  ipcMain.handle('create-folder', async (_event, folderPath: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await fs.promises.mkdir(folderPath);
      return { success: true };
    } catch (error) {
      logger.error('Error creating folder:', error);
      const err = error as NodeJS.ErrnoException;
      let errorMessage = 'Failed to create folder';
      if (err.code === 'EEXIST') {
        errorMessage = 'A file/folder with this name already exists';
      } else if (err.code === 'EACCES' || err.code === 'EPERM') {
        errorMessage = 'Permission denied';
      } else if (err.message) {
        errorMessage = err.message;
      }
      return { success: false, error: errorMessage };
    }
  });


  // Insert a new entry into .INDEX.yaml at the specified position
  ipcMain.handle('insert-into-index-yaml', async (_event, dirPath: string, newName: string, insertAfterName: string | null): Promise<{ success: boolean; error?: string }> => {
    return insertIntoIndexYaml(dirPath, newName, insertAfterName);
  });

  // Move an entry up or down one position in .INDEX.yaml
  ipcMain.handle('move-in-index-yaml', async (_event, dirPath: string, name: string, direction: 'up' | 'down'): Promise<{ success: boolean; error?: string }> => {
    return moveInIndexYaml(dirPath, name, direction);
  });

  // Move an entry to the top or bottom of .INDEX.yaml
  ipcMain.handle('move-to-edge-in-index-yaml', async (_event, dirPath: string, name: string, edge: 'top' | 'bottom'): Promise<{ success: boolean; error?: string }> => {
    return moveToEdgeInIndexYaml(dirPath, name, edge);
  });

  // Reconcile .INDEX.yaml with the filesystem (phase 1: ensure all markdown files have a front-matter id)
  ipcMain.handle('reconcile-indexed-files', async (_event, dirPath: string, createIfMissing = false): Promise<{ success: boolean; error?: string }> => {
    return reconcileIndexedFiles(dirPath, createIfMissing);
  });

  // Read .INDEX.yaml for a directory
  ipcMain.handle('read-index-yaml', async (_event, dirPath: string) => {
    return readIndexYaml(dirPath);
  });

  // Write options section of .INDEX.yaml
  ipcMain.handle('write-index-options', async (_event, dirPath: string, options: Record<string, unknown>): Promise<{ success: boolean; error?: string }> => {
    return writeIndexOptions(dirPath, options);
  });

  // Search and replace in files recursively
  ipcMain.handle('search-and-replace', async (_event, folderPath: string, searchText: string, replaceText: string): Promise<ReplaceResult[]> => {
    try {
      const ignoredPaths = parseIgnoredPaths(getConfig().settings?.ignoredPaths ?? '');
      return await searchAndReplace(folderPath, searchText, replaceText, ignoredPaths);
    } catch (error) {
      logger.error('Error in search and replace:', error);
      return [];
    }
  });

  // Search folder recursively for text in .md and .txt files
  ipcMain.handle('open-external', async (_event, filePath: string): Promise<boolean> => {
    try {
      const result = await shell.openPath(filePath);
      // shell.openPath returns empty string on success, error message on failure
      return result === '';
    } catch {
      return false;
    }
  });

  // Open URL in external browser (for http/https links)
  ipcMain.handle('open-external-url', async (_event, url: string): Promise<boolean> => {
    try {
      // Allow http, https, and file URLs
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')) {
        await shell.openExternal(url);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  });

  ipcMain.handle('search-folder', async (_event, folderPath: string, query: string, searchType: 'literal' | 'wildcard' | 'advanced' = 'literal', searchMode: 'content' | 'filenames' = 'content', searchImageExif = false, mostRecent = false): Promise<SearchResult[]> => {
    try {
      const ignoredPaths = parseIgnoredPaths(getConfig().settings?.ignoredPaths ?? '');
      return await searchFolder(folderPath, query, searchType, searchMode, ignoredPaths, searchImageExif, mostRecent);
    } catch (error) {
      logger.error('Error searching folder:', error);
      return [];
    }
  });

  // Analyze folder for hashtags in .md and .txt files
  ipcMain.handle('analyze-folder-hashtags', async (_event, folderPath: string): Promise<FolderAnalysisResult> => {
    try {
      const ignoredPaths = parseIgnoredPaths(getConfig().settings?.ignoredPaths ?? '');
      return await analyzeFolderHashtags(folderPath, ignoredPaths);
    } catch (error) {
      logger.error('Error analyzing folder:', error);
      return { hashtags: [], totalFiles: 0 };
    }
  });

  // Scan folder for markdown files with a 'due' front matter property, then start watching it
  ipcMain.handle('load-calendar-events', async (_event, folderPath: string): Promise<CalendarEventResult[]> => {
    try {
      const ignoredPaths = parseIgnoredPaths(getConfig().settings?.ignoredPaths ?? '');
      const results = await loadCalendarEvents(folderPath, ignoredPaths);

      // Start (or keep) the file watcher for this folder
      if (getCalendarWatcherFolder() !== folderPath) {
        await startCalendarWatcher(folderPath, (results, filePath) => {
          logger.info(`[main] calendar-file-changed: sending to renderer filePath=${filePath} count=${results.length}`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('calendar-file-changed', results, filePath);
          }
        }, (deletedPath, isFolder) => {
          logger.info(`[main] calendar-file-deleted: deletedPath=${deletedPath} isFolder=${isFolder}`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('calendar-file-deleted', deletedPath, isFolder);
          }
        }, ignoredPaths);
      }

      return results;
    } catch (error) {
      logger.error('Error loading calendar events:', error);
      return [];
    }
  });

  // Recursively scan folder structure for the FolderGraphView (D3 graph).
  ipcMain.handle('scan-folder-tree', async (_event, folderPath: string): Promise<FolderGraphResult> => {
    try {
      const ignoredPaths = parseIgnoredPaths(getConfig().settings?.ignoredPaths ?? '');
      return await scanFolderTree(folderPath, ignoredPaths);
    } catch (error) {
      logger.error('Error scanning folder tree:', error);
      // Propagate so the renderer can surface the reason (e.g. the graph
      // exceeds the node cap even with files excluded) rather than silently
      // showing an empty graph.
      throw error;
    }
  });

  // Load tags from the tags.yaml in the config folder
  ipcMain.handle('load-tags', async (): Promise<TagCategory[]> => {
    try {
      const configDir = app.getPath('userData');
      return await loadTags(configDir);
    } catch (error) {
      logger.error('Error loading tags:', error);
      return [];
    }
  });

  // Save tags.yaml to the config folder
  ipcMain.handle('save-tags', async (_event, yamlContent: string): Promise<void> => {
    const configDir = app.getPath('userData');
    const tagsFile = path.join(configDir, 'tags.yaml');
    await fs.promises.writeFile(tagsFile, yamlContent, 'utf-8');
  });

  // Select folder for export output
  ipcMain.handle('select-export-folder', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select export output folder',
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // Export folder contents to a single markdown file
  ipcMain.handle('export-folder-contents', async (
    _event,
    sourceFolder: string,
    outputFolder: string,
    outputFileName: string,
    includeSubfolders: boolean,
    includeFilenames: boolean,
    includeDividers: boolean
  ): Promise<{ success: boolean; outputPath?: string; error?: string }> => {
    try {
      return await exportFolderContents(sourceFolder, outputFolder, outputFileName, includeSubfolders, includeFilenames, includeDividers);
    } catch (error) {
      logger.error('Error exporting folder contents:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  });

  // Export markdown to PDF using external terminal
  ipcMain.handle('export-to-pdf', async (
    _event,
    markdownPath: string,
    pdfPath: string,
    sourceFolder?: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const resourcePath = app.isPackaged
        ? path.join(process.resourcesPath, 'pdf-export')
        : path.join(app.getAppPath(), 'resources', 'pdf-export');
      return await exportToPdf(markdownPath, pdfPath, resourcePath, sourceFolder);
    } catch (error) {
      logger.error('Error launching PDF export:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  });

  ipcMain.handle('run-shell-script', async (_event, filePath: string): Promise<{ success: boolean; error?: string }> => {
    try {
      return await runShellScript(filePath);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Ask AI: submit a prompt and write the response to A/AI.md (or AI1.md, etc.)
  ipcMain.handle('ask-ai', async (
    _event,
    prompt: string,
    parentFolderPath: string
  ) => {
    // Build streaming callbacks that forward to the main renderer window
    const abortController = new AbortController();
    let callbacks: StreamCallbacks | null = null;

    // notice that we don't do AI response streaming when we have a scripted answer because that means we're 
    // running inside the context of a playwright test, and we just capture screenshots for playwright, 
    // so we don't need any real time screen updates 
    if (ENABLE_STREAM_RESPONSE && !hasScriptedAnswer()) {
      // Signal the renderer immediately (before the model warms up) so the
      // streaming dialog can appear right away in its "pending" state. This is
      // skipped for scripted (test) answers so the dialog never shows there.
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-stream-start');
      }
      callbacks = {
        onChunk: (token: string) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-stream-chunk', token);
          }
        },
        onThinkingChunk: (token: string) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-stream-thinking', token);
          }
        },
        onToolCall: (toolName: string, summary: string) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-stream-tool', toolName, summary);
          }
        },
      };
    }

    // Listen for cancel request from the renderer
    const cancelHandler = () => { abortController.abort(); };
    ipcMain.once('ai-stream-cancel', cancelHandler);

    try {
      return await handleAskAI(
        prompt,
        parentFolderPath,
        callbacks,
        abortController.signal,
        () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-stream-done');
          }
        },
        (err) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-stream-error', friendlyAIError(err));
          }
        },
      );
    } catch (error) {
      logger.error('Error in ask-ai handler:', error);
      return { error: friendlyAIError(error) };
    } finally {
      ipcMain.removeListener('ai-stream-cancel', cancelHandler);
    }
  });

  // Build the streaming plumbing shared by both rewrite handlers: an
  // AbortController wired to the renderer's cancel request, plus stream
  // callbacks that forward tokens to the StreamingDialog. Returns null
  // callbacks for scripted (test) answers so no stream events fire there.
  const setupRewriteStreaming = () => {
    const abortController = new AbortController();
    let callbacks: StreamCallbacks | null = null;

    if (ENABLE_STREAM_RESPONSE && !hasScriptedAnswer()) {
      // Signal the renderer immediately so the dialog appears in its "pending"
      // state during model warm-up, before the first token arrives.
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-stream-start');
      }
      callbacks = {
        onChunk: (token: string) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-stream-chunk', token);
          }
        },
        onThinkingChunk: (token: string) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-stream-thinking', token);
          }
        },
        onToolCall: (toolName: string, summary: string) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-stream-tool', toolName, summary);
          }
        },
      };
    }

    const cancelHandler = () => { abortController.abort(); };
    ipcMain.once('ai-stream-cancel', cancelHandler);

    const onStreamDone = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-stream-done');
      }
    };
    const onStreamError = (err: unknown) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-stream-error', friendlyAIError(err));
      }
    };
    const cleanup = () => { ipcMain.removeListener('ai-stream-cancel', cancelHandler); };

    return { abortController, callbacks, onStreamDone, onStreamError, cleanup };
  };

  // Rewrite content via AI: takes raw text, returns improved version
  ipcMain.handle('rewrite-content', async (_event, content: string, filePath: string, hasIndexFile: boolean) => {
    const { abortController, callbacks, onStreamDone, onStreamError, cleanup } = setupRewriteStreaming();
    try {
      return await handleRewriteContent(content, filePath, hasIndexFile, callbacks, abortController.signal, onStreamDone, onStreamError);
    } catch (error) {
      logger.error('Error in rewrite-content handler:', error);
      return { error: friendlyAIError(error) };
    } finally {
      cleanup();
    }
  });

  // Rewrite a selected region of content via AI
  ipcMain.handle('rewrite-content-selection', async (_event, content: string, selectionFrom: number, selectionTo: number, filePath: string, hasIndexFile: boolean) => {
    const { abortController, callbacks, onStreamDone, onStreamError, cleanup } = setupRewriteStreaming();
    try {
      return await handleRewriteContentSection(content, selectionFrom, selectionTo, filePath, hasIndexFile, callbacks, abortController.signal, onStreamDone, onStreamError);
    } catch (error) {
      logger.error('Error in rewrite-content-selection handler:', error);
      return { error: friendlyAIError(error) };
    } finally {
      cleanup();
    }
  });

  // Queue a scripted AI answer for Playwright demo tests
  ipcMain.handle('queue-scripted-answer', (_event, answer: string) => {
    queueScriptedAnswer(answer);
  });

  // Get AI usage statistics
  ipcMain.handle('get-ai-usage', async () => {
    return getUsageWithCosts();
  });

  // Reset AI usage statistics
  ipcMain.handle('reset-ai-usage', async () => {
    await resetUsage();
  });

  // llama.cpp server lifecycle — health check, start, stop
  ipcMain.handle('check-llama-health', async (): Promise<string> => {
    return checkHealth();
  });

  ipcMain.handle('start-llama-server', async (): Promise<{ success: boolean; error?: string }> => {
    try {
      await ensureRunning();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('stop-llama-server', async (): Promise<{ success: boolean; error?: string }> => {
    try {
      await stopServer();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Reply to AI: create an H subfolder with an empty HUMAN.md for the user to write in
  ipcMain.handle('reply-to-ai', async (_event, parentFolderPath: string, createSubFolder: boolean) => {
    try {
      return await handleReplyToAI(parentFolderPath, createSubFolder);
    } catch (error) {
      logger.error('Error in reply-to-ai handler:', error);
      return { error: friendlyAIError(error) };
    }
  });

  // Gather AI conversation thread entries for the ThreadView.
  ipcMain.handle('gather-thread-entries', async (_event, folderPath: string) => {
    return gatherThreadEntries(folderPath);
  });

  ipcMain.handle('run-ocr-in-terminal', async (_event, ocrToolsFolder: string, targets: OcrTarget[]): Promise<{ success: boolean; error?: string }> => {
    try {
      return await runOcrInTerminal(ocrToolsFolder, targets);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

async function handleCommandLineArgs(): Promise<void> {
  // process.argv structure differs between dev and production:
  // Development: [electron, main.js, ...userArgs] - use slice(2)
  // Production:  [executable, ...userArgs] - use slice(1)
  //
  // In packaged apps, app.isPackaged is true and there's no separate main.js argument

  // Debug: log all arguments received
  logger.log('=== Command Line Arguments Debug ===');
  logger.log('Full process.argv:', process.argv);
  logger.log('app.isPackaged:', app.isPackaged);

  // In packaged apps, user args start at index 1; in dev mode, they start at index 2
  const args = app.isPackaged ? process.argv.slice(1) : process.argv.slice(2);
  logger.log('User args:', args);

  // Filter out flags and electron-specific arguments, find first path-like argument
  const folderPath = args.find(arg => !arg.startsWith('-') && arg !== '.');
  logger.log('Detected folder path:', folderPath ?? '(none)');

  if (folderPath) {
    try {
      const stat = await fs.promises.stat(folderPath);
      if (stat.isDirectory()) {
        // Resolve to absolute path
        const absolutePath = path.resolve(folderPath);

        // Update in-memory config and persist to disk
        await updateConfig({ browseFolder: absolutePath, curSubFolder: undefined });

        logger.log(`Opening folder from command line: ${absolutePath}`);
      } else {
        logger.warn(`Command-line argument is not a directory: ${folderPath}`);
      }
    } catch (_error) {
      logger.warn(`Command-line folder does not exist: ${folderPath}`);
    }
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  void (async () => {
    try {
      setupLocalFileProtocol();
      await initConfig();    // Read config file once — all later access is in-memory
      setupIpcHandlers();
      await handleCommandLineArgs();
      createWindow();
      // Remove the default Electron menu bar entirely — all menus are now HTML popup menus
      Menu.setApplicationMenu(null);
    } catch (err) {
      logger.error('Failed to initialize app on ready:', err);
    }
  })();
});

// Flush any in-flight/queued config write before the process exits, so the
// last settings change can't be lost to an async write still in progress at
// quit time. We preventDefault once, await the flush, then re-quit; the guard
// makes the second pass a no-op so the quit proceeds.
let isQuitting = false;
app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  void flushConfig().finally(() => app.quit());
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  void (async () => {
    try {
      await stopCalendarWatcher();
    } catch (err) {
      logger.error('Failed to stop calendar watcher:', err);
    }
    if (process.platform !== 'darwin') {
      app.quit();
    }
  })();
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
