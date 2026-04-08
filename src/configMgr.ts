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
  provider: 'ANTHROPIC' | 'OPENAI' | 'GOOGLE' | 'LLAMACPP';
  model: string;
  /** USD per 1M input tokens */
  inputPer1M: number;
  /** USD per 1M output tokens */
  outputPer1M: number;
  /** Whether the model supports image/vision input. */
  vision: boolean;
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
  llamacppBaseUrl?: string;
  llamacppFolder?: string;
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
  // Anthropic — Claude 4 generation
  // Model IDs: https://platform.claude.com/docs/en/about-claude/models/overview
  // Pricing:   https://platform.claude.com/docs/en/about-claude/pricing
  { name: 'Claude Opus 4.6', provider: 'ANTHROPIC', model: 'claude-opus-4-6', inputPer1M: 5.00, outputPer1M: 25.00, vision: true, readonly: true },
  { name: 'Claude Opus 4.5', provider: 'ANTHROPIC', model: 'claude-opus-4-5', inputPer1M: 5.00, outputPer1M: 25.00, vision: true, readonly: true },
  { name: 'Claude Opus 4.1', provider: 'ANTHROPIC', model: 'claude-opus-4-1-20250805', inputPer1M: 15.00, outputPer1M: 75.00, vision: true, readonly: true },
  { name: 'Claude Sonnet 4.6', provider: 'ANTHROPIC', model: 'claude-sonnet-4-6', inputPer1M: 3.00, outputPer1M: 15.00, vision: true, readonly: true },
  { name: 'Claude Sonnet 4.5', provider: 'ANTHROPIC', model: 'claude-sonnet-4-5-20250929', inputPer1M: 3.00, outputPer1M: 15.00, vision: true, readonly: true },
  { name: 'Claude Sonnet 4', provider: 'ANTHROPIC', model: 'claude-sonnet-4-20250514', inputPer1M: 3.00, outputPer1M: 15.00, vision: true, readonly: true },
  { name: 'Claude Haiku 4.5', provider: 'ANTHROPIC', model: 'claude-haiku-4-5-20251001', inputPer1M: 1.00, outputPer1M: 5.00, vision: true, readonly: true },
  // Anthropic — Claude 3.x generation (legacy)
  // Model IDs: https://platform.claude.com/docs/en/about-claude/models/migration-guide
  // Pricing:   https://platform.claude.com/docs/en/about-claude/pricing
  { name: 'Claude Sonnet 3.7', provider: 'ANTHROPIC', model: 'claude-3-7-sonnet-20250219', inputPer1M: 3.00, outputPer1M: 15.00, vision: true, readonly: true },
  { name: 'Claude Haiku 3.5', provider: 'ANTHROPIC', model: 'claude-3-5-haiku-20241022', inputPer1M: 0.80, outputPer1M: 4.00, vision: true, readonly: true },
  { name: 'Claude Haiku', provider: 'ANTHROPIC', model: 'claude-3-haiku-20240307', inputPer1M: 0.25, outputPer1M: 1.25, vision: true, readonly: true },
  { name: 'Claude Opus 3', provider: 'ANTHROPIC', model: 'claude-3-opus-20240229', inputPer1M: 15.00, outputPer1M: 75.00, vision: true, readonly: true },
  // OpenAI — GPT-5 generation
  // Model IDs: https://developers.openai.com/api/docs/models
  // Pricing:   https://developers.openai.com/api/docs/pricing
  { name: 'GPT-5.2', provider: 'OPENAI', model: 'gpt-5.2', inputPer1M: 1.75, outputPer1M: 14.00, vision: true, readonly: true },
  { name: 'GPT-5.2 Pro', provider: 'OPENAI', model: 'gpt-5.2-pro', inputPer1M: 21.00, outputPer1M: 168.00, vision: true, readonly: true },
  { name: 'GPT-5.1', provider: 'OPENAI', model: 'gpt-5.1', inputPer1M: 1.25, outputPer1M: 10.00, vision: true, readonly: true },
  { name: 'GPT-5', provider: 'OPENAI', model: 'gpt-5', inputPer1M: 1.25, outputPer1M: 10.00, vision: true, readonly: true },
  { name: 'GPT-5 Mini', provider: 'OPENAI', model: 'gpt-5-mini', inputPer1M: 0.25, outputPer1M: 2.00, vision: true, readonly: true },
  { name: 'GPT-5 Nano', provider: 'OPENAI', model: 'gpt-5-nano', inputPer1M: 0.05, outputPer1M: 0.40, vision: true, readonly: true },
  // OpenAI — GPT-4.1 generation
  // Model IDs: https://developers.openai.com/api/docs/models
  // Pricing:   https://developers.openai.com/api/docs/pricing
  { name: 'GPT-4.1', provider: 'OPENAI', model: 'gpt-4.1', inputPer1M: 2.00, outputPer1M: 8.00, vision: true, readonly: true },
  { name: 'GPT-4.1 Mini', provider: 'OPENAI', model: 'gpt-4.1-mini', inputPer1M: 0.40, outputPer1M: 1.60, vision: true, readonly: true },
  { name: 'GPT-4.1 Nano', provider: 'OPENAI', model: 'gpt-4.1-nano', inputPer1M: 0.10, outputPer1M: 0.40, vision: true, readonly: true },
  // OpenAI — GPT-4o generation
  // Model IDs: https://developers.openai.com/api/docs/models
  // Pricing:   https://developers.openai.com/api/docs/pricing
  { name: 'GPT-4o', provider: 'OPENAI', model: 'gpt-4o', inputPer1M: 2.50, outputPer1M: 10.00, vision: true, readonly: true },
  { name: 'GPT-4o Mini', provider: 'OPENAI', model: 'gpt-4o-mini', inputPer1M: 0.15, outputPer1M: 0.60, vision: true, readonly: true },
  // OpenAI — o-series reasoning models
  // Model IDs: https://developers.openai.com/api/docs/models
  // Pricing:   https://developers.openai.com/api/docs/pricing
  { name: 'o1', provider: 'OPENAI', model: 'o1', inputPer1M: 15.00, outputPer1M: 60.00, vision: true, readonly: true },
  { name: 'o1 Pro', provider: 'OPENAI', model: 'o1-pro', inputPer1M: 150.00, outputPer1M: 600.00, vision: true, readonly: true },
  { name: 'o1 Mini', provider: 'OPENAI', model: 'o1-mini', inputPer1M: 1.10, outputPer1M: 4.40, vision: false, readonly: true },
  { name: 'o3', provider: 'OPENAI', model: 'o3', inputPer1M: 2.00, outputPer1M: 8.00, vision: true, readonly: true },
  { name: 'o3 Pro', provider: 'OPENAI', model: 'o3-pro', inputPer1M: 20.00, outputPer1M: 80.00, vision: true, readonly: true },
  { name: 'o3 Mini', provider: 'OPENAI', model: 'o3-mini', inputPer1M: 1.10, outputPer1M: 4.40, vision: false, readonly: true },
  { name: 'o4 Mini', provider: 'OPENAI', model: 'o4-mini', inputPer1M: 1.10, outputPer1M: 4.40, vision: true, readonly: true },
  // OpenAI — legacy models
  // Model IDs: https://developers.openai.com/api/docs/models
  // Pricing:   https://developers.openai.com/api/docs/pricing (Legacy models section)
  { name: 'GPT-4 Turbo', provider: 'OPENAI', model: 'gpt-4-turbo-2024-04-09', inputPer1M: 10.00, outputPer1M: 30.00, vision: true, readonly: true },
  { name: 'GPT-4', provider: 'OPENAI', model: 'gpt-4-0613', inputPer1M: 30.00, outputPer1M: 60.00, vision: false, readonly: true },
  { name: 'GPT-3.5 Turbo', provider: 'OPENAI', model: 'gpt-3.5-turbo', inputPer1M: 0.50, outputPer1M: 1.50, vision: false, readonly: true },
  // Google — Gemini 3 generation (preview)
  // Model IDs: https://ai.google.dev/gemini-api/docs/models
  // Pricing:   https://ai.google.dev/gemini-api/docs/pricing
  { name: 'Gemini 3.1 Pro Preview', provider: 'GOOGLE', model: 'gemini-3.1-pro-preview', inputPer1M: 2.00, outputPer1M: 12.00, vision: true, readonly: true },
  { name: 'Gemini 3 Pro Preview', provider: 'GOOGLE', model: 'gemini-3-pro-preview', inputPer1M: 2.00, outputPer1M: 12.00, vision: true, readonly: true },
  { name: 'Gemini 3 Flash Preview', provider: 'GOOGLE', model: 'gemini-3-flash-preview', inputPer1M: 0.50, outputPer1M: 3.00, vision: true, readonly: true },
  // Google — Gemini 2.5 generation
  // Model IDs: https://ai.google.dev/gemini-api/docs/models
  // Pricing:   https://ai.google.dev/gemini-api/docs/pricing
  { name: 'Gemini 2.5 Pro', provider: 'GOOGLE', model: 'gemini-2.5-pro', inputPer1M: 1.25, outputPer1M: 10.00, vision: true, readonly: true },
  { name: 'Gemini 2.5 Flash', provider: 'GOOGLE', model: 'gemini-2.5-flash', inputPer1M: 0.30, outputPer1M: 2.50, vision: true, readonly: true },
  { name: 'Gemini 2.5 Flash-Lite', provider: 'GOOGLE', model: 'gemini-2.5-flash-lite', inputPer1M: 0.10, outputPer1M: 0.40, vision: true, readonly: true },
  // Google — Gemini 2.0 generation (deprecated)
  // Model IDs: https://ai.google.dev/gemini-api/docs/models
  // Pricing:   https://ai.google.dev/gemini-api/docs/pricing
  { name: 'Gemini 2.0 Flash', provider: 'GOOGLE', model: 'gemini-2.0-flash', inputPer1M: 0.10, outputPer1M: 0.40, vision: true, readonly: true },
  { name: 'Gemini Flash Lite', provider: 'GOOGLE', model: 'gemini-2.0-flash-lite', inputPer1M: 0.075, outputPer1M: 0.30, vision: true, readonly: true },
  // llama.cpp (local)
  { name: 'Gemma 4 (llama.cpp)', provider: 'LLAMACPP', model: 'gemma-4', inputPer1M: 0, outputPer1M: 0, vision: false, readonly: true },
];

const DEFAULT_AI_MODEL = 'Claude Haiku';

/**
 * Ensure AI-related config fields exist with sensible defaults.
 * Returns true if any value was populated (caller should persist).
 */
export function createDefaultAISettings(config: AppConfig): boolean {
  let changed = false;

  const coerceNonNegativeNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return undefined;
  };

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

  // Ensure pricing fields exist and are valid numbers for all models.
  // Older configs won't have these fields; we normalize and persist once.
  if (config.aiModels) {
    config.aiModels = config.aiModels.map((m) => {
      const inputPer1M = coerceNonNegativeNumber((m as unknown as Record<string, unknown>).inputPer1M) ?? 0;
      const outputPer1M = coerceNonNegativeNumber((m as unknown as Record<string, unknown>).outputPer1M) ?? 0;

      if (m.inputPer1M !== inputPer1M || m.outputPer1M !== outputPer1M) {
        changed = true;
        return { ...m, inputPer1M, outputPer1M };
      }

      return m;
    });
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
