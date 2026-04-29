import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell, nativeImage } from 'electron';
import path from 'node:path'; 
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { initConfig, getConfig, setConfig, updateConfig } from './configMgr';
import type { AppConfig } from './configMgr';

import { readDirectory, parseFrontMatter } from './utils/fileUtils';
import { reconcileIndexedFiles, insertIntoIndexYaml, moveInIndexYaml, moveToEdgeInIndexYaml, readIndexYaml, writeIndexOptions } from './utils/indexUtil';
import { frontMatterFileSaved } from './utils/frontMatterHandler';
import { processTOC } from './utils/tocUtils';
import { searchAndReplace, type ReplaceResult } from './searchAndReplace';
import { parseIgnoredPaths, buildIgnoredPatterns } from './utils/searchUtil';
import { searchFolder, type SearchResult } from './search';
import { analyzeFolderHashtags, type FolderAnalysisResult } from './folderAnalysis';
import { collectAncestorTags } from './utils/tagUtils';
import { handleAskAI, handleRewriteContent, handleRewriteContentSection, handleReplyToAI, gatherThreadEntries, friendlyAIError } from './ai/aiUtil';
import { queueScriptedAnswer } from './ai/langGraph';
import type { StreamCallbacks } from './ai/langGraph';
import { getUsageWithCosts, resetUsage } from './ai/usageTracker';
import { checkHealth, ensureRunning, stopServer } from './llamaServer';
import { readExifMetadata, writeExifMetadata } from './utils/exifUtil';
  // Write EXIF metadata to an image file
  ipcMain.handle('write-exif', async (_event, filePath: string, data: Record<string, Record<string, string>>): Promise<boolean> => {
    try {
      return await writeExifMetadata(filePath, data);
    } catch (error) {
      console.error('Error writing EXIF data:', error);
      return false;
    }
  });
import { exportFolderContents, exportToPdf } from './utils/exportUtils';

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
  
  console.log('Icon path:', iconPath, 'Exists:', fs.existsSync(iconPath));
  const icon = nativeImage.createFromPath(iconPath);
  console.log('Icon isEmpty:', icon.isEmpty());

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

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
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
  ipcMain.handle('get-config', (): AppConfig => {
    return getConfig();
  });

  // Save configuration — updates in-memory state and flushes to disk
  ipcMain.handle('save-config', (_event, config: AppConfig): void => {
    setConfig(config);
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
      console.error('Error reading file:', error);
      return '';
    }
  });

  // Read EXIF metadata from an image file
  ipcMain.handle('read-exif', async (_event, filePath: string): Promise<Record<string, Record<string, string>>> => {
    try {
      return await readExifMetadata(filePath);
    } catch (error) {
      console.error('Error reading EXIF data:', error);
      return {};
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

      if (filePath.toLowerCase().endsWith('.md')) {
        finalContent = await processTOC(content);
      }

      await fs.promises.writeFile(filePath, finalContent, 'utf-8');

      // Post-save: run front-matter autogen for Markdown files
      if (filePath.toLowerCase().endsWith('.md')) {
        const { yaml: frontMatter, content: body } = parseFrontMatter(finalContent);
        if (frontMatter) {
          frontMatterFileSaved(filePath, frontMatter, body).catch(() => {
            // errors already logged inside frontMatterFileSaved
          });
        }
      }

      return { ok: true, content: finalContent };
    } catch (error) {
      console.error('Error writing file:', error);
      return { ok: false, content };
    }
  });

  // Get file size in bytes
  ipcMain.handle('get-file-size', async (_event, filePath: string): Promise<number> => {
    try {
      const stats = await fs.promises.stat(filePath);
      return stats.size;
    } catch (error) {
      console.error('Error getting file size:', error);
      return -1;
    }
  });

  // Get file last-modified time (mtimeMs) so the renderer can detect external changes
  ipcMain.handle('get-file-mtime', async (_event, filePath: string): Promise<number> => {
    try {
      const stats = await fs.promises.stat(filePath);
      return stats.mtimeMs;
    } catch (error) {
      console.error('Error getting file mtime:', error);
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
      console.error('Error writing binary file:', error);
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
    } catch (error: any) {
      console.error('Error creating file:', error);
      let errorMessage = 'Failed to create file';
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        errorMessage = 'Permission denied';
      } else if (error.message) {
        errorMessage = error.message;
      }
      return { success: false, error: errorMessage };
    }
  });

  // Rename a file or folder
  ipcMain.handle('rename-file', async (_event, oldPath: string, newPath: string): Promise<boolean> => {
    try {
      await fs.promises.rename(oldPath, newPath);
      return true;
    } catch (error) {
      console.error('Error renaming file:', error);
      return false;
    }
  });

  // Delete a file or folder (moves to OS trash)
  ipcMain.handle('delete-file', async (_event, filePath: string): Promise<boolean> => {
    try {
      await shell.trashItem(filePath);
      return true;
    } catch (error) {
      console.error('Error moving to trash:', error);
      return false;
    }
  });

  // Create a new folder
  ipcMain.handle('create-folder', async (_event, folderPath: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await fs.promises.mkdir(folderPath);
      return { success: true };
    } catch (error: any) {
      console.error('Error creating folder:', error);
      let errorMessage = 'Failed to create folder';
      if (error.code === 'EEXIST') {
        errorMessage = 'A file/folder with this name already exists';
      } else if (error.code === 'EACCES' || error.code === 'EPERM') {
        errorMessage = 'Permission denied';
      } else if (error.message) {
        errorMessage = error.message;
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
  ipcMain.handle('reconcile-indexed-files', async (_event, dirPath: string, createIfMissing = false): Promise<void> => {
    await reconcileIndexedFiles(dirPath, createIfMissing);
  });

  // Read .INDEX.yaml for a directory
  ipcMain.handle('read-index-yaml', async (_event, dirPath: string) => {
    return readIndexYaml(dirPath);
  });

  // Write options section of .INDEX.yaml
  ipcMain.handle('write-index-options', async (_event, dirPath: string, options: { edit_mode?: boolean }): Promise<{ success: boolean; error?: string }> => {
    return writeIndexOptions(dirPath, options);
  });

  // Search and replace in files recursively
  ipcMain.handle('search-and-replace', async (_event, folderPath: string, searchText: string, replaceText: string): Promise<ReplaceResult[]> => {
    try {
      const ignoredPatterns = buildIgnoredPatterns(parseIgnoredPaths(getConfig().settings?.ignoredPaths ?? ''));
      return await searchAndReplace(folderPath, searchText, replaceText, ignoredPatterns);
    } catch (error) {
      console.error('Error in search and replace:', error);
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

  ipcMain.handle('search-folder', async (_event, folderPath: string, query: string, searchType: 'literal' | 'wildcard' | 'advanced' = 'literal', searchMode: 'content' | 'filenames' = 'content', searchBlock: 'entire-file' | 'file-lines' = 'entire-file', searchImageExif = false, mostRecent = false): Promise<SearchResult[]> => {
    try {
      const ignoredPaths = parseIgnoredPaths(getConfig().settings?.ignoredPaths ?? '');
      return await searchFolder(folderPath, query, searchType, searchMode, searchBlock, ignoredPaths, searchImageExif, mostRecent);
    } catch (error) {
      console.error('Error searching folder:', error);
      return [];
    }
  });

  // Analyze folder for hashtags in .md and .txt files
  ipcMain.handle('analyze-folder-hashtags', async (_event, folderPath: string): Promise<FolderAnalysisResult> => {
    try {
      const ignoredPaths = parseIgnoredPaths(getConfig().settings?.ignoredPaths ?? '');
      return await analyzeFolderHashtags(folderPath, ignoredPaths);
    } catch (error) {
      console.error('Error analyzing folder:', error);
      return { hashtags: [], totalFiles: 0 };
    }
  });

  // Collect tags by walking up ancestor directories reading .TAGS.yaml files
  ipcMain.handle('collect-ancestor-tags', async (_event, filePath: string): Promise<import('./utils/tagUtils').HashtagDefinition[]> => {
    try {
      return await collectAncestorTags(filePath);
    } catch (error) {
      console.error('Error collecting ancestor tags:', error);
      return [];
    }
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
      console.error('Error exporting folder contents:', error);
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
      console.error('Error launching PDF export:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
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

    if (ENABLE_STREAM_RESPONSE) {
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
      console.error('Error in ask-ai handler:', error);
      return { error: friendlyAIError(error) };
    } finally {
      ipcMain.removeListener('ai-stream-cancel', cancelHandler);
    }
  });

  // Rewrite content via AI: takes raw text, returns improved version
  ipcMain.handle('rewrite-content', async (_event, content: string, filePath: string, hasIndexFile: boolean) => {
    try {
      return await handleRewriteContent(content, filePath, hasIndexFile);
    } catch (error) {
      console.error('Error in rewrite-content handler:', error);
      return { error: friendlyAIError(error) };
    }
  });

  // Rewrite a selected region of content via AI
  ipcMain.handle('rewrite-content-selection', async (_event, content: string, selectionFrom: number, selectionTo: number, filePath: string, hasIndexFile: boolean) => {
    try {
      return await handleRewriteContentSection(content, selectionFrom, selectionTo, filePath, hasIndexFile);
    } catch (error) {
      console.error('Error in rewrite-content-selection handler:', error);
      return { error: friendlyAIError(error) };
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
    resetUsage();
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
      console.error('Error in reply-to-ai handler:', error);
      return { error: friendlyAIError(error) };
    }
  });

  // Gather AI conversation thread entries for the ThreadView.
  ipcMain.handle('gather-thread-entries', async (_event, folderPath: string) => {
    return gatherThreadEntries(folderPath);
  });

  ipcMain.handle('run-in-external-terminal', async (_event, command: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { spawn, execSync } = await import('node:child_process');

      const terminals = [
        { cmd: 'x-terminal-emulator', args: ['-e'] },
        { cmd: 'gnome-terminal', args: ['--'] },
        { cmd: 'konsole', args: ['-e'] },
        { cmd: 'xfce4-terminal', args: ['-e'] },
        { cmd: 'xterm', args: ['-e'] },
        { cmd: 'kitty', args: ['--'] },
        { cmd: 'alacritty', args: ['-e'] },
      ];

      let terminalCmd: string | null = null;
      let terminalArgs: string[] = [];

      for (const terminal of terminals) {
        try {
          execSync(`which ${terminal.cmd}`, { stdio: 'ignore' });
          terminalCmd = terminal.cmd;
          terminalArgs = terminal.args;
          break;
        } catch {
          // Terminal not found, try next
        }
      }

      if (!terminalCmd) {
        return { success: false, error: 'No terminal emulator found. Please install gnome-terminal, konsole, xterm, or another terminal emulator.' };
      }

      const child = spawn(terminalCmd, [...terminalArgs, 'bash', '-c', `${command}; exec bash`], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      return { success: true };
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
  console.log('=== Command Line Arguments Debug ===');
  console.log('Full process.argv:', process.argv);
  console.log('app.isPackaged:', app.isPackaged);

  // In packaged apps, user args start at index 1; in dev mode, they start at index 2
  const args = app.isPackaged ? process.argv.slice(1) : process.argv.slice(2);
  console.log('User args:', args);

  // Filter out flags and electron-specific arguments, find first path-like argument
  const folderPath = args.find(arg => !arg.startsWith('-') && arg !== '.');
  console.log('Detected folder path:', folderPath ?? '(none)');

  if (folderPath) {
    try {
      const stat = await fs.promises.stat(folderPath);
      if (stat.isDirectory()) {
        // Resolve to absolute path
        const absolutePath = path.resolve(folderPath);

        // Update in-memory config and persist to disk
        updateConfig({ browseFolder: absolutePath, curSubFolder: undefined });

        console.log(`Opening folder from command line: ${absolutePath}`);
      } else {
        console.warn(`Command-line argument is not a directory: ${folderPath}`);
      }
    } catch (_error) {
      console.warn(`Command-line folder does not exist: ${folderPath}`);
    }
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  setupLocalFileProtocol();
  initConfig();          // Read config file once — all later access is in-memory
  setupIpcHandlers();
  await handleCommandLineArgs();
  createWindow();
  // Remove the default Electron menu bar entirely — all menus are now HTML popup menus
  Menu.setApplicationMenu(null);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
