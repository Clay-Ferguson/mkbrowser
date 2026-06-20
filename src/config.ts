import { setSettings, setCurrentPath, setCalendarViewType, setImageSize, setAiConfig } from './store';
import { api } from './services/api';
import type { AppConfig } from './types/shared';
import type { AiConfigState } from './store';

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
    const config = await api.getConfig();
    // Load settings from config into store (only once at startup)
    if (config.settings) {
      setSettings({ indexTreeWidth: 'narrow', showPropsInEditor: true, ...config.settings });
    }
    if (config.calendarViewType) {
      setCalendarViewType(config.calendarViewType);
    }
    if (config.imageSize) {
      setImageSize(config.imageSize);
    }
    // Seed the renderer-reactive AI config mirror (see store/aiConfig.ts).
    setAiConfig({
      aiEnabled: !!config.aiEnabled,
      aiRewriteMode: !!config.aiRewriteMode,
      aiRewritePrompt: config.aiRewritePrompt ?? '',
      tagsPanelVisible: config.tagsPanelVisible ?? false,
    });
    if (config.browseFolder) {
      const exists = await api.pathExists(config.browseFolder);
      if (exists) {
        // If a saved subfolder exists and is valid, start there instead of the root
        let initialPath = config.browseFolder;
        if (config.curSubFolder && config.curSubFolder.startsWith(config.browseFolder)) {
          const subExists = await api.pathExists(config.curSubFolder);
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

/**
 * Persist AI config changes AND mirror the renderer-reactive subset into the
 * store, so all live consumers (e.g. the editor's AI Rewrite button) update
 * immediately without remounting. This is the single sync point: any code that
 * changes an AI config field the renderer reacts to should call this instead of
 * `api.updateConfig` directly.
 */
export async function saveAiConfig(updates: Partial<AppConfig>): Promise<void> {
  const mirror: Partial<AiConfigState> = {};
  if (updates.aiEnabled !== undefined) mirror.aiEnabled = updates.aiEnabled;
  if (updates.aiRewriteMode !== undefined) mirror.aiRewriteMode = updates.aiRewriteMode;
  // `aiRewritePrompt` uses key-presence (not !== undefined) because clearing the
  // persona persists `aiRewritePrompt: undefined` (a deletion) — mirror that as ''.
  if ('aiRewritePrompt' in updates) mirror.aiRewritePrompt = updates.aiRewritePrompt ?? '';
  if (updates.tagsPanelVisible !== undefined) mirror.tagsPanelVisible = updates.tagsPanelVisible;
  if (Object.keys(mirror).length > 0) setAiConfig(mirror);
  await api.updateConfig(updates);
}
