import { setSettings, setCurrentPath, setCalendarViewType } from './store';

export interface LoadConfigResult {
  rootPath: string | null;
  loaded: boolean;
  error: string | null;
  lastExportFolder: string;
  aiEnabled: boolean;
  recentFolders: string[];
}

/**
 * Load initial configuration from the main process.
 * Sets up settings and validates the browse folder path.
 */
export async function loadConfig(): Promise<LoadConfigResult> {
  try {
    const config = await window.electronAPI.getConfig();
    // Load settings from config into store (only once at startup)
    if (config.settings) {
      setSettings({ indexTreeWidth: 'narrow', showPropsInEditor: true, ...config.settings });
    }
    if (config.calendarViewType) {
      setCalendarViewType(config.calendarViewType);
    }
    if (config.browseFolder) {
      const exists = await window.electronAPI.pathExists(config.browseFolder);
      if (exists) {
        // If a saved subfolder exists and is valid, start there instead of the root
        let initialPath = config.browseFolder;
        if (config.curSubFolder && config.curSubFolder.startsWith(config.browseFolder)) {
          const subExists = await window.electronAPI.pathExists(config.curSubFolder);
          if (subExists) {
            initialPath = config.curSubFolder;
          }
        }
        setCurrentPath(initialPath);
        return { rootPath: config.browseFolder, loaded: true, error: null, lastExportFolder: config.lastExportFolder ?? '', aiEnabled: !!config.aiEnabled, recentFolders: config.recentFolders ?? [] };
      } else {
        return { rootPath: null, loaded: true, error: null, lastExportFolder: config.lastExportFolder ?? '', aiEnabled: !!config.aiEnabled, recentFolders: config.recentFolders ?? [] };
      }
    } else {
      return { rootPath: null, loaded: true, error: null, lastExportFolder: config.lastExportFolder ?? '', aiEnabled: !!config.aiEnabled, recentFolders: config.recentFolders ?? [] };
    }
  } catch {
    return { rootPath: null, loaded: false, error: 'Failed to load configuration', lastExportFolder: '', aiEnabled: false, recentFolders: [] };
  }
}
