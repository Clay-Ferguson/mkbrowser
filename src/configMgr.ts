/**
 * configMgr.ts — Configuration Manager (main process only)
 *
 * Reads the YAML config file exactly once at startup via initConfig().
 * All subsequent reads use the in-memory object; writes update it and
 * flush to disk immediately. No re-reads ever happen after init.
 */

import path from 'node:path';
import fs from 'node:fs';
import * as yaml from 'js-yaml';
import { app } from 'electron';
import { enforceDefaultAIModels } from './utils/aiModelEnforcement';

// Config file location (Linux XDG standard: ~/.config/mk-browser/config.yaml)
const CONFIG_DIR = path.join(app.getPath('home'), '.config', 'mk-browser');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FontSize = 'small' | 'medium' | 'large' | 'xlarge';
export type SortOrder =
  | 'alphabetical'
  | 'created-chron'
  | 'created-reverse'
  | 'modified-chron'
  | 'modified-reverse';
export type ContentWidth = 'narrow' | 'medium' | 'wide' | 'full';
export type SearchMode = 'content' | 'filenames';
export type SearchType = 'literal' | 'wildcard' | 'advanced';
export type SearchBlock = 'entire-file' | 'file-lines';

export interface SearchDefinition {
  name: string;
  searchText: string;
  searchTarget: SearchMode;
  searchMode: SearchType;
  searchBlock: SearchBlock;
}

export interface AppSettings {
  fontSize: FontSize;
  sortOrder: SortOrder;
  foldersOnTop: boolean;
  ignoredPaths: string;
  searchDefinitions: SearchDefinition[];
  contentWidth: ContentWidth;
  bookmarks: string[];
}

export interface AIModelConfig {
  name: string;
  provider: 'ANTHROPIC' | 'OLLAMA' | 'OPENAI' | 'GOOGLE';
  model: string;
  /** Built-in model that cannot be edited or deleted in the UI. */
  readonly: boolean;
}

export interface AppConfig {
  browseFolder: string;
  curSubFolder?: string;
  settings?: AppSettings;
  aiEnabled?: boolean;
  aiModels?: AIModelConfig[];
  aiModel?: string;
  ollamaBaseUrl?: string;
  agenticMode?: boolean;
  agenticAllowedFolders?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const defaultSettings: AppSettings = {
  fontSize: 'medium',
  sortOrder: 'alphabetical',
  foldersOnTop: true,
  ignoredPaths: '',
  searchDefinitions: [],
  contentWidth: 'medium',
  bookmarks: [],
};

// ---------------------------------------------------------------------------
// AI defaults
// ---------------------------------------------------------------------------

const DEFAULT_AI_MODELS: AIModelConfig[] = [
  { name: 'Claude Haiku', provider: 'ANTHROPIC', model: 'claude-3-haiku-20240307', readonly: true },
  { name: 'GPT-4.1 Nano', provider: 'OPENAI', model: 'gpt-4.1-nano', readonly: true },
  { name: 'Gemini Flash Lite', provider: 'GOOGLE', model: 'gemini-2.0-flash-lite', readonly: true },
  { name: 'Qwen (Ollama)', provider: 'OLLAMA', model: 'qwen-silent', readonly: true },
];

const DEFAULT_AI_MODEL = 'Claude Haiku';
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/**
 * Ensure AI-related config fields exist with sensible defaults.
 * Returns true if any value was populated (caller should persist).
 */
export function createDefaultAISettings(config: AppConfig): boolean {
  let changed = false;

  // Always enforce built-in default models (case-insensitive name matching).
  // Defaults overwrite any user-defined model with the same name.
  const enforced = enforceDefaultAIModels<AIModelConfig>({
    existingModels: config.aiModels,
    defaultModels: DEFAULT_AI_MODELS,
    selectedModelName: config.aiModel,
    defaultSelectedModelName: DEFAULT_AI_MODEL,
  });

  if (enforced.changed) {
    changed = true;
  }

  config.aiModels = enforced.models as AIModelConfig[];
  config.aiModel = enforced.selectedModel;

  if (!config.ollamaBaseUrl) {
    config.ollamaBaseUrl = DEFAULT_OLLAMA_BASE_URL;
    changed = true;
  }

  if (config.aiEnabled === undefined) {
    config.aiEnabled = false;
    changed = true;
  }

  if (config.agenticMode === undefined) {
    config.agenticMode = false;
    changed = true;
  }

  if (config.agenticAllowedFolders === undefined) {
    config.agenticAllowedFolders = '';
    changed = true;
  }

  return changed;
}

// ---------------------------------------------------------------------------
// In-memory state (single source of truth after init)
// ---------------------------------------------------------------------------

let _config: AppConfig = { browseFolder: '', settings: { ...defaultSettings } };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function persistConfig(): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, yaml.dump(_config), 'utf-8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the config file into memory. Must be called once at app startup
 * before any other configMgr function is used.
 */
export function initConfig(): void {
  ensureConfigDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf-8')) as AppConfig;
      if (parsed) {
        _config = {
          ...parsed,
          settings: { ...defaultSettings, ...parsed.settings },
        };
        if (createDefaultAISettings(_config)) {
          persistConfig();
        }
        return;
      }
    }
  } catch {
    // Corrupted config — fall through to defaults
  }

  // First-run (or corrupted config): initialize a full default config,
  // including AI defaults, then persist so subsequent reads are consistent.
  _config = { browseFolder: '', settings: { ...defaultSettings } };
  if (createDefaultAISettings(_config)) {
    persistConfig();
  }
}

/**
 * Return the in-memory config object. No file I/O.
 */
export function getConfig(): AppConfig {
  return _config;
}

/**
 * Replace the entire in-memory config and persist to disk.
 */
export function setConfig(config: AppConfig): void {
  // Enforce defaults and normalize AI model selection before persisting.
  createDefaultAISettings(config);
  _config = config;
  persistConfig();
}

/**
 * Merge partial updates into the in-memory config and persist to disk.
 * Pass `curSubFolder: undefined` to delete the key.
 */
export function updateConfig(updates: Partial<AppConfig>): void {
  _config = { ..._config, ...updates };
  // Remove keys explicitly set to undefined
  if ('curSubFolder' in updates && updates.curSubFolder === undefined) {
    delete _config.curSubFolder;
  }

  // Enforce defaults and normalize AI model selection before persisting.
  createDefaultAISettings(_config);
  persistConfig();
}
