import { setSettings, getSettings, setCurrentPath, setCalendarViewType, setAiConfig, getAiConfig, setAppError, defaultAiConfig, defaultSettings } from '../store';
import { api } from './api';
import { isPathInside } from './pathUtil';
import { logger } from '../shared/logUtil';
import type { AppConfig } from '../shared/shared';
import type { AiConfigState } from '../store';

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
  if ('agenticMode' in updates) mirror.agenticMode = updates.agenticMode ?? defaultAiConfig.agenticMode;
  if ('agenticAllowedFolders' in updates) mirror.agenticAllowedFolders = updates.agenticAllowedFolders ?? defaultAiConfig.agenticAllowedFolders;
  return mirror;
}

export interface LoadConfigResult {
  rootPath: string | null;
  loaded: boolean;
  error: string | null;
  lastExportFolder: string;
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
      setSettings({ ...defaultSettings, ...config.settings });
    }
    if (config.calendarViewType) {
      setCalendarViewType(config.calendarViewType);
    }
    // Seed the renderer-reactive AI config mirror (see store/aiConfig.ts).
    setAiConfig({ ...defaultAiConfig, ...pickAiConfig(config) });
    const base = {
      loaded: true,
      error: null as string | null,
      lastExportFolder: config.lastExportFolder ?? '',
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
    logger.error('[config] loadConfig failed', err);
    return { rootPath: null, loaded: false, error: 'Failed to load configuration', lastExportFolder: '', recentFolders: [] };
  }
}

/**
 * Persist AI config changes AND mirror them into the reactive store, so all live
 * consumers (the editor's AI Rewrite button, ThreadView's persona dropdown, the
 * settings form) update immediately without remounting. This is the single sync
 * point: any code that changes an AI config field should call this instead of
 * `api.updateConfig` directly. Non-AI keys in `updates` are simply persisted.
 *
 * The mirror is updated optimistically, before the IPC round trip. Callers derive
 * the new value from the mirror (`!tagsVisible`, `[...aiRewritePrompts, newOne]`),
 * so a second action started while the first save is in flight must already see
 * the first one's result, or it would compute from a stale base and overwrite it.
 * If the persist fails, each field this call set is rolled back to its previous
 * value (unless a later save has changed it since) and the error is rethrown, so
 * the store never keeps a change that isn't on disk.
 */
export async function saveAiConfig(updates: Partial<AppConfig>): Promise<void> {
  const mirror = pickAiConfig(updates);
  const keys = Object.keys(mirror) as (keyof AiConfigState)[];
  const current = getAiConfig();
  const previous: Partial<AiConfigState> = {};
  for (const key of keys) assignField(previous, current, key);
  if (keys.length > 0) setAiConfig(mirror);
  try {
    await api.updateConfig(updates);
  } catch (err) {
    rollbackAiConfig(mirror, previous);
    logger.error('[config] saveAiConfig failed', err);
    throw err;
  }
}

/** Copies one field between AI config objects, keeping the key/value types paired. */
function assignField<K extends keyof AiConfigState>(
  target: Partial<AiConfigState>,
  source: Partial<AiConfigState>,
  key: K
): void {
  target[key] = source[key];
}

/**
 * Restores `previous` for each field of a failed save's `applied` values, skipping
 * any field a newer save has changed since, so a failed save can't undo a later
 * successful one.
 */
function rollbackAiConfig(applied: Partial<AiConfigState>, previous: Partial<AiConfigState>): void {
  const current = getAiConfig();
  const restore: Partial<AiConfigState> = {};
  for (const key of Object.keys(applied) as (keyof AiConfigState)[]) {
    if (current[key] === applied[key]) assignField(restore, previous, key);
  }
  if (Object.keys(restore).length > 0) setAiConfig(restore);
}

/**
 * Persist the store's current `settings` to disk. Callers update the store
 * first (e.g. `setSortOrder`), then call this; it is fire-and-forget, and a
 * failure is reported through the app error dialog. The single way settings
 * are written, so every caller shares the same failure handling.
 */
export function saveSettings(): void {
  api.updateConfig({ settings: getSettings() }).catch((err: unknown) => {
    logger.error('[config] saveSettings failed', err);
    setAppError('Failed to save settings');
  });
}
