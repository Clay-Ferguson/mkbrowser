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
}

export interface AppConfig {
  browseFolder: string;
  curSubFolder?: string;
  settings?: AppSettings;
  aiEnabled?: boolean;
  aiModels?: AIModelConfig[];
  aiModel?: string;
  ollamaBaseUrl?: string;
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
  { name: 'Claude Haiku', provider: 'ANTHROPIC', model: 'claude-3-haiku-20240307' },
  { name: 'GPT-4.1 Nano', provider: 'OPENAI', model: 'gpt-4.1-nano' },
  { name: 'Gemini Flash Lite', provider: 'GOOGLE', model: 'gemini-2.0-flash-lite' },
  { name: 'Qwen (Ollama)', provider: 'OLLAMA', model: 'qwen-silent' },
];

const DEFAULT_AI_MODEL = 'Claude Haiku';
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/**
 * Ensure AI-related config fields exist with sensible defaults.
 * Returns true if any value was populated (caller should persist).
 */
export function createDefaultAISettings(config: AppConfig): boolean {
  let changed = false;

  if (!config.aiModels || config.aiModels.length === 0) {
    config.aiModels = [...DEFAULT_AI_MODELS];
    changed = true;
  }

  if (!config.aiModel) {
    config.aiModel = DEFAULT_AI_MODEL;
    changed = true;
  }

  if (!config.ollamaBaseUrl) {
    config.ollamaBaseUrl = DEFAULT_OLLAMA_BASE_URL;
    changed = true;
  }

  if (config.aiEnabled === undefined) {
    config.aiEnabled = false;
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
  _config = { browseFolder: '', settings: { ...defaultSettings } };
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
  persistConfig();
}
