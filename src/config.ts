import { setSettings, setCurrentPath } from './store';

export interface LoadConfigResult {
  rootPath: string | null;
  loaded: boolean;
  error: string | null;
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
      setSettings(config.settings);
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
        return { rootPath: config.browseFolder, loaded: true, error: null };
      } else {
        return { rootPath: null, loaded: true, error: null };
      }
    } else {
      return { rootPath: null, loaded: true, error: null };
    }
  } catch (err) {
    return { rootPath: null, loaded: false, error: 'Failed to load configuration' };
  }
}
