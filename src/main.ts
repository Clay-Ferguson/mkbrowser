import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import { initConfig, getConfig, setConfig, updateConfig } from './configMgr';
import type { AppConfig } from './configMgr';
import { calculateRenameOperations, type RenameOperation } from './utils/ordinals';
import { trimLeadingWhitespaceFromNames } from './utils/fileUtils';
import { searchAndReplace, type ReplaceResult } from './searchAndReplace';
import { searchFolder, type SearchResult } from './search';
import { analyzeFolderHashtags, type FolderAnalysisResult } from './folderAnalysis';
import { HASHTAG_REGEX } from './utils/hashtagRegex';
import { invokeAI, findNextNumberedFile, findNextNumberedFolder } from './ai/aiUtil';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Register custom protocol for serving local files (must be done before app ready)
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
]);



// File/folder types for the renderer
interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isMarkdown: boolean;
  /** Last modified timestamp in milliseconds since epoch */
  modifiedTime: number;
  /** Created timestamp in milliseconds since epoch */
  createdTime: number;
  content?: string; // Only populated for markdown files
}

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
    // First check if directory exists
    try {
      const dirStat = await fs.promises.stat(dirPath);
      if (!dirStat.isDirectory()) {
        throw new Error(`Path is not a directory: ${dirPath}`);
      }
    } catch {
      // Re-throw with clear message for non-existent paths
      throw new Error(`Directory does not exist: ${dirPath}`);
    }

    // Now read the directory contents
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const fileEntries: FileEntry[] = [];

    // Auto-fix any filenames with leading whitespace by renaming them on disk
    await trimLeadingWhitespaceFromNames(dirPath, entries, path.join, fs.promises);

    for (const entry of entries) {
      // Skip hidden files/folders (starting with .)
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dirPath, entry.name);
      const isDirectory = entry.isDirectory();
      const isMarkdown = !isDirectory && entry.name.toLowerCase().endsWith('.md');

      // Get file stats for modification and creation time
      let modifiedTime = 0;
      let createdTime = 0;
      try {
        const stat = await fs.promises.stat(fullPath);
        modifiedTime = stat.mtimeMs;
        createdTime = stat.birthtimeMs;
      } catch {
        // If stat fails, use current time
        modifiedTime = Date.now();
        createdTime = Date.now();
      }

      const fileEntry: FileEntry = {
        name: entry.name,
        path: fullPath,
        isDirectory,
        isMarkdown,
        modifiedTime,
        createdTime,
      };

      // Note: We no longer read markdown content here.
      // Content will be loaded on-demand with caching in the renderer.

      fileEntries.push(fileEntry);
    }

    // Sort: directories first, then files, alphabetically within each group
    // (The renderer will re-sort based on user's sort preference)
    fileEntries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return fileEntries;
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
  ipcMain.handle('write-file', async (_event, filePath: string, content: string): Promise<boolean> => {
    try {
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return true;
    } catch (error) {
      console.error('Error writing file:', error);
      return false;
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

  // Delete a file or folder
  ipcMain.handle('delete-file', async (_event, filePath: string): Promise<boolean> => {
    try {
      await fs.promises.rm(filePath, { recursive: true });
      return true;
    } catch (error) {
      console.error('Error deleting file:', error);
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

  // Re-number files in a directory with ordinal prefixes
  ipcMain.handle('renumber-files', async (_event, dirPath: string): Promise<{ success: boolean; error?: string; operations?: RenameOperation[] }> => {
    try {
      // Read all entries in the directory
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      
      // Filter out hidden files and create items array
      const items: Array<{ name: string; path: string }> = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        items.push({
          name: entry.name,
          path: path.join(dirPath, entry.name),
        });
      }

      // Sort alphabetically (case-insensitive), mixing files and folders together
      items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

      // Calculate rename operations
      const operations = calculateRenameOperations(items, dirPath);

      if (operations.length === 0) {
        return { success: true, operations: [] };
      }

      // Perform renames - we need to be careful about order to avoid conflicts
      // First, rename to temporary names, then to final names
      const tempSuffix = `_temp_${Date.now()}`;
      
      // Step 1: Rename all to temporary names
      for (const op of operations) {
        const tempPath = op.oldPath + tempSuffix;
        await fs.promises.rename(op.oldPath, tempPath);
      }

      // Step 2: Rename from temporary to final names
      for (const op of operations) {
        const tempPath = op.oldPath + tempSuffix;
        await fs.promises.rename(tempPath, op.newPath);
      }

      return { success: true, operations };
    } catch (error) {
      console.error('Error renumbering files:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      };
    }
  });

  // Search and replace in files recursively
  ipcMain.handle('search-and-replace', async (_event, folderPath: string, searchText: string, replaceText: string): Promise<ReplaceResult[]> => {
    try {
      // Get ignored paths from in-memory config
      const ignoredPathsRaw = getConfig().settings?.ignoredPaths ?? '';
      const ignoredPaths = ignoredPathsRaw
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);
      
      // Convert wildcard patterns to regex
      const ignoredPatterns = ignoredPaths.map(pattern => {
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        const regexPattern = escaped.replace(/\*/g, '.*');
        return new RegExp(`^${regexPattern}$`, 'i');
      });

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
      // Only allow http and https URLs for security
      if (url.startsWith('http://') || url.startsWith('https://')) {
        await shell.openExternal(url);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  });

  ipcMain.handle('search-folder', async (_event, folderPath: string, query: string, searchType: 'literal' | 'wildcard' | 'advanced' = 'literal', searchMode: 'content' | 'filenames' = 'content', searchBlock: 'entire-file' | 'file-lines' = 'entire-file'): Promise<SearchResult[]> => {
    try {
      // Get ignored paths from in-memory config
      const ignoredPathsRaw = getConfig().settings?.ignoredPaths ?? '';
      const ignoredPaths = ignoredPathsRaw
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);

      return await searchFolder(folderPath, query, searchType, searchMode, searchBlock, ignoredPaths);
    } catch (error) {
      console.error('Error searching folder:', error);
      return [];
    }
  });

  // Analyze folder for hashtags in .md and .txt files
  ipcMain.handle('analyze-folder-hashtags', async (_event, folderPath: string): Promise<FolderAnalysisResult> => {
    try {
      // Get ignored paths from in-memory config
      const ignoredPathsRaw = getConfig().settings?.ignoredPaths ?? '';
      const ignoredPaths = ignoredPathsRaw
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);

      return await analyzeFolderHashtags(folderPath, ignoredPaths);
    } catch (error) {
      console.error('Error analyzing folder:', error);
      return { hashtags: [], totalFiles: 0 };
    }
  });

  // Collect tags by walking up ancestor directories reading .TAGS.md files
  ipcMain.handle('collect-ancestor-tags', async (_event, filePath: string): Promise<string[]> => {
    try {
      const seen = new Set<string>();
      const tags: string[] = [];

      // Start from the directory containing the file
      let dir = path.dirname(filePath);
      const root = path.parse(dir).root;

      // Walk up the directory tree
      while (true) {
        const tagsFile = path.join(dir, '.TAGS.md');
        try {
          const content = await fs.promises.readFile(tagsFile, 'utf-8');
          HASHTAG_REGEX.lastIndex = 0;
          let match;
          while ((match = HASHTAG_REGEX.exec(content)) !== null) {
            const tag = match[0];
            if (!seen.has(tag)) {
              seen.add(tag);
              tags.push(tag);
            }
          }
        } catch {
          // .TAGS.md doesn't exist at this level — that's fine, keep walking
        }

        // Stop at filesystem root
        if (dir === root || dir === path.dirname(dir)) break;
        dir = path.dirname(dir);
      }

      // Sort tags alphabetically (case-insensitive)
      tags.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

      return tags;
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
      // Recursive depth-first function: files and subdirs are sorted together in one
      // case-insensitive pass so ordinal prefixes (00010_, 999_, etc.) fully control order.
      const processFolder = async (folderPath: string, relativePath: string): Promise<string[]> => {
        const parts: string[] = [];

        const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });

        // Collect eligible text files and (optionally) subdirs into one list
        const items: Array<{ name: string; entryPath: string; isDir: boolean }> = [];
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const entryPath = path.join(folderPath, entry.name);
          if (entry.isDirectory()) {
            if (includeSubfolders) {
              items.push({ name: entry.name, entryPath, isDir: true });
            }
          } else {
            const lowerName = entry.name.toLowerCase();
            if (lowerName.endsWith('.md') || lowerName.endsWith('.txt')) {
              items.push({ name: entry.name, entryPath, isDir: false });
            }
          }
        }

        // Single case-insensitive sort — files and folders interleaved by name
        items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        for (const item of items) {
          if (item.isDir) {
            const subRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name;
            const subParts = await processFolder(item.entryPath, subRelativePath);
            parts.push(...subParts);
          } else {
            const content = await fs.promises.readFile(item.entryPath, 'utf-8');
            if (includeFilenames) {
              const fileLabel = relativePath ? `${relativePath}/${item.name}` : item.name;
              parts.push(`File: ${fileLabel}\n\n${content}`);
            } else {
              parts.push(content);
            }
          }
        }

        return parts;
      };

      // Process the source folder
      const allParts = await processFolder(sourceFolder, '');

      if (allParts.length === 0) {
        return {
          success: false,
          error: includeSubfolders 
            ? 'No markdown or text files found in the folder or its subfolders.'
            : 'No markdown or text files found in the current folder.',
        };
      }

      const separator = includeDividers ? '\n\n---\n\n' : '\n\n';
      const concatenatedContent = allParts.join(separator);

      // Write the output file
      const outputPath = path.join(outputFolder, outputFileName);
      await fs.promises.writeFile(outputPath, concatenatedContent, 'utf-8');

      return {
        success: true,
        outputPath,
      };
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
      const { spawn } = await import('node:child_process');
      
      // Get the path to the PDF export script
      // In development: app.getAppPath() returns project root
      // In production: resources are in process.resourcesPath
      const resourcePath = app.isPackaged
        ? path.join(process.resourcesPath, 'pdf-export')
        : path.join(app.getAppPath(), 'resources', 'pdf-export');
      
      const scriptPath = path.join(resourcePath, 'generate-pdf.sh'); 
      
      // Check if script exists
      if (!fs.existsSync(scriptPath)) {
        return {
          success: false,
          error: `PDF export script not found at: ${scriptPath}`,
        };
      }
      
      // Try common Linux terminal emulators in order of preference
      const terminals = [
        { cmd: 'x-terminal-emulator', args: ['-e'] },
        { cmd: 'gnome-terminal', args: ['--'] },
        { cmd: 'konsole', args: ['-e'] },
        { cmd: 'xfce4-terminal', args: ['-e'] },
        { cmd: 'xterm', args: ['-e'] },
        { cmd: 'kitty', args: ['--'] },
        { cmd: 'alacritty', args: ['-e'] },
      ];
      
      // Find the first available terminal
      let terminalCmd: string | null = null;
      let terminalArgs: string[] = [];
      
      for (const terminal of terminals) {
        try {
          const { execSync } = await import('node:child_process');
          execSync(`which ${terminal.cmd}`, { stdio: 'ignore' });
          terminalCmd = terminal.cmd;
          terminalArgs = terminal.args;
          break;
        } catch {
          // Terminal not found, try next
        }
      }
      
      if (!terminalCmd) {
        return {
          success: false,
          error: 'No terminal emulator found. Please install gnome-terminal, konsole, xterm, or another terminal emulator.',
        };
      }
      
      // Check if a glossary file exists anywhere under the source folder (recursive)
      let glossaryPath: string | undefined;
      if (sourceFolder) {
        const { fdir } = await import('fdir');
        const matches = await new fdir()
          .withFullPaths()
          .filter((f) => path.basename(f).endsWith('Glossary_of_Terms.md'))
          .crawl(sourceFolder)
          .withPromise();
        if (matches.length > 0) {
          glossaryPath = matches[0];
        }
      }

      // Spawn the terminal with the script (optional glossary path as $3)
      const scriptArgs = glossaryPath
        ? [...terminalArgs, scriptPath, markdownPath, pdfPath, glossaryPath]
        : [...terminalArgs, scriptPath, markdownPath, pdfPath];
      const child = spawn(terminalCmd, scriptArgs, {
        detached: true,
        stdio: 'ignore',
      });
      
      // Detach the process so it doesn't block the app
      child.unref();
      
      return { success: true };
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
  ): Promise<{ outputPath: string; responseFolder: string } | { error: string }> => {
    try {
      // Find the next available response folder: A/, A1/, A2/, ...
      const responseFolder = await findNextNumberedFolder(parentFolderPath, 'A');

      // Create the response folder
      await fs.promises.mkdir(responseFolder, { recursive: true });

      // Response always goes into AI.md inside the numbered folder
      const outputPath = path.join(responseFolder, 'AI.md');

      // Invoke the AI
      const response = await invokeAI(prompt);

      // Write the response
      await fs.promises.writeFile(outputPath, response, 'utf-8');

      return { outputPath, responseFolder };
    } catch (error) {
      console.error('Error in ask-ai handler:', error);
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

// Handle command-line arguments to set initial browse folder
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
    } catch (error) {
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
