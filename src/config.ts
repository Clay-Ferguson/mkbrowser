import { setSettings, setCurrentPath, setCalendarViewType, setImageSize, setAiConfig, defaultAiConfig } from './store';
import { api } from './services/api';
import { isPathInside } from './utils/pathUtil';
import type { AppConfig } from './types/shared';
import type { AiConfigState } from './store';

/**
 * Project the AI-related keys present in a (partial) AppConfig onto the store's
 * mirror shape. Only keys actually present in `updates` are copied, so a partial
 * save (e.g. `{ aiModel }`) doesn't disturb the rest of the mirror. A key whose
 * value is `undefined` (a deletion, e.g. clearing the active persona) maps to
 * the field's default, so the mirror never holds `undefined`.
 *
 * Both seeding (`loadConfig`) and persisting (`saveAiConfig`) go through this one
 * function, so the AI mirror has a single projection point. Adding a new AI field
 * means adding a line here and to `AiConfigState`.
 */
function pickAiConfig(updates: Partial<AppConfig>): Partial<AiConfigState> {
  const mirror: Partial<AiConfigState> = {};
  if ('aiEnabled' in updates) mirror.aiEnabled = updates.aiEnabled ?? defaultAiConfig.aiEnabled;
  if ('aiRewriteMode' in updates) mirror.aiRewriteMode = updates.aiRewriteMode ?? defaultAiConfig.aiRewriteMode;
  if ('aiRewritePrompt' in updates) mirror.aiRewritePrompt = updates.aiRewritePrompt ?? defaultAiConfig.aiRewritePrompt;
  if ('aiRewritePrompts' in updates) mirror.aiRewritePrompts = updates.aiRewritePrompts ?? defaultAiConfig.aiRewritePrompts;
  if ('tagsPanelVisible' in updates) mirror.tagsPanelVisible = updates.tagsPanelVisible ?? defaultAiConfig.tagsPanelVisible;
  if ('fullDocContext' in updates) mirror.fullDocContext = updates.fullDocContext ?? defaultAiConfig.fullDocContext;
  if ('aiModels' in updates) mirror.aiModels = updates.aiModels ?? defaultAiConfig.aiModels;
  if ('aiModel' in updates) mirror.aiModel = updates.aiModel ?? defaultAiConfig.aiModel;
  if ('llamacppBaseUrl' in updates) mirror.llamacppBaseUrl = updates.llamacppBaseUrl ?? defaultAiConfig.llamacppBaseUrl;
  if ('llamacppFolder' in updates) mirror.llamacppFolder = updates.llamacppFolder ?? defaultAiConfig.llamacppFolder;
  if ('agenticMode' in updates) mirror.agenticMode = updates.agenticMode ?? defaultAiConfig.agenticMode;
  if ('agenticAllowedFolders' in updates) mirror.agenticAllowedFolders = updates.agenticAllowedFolders ?? defaultAiConfig.agenticAllowedFolders;
  return mirror;
}

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
    setAiConfig({ ...defaultAiConfig, ...pickAiConfig(config) });
    const base = {
      loaded: true,
      error: null as string | null,
      lastExportFolder: config.lastExportFolder ?? '',
      aiEnabled: !!config.aiEnabled,
      recentFolders: config.recentFolders ?? [],
    };
    if (!config.browseFolder || !(await api.pathExists(config.browseFolder))) {
      return { ...base, rootPath: null };
    }
    // If a saved subfolder exists and is valid, start there instead of the root
    let initialPath = config.browseFolder;
    if (config.curSubFolder && isPathInside(config.browseFolder, config.curSubFolder)) {
      const subExists = await api.pathExists(config.curSubFolder);
      if (subExists) {
        initialPath = config.curSubFolder;
      }
    }
    setCurrentPath(initialPath);
    return { ...base, rootPath: config.browseFolder };
  } catch (err) {
    console.error('[config] loadConfig failed', err);
    return { rootPath: null, loaded: false, error: 'Failed to load configuration', lastExportFolder: '', aiEnabled: false, recentFolders: [] };
  }
}

/**
 * Persist AI config changes AND mirror them into the reactive store, so all live
 * consumers (the editor's AI Rewrite button, ThreadView's persona dropdown, the
 * settings form) update immediately without remounting. This is the single sync
 * point: any code that changes an AI config field should call this instead of
 * `api.updateConfig` directly. Non-AI keys in `updates` are simply persisted.
 */
export async function saveAiConfig(updates: Partial<AppConfig>): Promise<void> {
  const mirror = pickAiConfig(updates);
  if (Object.keys(mirror).length > 0) setAiConfig(mirror);
  await api.updateConfig(updates);
}
