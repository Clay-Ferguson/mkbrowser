import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import * as yaml from 'js-yaml';
import started from 'electron-squirrel-startup';
import { fdir } from 'fdir';
import { stripOrdinalPrefix, formatOrdinalPrefix, calculateRenameOperations, type RenameOperation } from './utils/ordinals';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Register custom protocol for serving local files (must be done before app ready)
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
]);

// Config file location (Linux standard: ~/.config/mk-browser/config.yaml)
const CONFIG_DIR = path.join(app.getPath('home'), '.config', 'mk-browser');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

// Command-line override for browse folder (takes precedence over config file)
let commandLineFolder: string | null = null;

type FontSize = 'small' | 'medium' | 'large';
type SortOrder = 'alphabetical' | 'created-chron' | 'created-reverse' | 'modified-chron' | 'modified-reverse';

interface AppSettings {
  fontSize: FontSize;
  sortOrder: SortOrder;
  foldersOnTop: boolean;
}

interface AppConfig {
  browseFolder: string;
  settings?: AppSettings;
}

const defaultSettings: AppSettings = {
  fontSize: 'medium',
  sortOrder: 'alphabetical',
  foldersOnTop: true,
};

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig(): AppConfig {
  ensureConfigDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const config = yaml.load(content) as AppConfig;
      if (config) {
        // Ensure settings has defaults merged in
        return {
          ...config,
          settings: { ...defaultSettings, ...config.settings },
        };
      }
    }
  } catch {
    // If config is corrupted, return default
  }
  return { browseFolder: '', settings: defaultSettings };
}

function saveConfig(config: AppConfig): void {
  ensureConfigDir();
  const content = yaml.dump(config);
  fs.writeFileSync(CONFIG_FILE, content, 'utf-8');
}

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

// Search result type
interface SearchResult {
  path: string;
  relativePath: string;
  matchCount: number;
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
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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

async function openFolderFromMenu(): Promise<void> {
  if (!mainWindow) return;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select a folder to browse',
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0];

    // Command-line override should not block menu-based selection
    commandLineFolder = null;

    const config = loadConfig();
    config.browseFolder = folderPath;
    saveConfig(config);

    mainWindow.webContents.send('folder-selected', folderPath);
  }
}

function setupApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: 'File',
    submenu: [
      {
        label: 'Open Folder',
        accelerator: 'CmdOrCtrl+O',
        click: () => {
          void openFolderFromMenu();
        },
      },
      { type: 'separator' },
      { role: process.platform === 'darwin' ? 'close' : 'quit' },
    ],
  });

  template.push({
    label: 'Edit',
    submenu: [
      {
        label: 'Cut',
        click: () => {
          mainWindow?.webContents.send('cut-items');
        },
      },
      {
        label: 'Paste',
        accelerator: 'CmdOrCtrl+V',
        click: () => {
          mainWindow?.webContents.send('paste-items');
        },
      },
      { type: 'separator' },
      {
        label: 'Delete',
        accelerator: 'Delete',
        click: () => {
          mainWindow?.webContents.send('delete-items');
        },
      },
    ],
  });

  template.push({
    label: 'Page',
    submenu: [
      {
        label: 'Browser',
        accelerator: 'CmdOrCtrl+1',
        click: () => {
          mainWindow?.webContents.send('view-changed', 'browser');
        },
      },
      {
        label: 'Search Results',
        accelerator: 'CmdOrCtrl+2',
        click: () => {
          mainWindow?.webContents.send('view-changed', 'search-results');
        },
      },
      {
        label: 'Settings',
        accelerator: 'CmdOrCtrl+,',
        click: () => {
          mainWindow?.webContents.send('view-changed', 'settings');
        },
      },
    ],
  });

  template.push({
    label: 'Tools',
    submenu: [
      {
        label: 'Re-Number Files',
        click: () => {
          mainWindow?.webContents.send('renumber-files');
        },
      },
    ],
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC Handlers
function setupIpcHandlers(): void {
  // Get the configured browse folder (command-line override takes precedence)
  ipcMain.handle('get-config', (): AppConfig => {
    const config = loadConfig();
    if (commandLineFolder) {
      config.browseFolder = commandLineFolder;
    }
    return config;
  });

  // Save configuration
  ipcMain.handle('save-config', (_event, config: AppConfig): void => {
    saveConfig(config);
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
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const fileEntries: FileEntry[] = [];

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
    } catch (error) {
      console.error('Error reading directory:', error);
      return [];
    }
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
  ipcMain.handle('create-folder', async (_event, folderPath: string): Promise<boolean> => {
    try {
      await fs.promises.mkdir(folderPath);
      return true;
    } catch (error) {
      console.error('Error creating folder:', error);
      return false;
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

  ipcMain.handle('search-folder', async (_event, folderPath: string, query: string, isAdvanced = false, searchMode: 'content' | 'filenames' = 'content'): Promise<SearchResult[]> => {
    try {
      console.log(`\n=== Search Started ===`);
      console.log(`Folder: ${folderPath}`);
      console.log(`Query: "${query}"`);
      console.log(`Advanced mode: ${isAdvanced}`);
      console.log(`Search mode: ${searchMode}`);

      const results: SearchResult[] = [];
      
      // Create the predicate function based on search mode
      const createMatchPredicate = (queryStr: string, advancedMode: boolean): (content: string) => { matches: boolean; matchCount: number } => {
        if (advancedMode) {
          // Advanced mode: evaluate user's JavaScript expression
          // Create a '$' function that will be injected into the expression's scope
          return (content: string) => {
            const contentLower = content.toLowerCase();
            let matchCount = 0;
            
            // The '$' function checks if content contains the given text (case-insensitive)
            // and increments matchCount for each call that returns true
            const $ = (searchText: string): boolean => {
              const searchLower = searchText.toLowerCase();
              const found = contentLower.includes(searchLower);
              if (found) {
                // Count occurrences for matchCount
                let count = 0;
                let idx = 0;
                while ((idx = contentLower.indexOf(searchLower, idx)) !== -1) {
                  count++;
                  idx += searchLower.length;
                }
                matchCount += count;
                return true;
              }
              return false;
            };
            
            try {
              // Create a function that evaluates the user's expression with '$' in scope
              const expressionCode = `return (${queryStr});`;
              const evalFunction = new Function('$', expressionCode);
              const rawResult = evalFunction($);
              const matches = Boolean(rawResult);
              return { matches, matchCount: matches ? Math.max(matchCount, 1) : 0 };
            } catch (evalError) {
              console.warn(`[DEBUG] Error evaluating expression: ${evalError}`);
              return { matches: false, matchCount: 0 };
            }
          };
        } else {
          // Simple mode: case-insensitive text search
          const queryLower = queryStr.toLowerCase();
          return (content: string) => {
            const contentLower = content.toLowerCase();
            let matchCount = 0;
            let searchIndex = 0;
            while ((searchIndex = contentLower.indexOf(queryLower, searchIndex)) !== -1) {
              matchCount++;
              searchIndex += queryLower.length;
            }
            return { matches: matchCount > 0, matchCount };
          };
        }
      };

      const matchPredicate = createMatchPredicate(query, isAdvanced);

      if (searchMode === 'filenames') {
        // Search file and folder names - crawl all entries (files AND directories)
        const filesApi = new fdir()
          .withFullPaths()
          .crawl(folderPath);

        const dirsApi = new fdir()
          .withFullPaths()
          .onlyDirs()
          .crawl(folderPath);

        const [files, dirs] = await Promise.all([
          filesApi.withPromise(),
          dirsApi.withPromise()
        ]);

        // Combine files and directories (excluding the root folder itself)
        const allEntries = [...files, ...dirs.filter(d => d !== folderPath)];
        console.log(`Found ${allEntries.length} entries (files + folders) to search`);

        for (const entryPath of allEntries) {
          // Get just the filename/foldername (not the full path)
          const entryName = path.basename(entryPath);
          const { matches, matchCount } = matchPredicate(entryName);

          if (matches) {
            // Get relative path for cleaner display
            const relativePath = path.relative(folderPath, entryPath);
            results.push({
              path: entryPath,
              relativePath,
              matchCount,
            });
          }
        }
      } else {
        // Search file contents - only .md and .txt files
        const api = new fdir()
          .withFullPaths()
          .filter((filePath) => {
            const ext = path.extname(filePath).toLowerCase();
            return ext === '.md' || ext === '.txt';
          })
          .crawl(folderPath);

        const files = await api.withPromise();
        console.log(`Found ${files.length} .md/.txt files to search`);

        for (const filePath of files) {
          try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const { matches, matchCount } = matchPredicate(content);

            if (matches) {
              // Get relative path for cleaner display
              const relativePath = path.relative(folderPath, filePath);
              results.push({
                path: filePath,
                relativePath,
                matchCount,
              });
            }
          } catch (readError) {
            // Skip files that can't be read
            console.warn(`Could not read file: ${filePath}`);
          }
        }
      }

      // Sort by match count (descending)
      results.sort((a, b) => b.matchCount - a.matchCount);

      console.log(`\n=== Search Results ===`);
      console.log(`Total files with matches: ${results.length}`);
      for (const result of results) {
        console.log(`  ${result.relativePath}: ${result.matchCount} match(es)`);
      }
      console.log(`=== Search Complete ===\n`);

      return results;
    } catch (error) {
      console.error('Error searching folder:', error);
      return [];
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

        // Store in memory for immediate use (overrides config file)
        commandLineFolder = absolutePath;

        // Also update and save config file for persistence
        const config = loadConfig();
        config.browseFolder = absolutePath;
        saveConfig(config);

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
  setupIpcHandlers();
  await handleCommandLineArgs();
  createWindow();
  setupApplicationMenu();
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
