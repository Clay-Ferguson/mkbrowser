import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, shell, nativeImage, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import * as yaml from 'js-yaml';
import started from 'electron-squirrel-startup';
import { calculateRenameOperations, type RenameOperation } from './utils/ordinals';
import { searchAndReplace, type ReplaceResult } from './searchAndReplace';
import { searchFolder, type SearchResult } from './search';
import { analyzeFolderHashtags, type FolderAnalysisResult } from './folderAnalysis';
import { HASHTAG_REGEX } from './utils/hashtagRegex';

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

type FontSize = 'small' | 'medium' | 'large' | 'xlarge';
type SortOrder = 'alphabetical' | 'created-chron' | 'created-reverse' | 'modified-chron' | 'modified-reverse';
type ContentWidth = 'narrow' | 'medium' | 'wide' | 'full';
type SearchMode = 'content' | 'filenames';
type SearchType = 'literal' | 'wildcard' | 'advanced';
type SearchBlock = 'entire-file' | 'file-lines';

interface SearchDefinition {
  name: string;
  searchText: string;
  searchTarget: SearchMode;
  searchMode: SearchType;
  searchBlock: SearchBlock;
}

interface AppSettings {
  fontSize: FontSize;
  sortOrder: SortOrder;
  foldersOnTop: boolean;
  ignoredPaths: string;
  searchDefinitions: SearchDefinition[];
  contentWidth: ContentWidth;
  bookmarks: string[];
}

interface AppConfig {
  browseFolder: string;
  settings?: AppSettings;
}

const defaultSettings: AppSettings = {
  fontSize: 'medium',
  sortOrder: 'alphabetical',
  foldersOnTop: true,
  ignoredPaths: '',
  searchDefinitions: [],
  contentWidth: 'medium',
  bookmarks: [],
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

    // Rebuild menu to update bookmark filtering based on new browse folder
    setupApplicationMenu();

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
        label: 'Undo Cut',
        click: () => {
          mainWindow?.webContents.send('undo-cut');
        },
      },
      { type: 'separator' },
      {
        label: 'Select All',
        accelerator: 'CmdOrCtrl+A',
        click: () => {
          mainWindow?.webContents.send('select-all-items');
        },
      },
      {
        label: 'Unselect All',
        accelerator: 'CmdOrCtrl+Shift+A',
        click: () => {
          mainWindow?.webContents.send('unselect-all-items');
        },
      },
      { type: 'separator' },
      {
        label: 'Move to Folder',
        click: () => {
          mainWindow?.webContents.send('move-to-folder');
        },
      },
      { type: 'separator' },
      {
        label: 'Split',
        click: () => {
          mainWindow?.webContents.send('split-file');
        },
      },
      {
        label: 'Join',
        click: () => {
          mainWindow?.webContents.send('join-files');
        },
      },
      { type: 'separator' },
      {
        label: 'Replace in Files',
        click: () => {
          mainWindow?.webContents.send('replace-in-files');
        },
      },
    ],
  });

  // Add Search menu if there are saved search definitions
  const config = loadConfig();
  const searchDefinitions = config.settings?.searchDefinitions || [];
  if (searchDefinitions.length > 0) {
    // Sort search definitions alphabetically by name
    const sortedDefinitions = [...searchDefinitions].sort((a, b) => 
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    template.push({
      label: 'Search',
      submenu: sortedDefinitions.map((def) => ({
        label: def.name,
        click: (_menuItem, _browserWindow, event) => {
          // Ctrl+click opens the search dialog for editing; regular click executes immediately
          if (event.ctrlKey) {
            mainWindow?.webContents.send('edit-search-definition', def);
          } else {
            mainWindow?.webContents.send('open-search-definition', def);
          }
        },
      })),
    });
  }

  // Add Bookmark menu if there are bookmarks under the current browse folder
  const allBookmarks = config.settings?.bookmarks || [];
  const browseFolder = commandLineFolder || config.browseFolder;
  // Filter to only show bookmarks that are under the application's base browse folder
  const bookmarks = browseFolder
    ? allBookmarks.filter(bookmark => 
        bookmark === browseFolder || bookmark.startsWith(browseFolder + path.sep)
      )
    : allBookmarks;
  if (bookmarks.length > 0) {
    // Sort bookmarks alphabetically by their display name (file/folder name only)
    const sortedBookmarks = [...bookmarks].sort((a, b) => {
      const nameA = a.substring(a.lastIndexOf('/') + 1);
      const nameB = b.substring(b.lastIndexOf('/') + 1);
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });

    template.push({
      label: 'Bookmark',
      submenu: sortedBookmarks.map((fullPath) => {
        const displayName = fullPath.substring(fullPath.lastIndexOf('/') + 1);
        return {
          label: displayName,
          click: () => {
            mainWindow?.webContents.send('open-bookmark', fullPath);
          },
        };
      }),
    });
  }

  template.push({
    label: 'Tools',
    submenu: [
      {
        label: 'Folder Analysis',
        click: () => {
          mainWindow?.webContents.send('folder-analysis-requested');
        },
      },
      { type: 'separator' },
      {
        label: 'Re-Number Files',
        click: () => {
          mainWindow?.webContents.send('renumber-files');
        },
      },
      { type: 'separator' },
      {
        label: 'Export...',
        click: () => {
          mainWindow?.webContents.send('export-requested');
        },
      },
    ],
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC Handlers
function setupIpcHandlers(): void {
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
    // Rebuild menu to update search definitions
    setupApplicationMenu();
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
      // Load ignored paths from config
      const config = loadConfig();
      const ignoredPathsRaw = config.settings?.ignoredPaths ?? '';
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
      // Load ignored paths from config
      const config = loadConfig();
      const ignoredPathsRaw = config.settings?.ignoredPaths ?? '';
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
      // Load ignored paths from config
      const config = loadConfig();
      const ignoredPathsRaw = config.settings?.ignoredPaths ?? '';
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
      // Helper function to get text files from a single directory (sorted alphabetically)
      const getTextFilesFromDir = async (dirPath: string): Promise<Array<{ name: string; path: string }>> => {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        const textFiles: Array<{ name: string; path: string }> = [];
        
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          if (entry.isDirectory()) continue;
          
          const lowerName = entry.name.toLowerCase();
          if (lowerName.endsWith('.md') || lowerName.endsWith('.txt')) {
            textFiles.push({
              name: entry.name,
              path: path.join(dirPath, entry.name),
            });
          }
        }
        
        // Sort alphabetically by name
        textFiles.sort((a, b) => a.name.localeCompare(b.name));
        return textFiles;
      };

      // Helper function to get subdirectories (sorted alphabetically)
      const getSubdirs = async (dirPath: string): Promise<Array<{ name: string; path: string }>> => {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        const subdirs: Array<{ name: string; path: string }> = [];
        
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          if (entry.isDirectory()) {
            subdirs.push({
              name: entry.name,
              path: path.join(dirPath, entry.name),
            });
          }
        }
        
        // Sort alphabetically by name
        subdirs.sort((a, b) => a.name.localeCompare(b.name));
        return subdirs;
      };

      // Recursive function to process a folder and its subfolders
      const processFolder = async (folderPath: string, relativePath: string): Promise<string[]> => {
        const parts: string[] = [];
        
        // Get and process files in this folder (sorted alphabetically)
        const textFiles = await getTextFilesFromDir(folderPath);
        for (const file of textFiles) {
          const content = await fs.promises.readFile(file.path, 'utf-8');
          if (includeFilenames) {
            const fileLabel = relativePath ? `${relativePath}/${file.name}` : file.name;
            parts.push(`File: ${fileLabel}\n\n${content}`);
          } else {
            parts.push(content);
          }
        }
        
        // If including subfolders, recursively process them (sorted alphabetically)
        if (includeSubfolders) {
          const subdirs = await getSubdirs(folderPath);
          for (const subdir of subdirs) {
            const subRelativePath = relativePath ? `${relativePath}/${subdir.name}` : subdir.name;
            const subParts = await processFolder(subdir.path, subRelativePath);
            parts.push(...subParts);
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
    pdfPath: string
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
      
      // Spawn the terminal with the script
      const child = spawn(terminalCmd, [...terminalArgs, scriptPath, markdownPath, pdfPath], {
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
