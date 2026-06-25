/**
 * configMgr.ts — Configuration Manager (main process only)
 *
 * Reads the YAML config file exactly once at startup via initConfig().
 * All subsequent reads use the in-memory object; writes update it
 * synchronously and enqueue an async, atomic flush to disk (serialized so
 * overlapping writes can't race). No re-reads ever happen after init.
 */

import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import * as yaml from 'js-yaml';
import { enforceDefaultAIModels } from './ai/aiModel';
import { defaultSettings, parseConfigYaml } from './configSchema';
import type { AppConfig, AIModelConfig } from './types/shared';
import { logger } from './utils/logUtil';
import { writeFileAtomic } from './utils/atomicWrite';

export type { FontSize, SortOrder, ContentWidth, ImageSize, SearchMode, SearchType, SearchSortBy, SearchSortDirection, SearchDefinition, Bookmark, AppSettings, AIModelConfig, AIRewritePromptDef, AppConfig } from './types/shared';

// Config file location (Linux XDG standard: ~/.config/mk-browser/config.yaml)
const CONFIG_DIR = path.join(app.getPath('home'), '.config', 'mk-browser');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

// `defaultSettings` is defined in and re-exported from configSchema (the schema
// references it, so it lives there to avoid a circular import).
export { defaultSettings };

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
  { name: 'Claude Haiku', provider: 'ANTHROPIC', model: 'claude-haiku-4-5-20251001', inputPer1M: 1.00, outputPer1M: 5.00, vision: true, readonly: true },
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
  { name: 'Local LLAMA.CPP', provider: 'LLAMACPP', model: 'local', inputPer1M: 0, outputPer1M: 0, vision: false, readonly: true },
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

// Set when initConfig() encounters a file that exists but cannot be read or
// parsed. Callers can surface this to the user; updateConfig() remains safe to
// call — it writes explicit user changes rather than guessed defaults.
let _configLoadError: { error: string; backupPath: string | null } | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

// Serialize config writes through a single promise chain (mirrors withIndexLock
// in indexUtil.ts, but there is only one config file so no per-key map is
// needed). The main process is single-threaded, but persistConfig() is now
// async: without serialization, two overlapping updateConfig() calls could race
// on the atomic rename and land an older snapshot last. Chaining guarantees the
// writes apply in call order, so the final on-disk file matches the final
// in-memory state.
let _writeChain: Promise<void> = Promise.resolve();

/**
 * Snapshot the current config and enqueue an atomic, fsync'd write to disk.
 * Returns a promise that resolves once THIS snapshot has been persisted (or
 * rejects if its write failed). The stored chain tail swallows errors so a
 * single failed write can't break persistence for subsequent calls.
 */
function persistConfig(): Promise<void> {
  // Snapshot synchronously at call time so the queued write reflects the config
  // as of this call, regardless of later mutations.
  const data = yaml.dump(_config);
  const run = _writeChain.then(async () => {
    await fs.promises.mkdir(CONFIG_DIR, { recursive: true });
    await writeFileAtomic(CONFIG_FILE, data);
  });
  _writeChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

/**
 * Await any in-flight / queued config write. Call this on app quit so a write
 * that is still flushing isn't lost. Never rejects (errors are logged at the
 * write site / swallowed by the chain tail).
 */
export function flushConfig(): Promise<void> {
  return _writeChain;
}

function backupBadConfig(): string | null {
  const backupPath = `${CONFIG_FILE}.bak-${Date.now()}`;
  try {
    fs.copyFileSync(CONFIG_FILE, backupPath);
    logger.warn(`[configMgr] Backed up unreadable config to: ${backupPath}`);
    return backupPath;
  } catch (err) {
    logger.warn('[configMgr] Failed to create config backup:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the load error from the most recent initConfig() call, or null if
 * the config was loaded successfully (or the file was absent on first run).
 */
export function getConfigLoadError(): { error: string; backupPath: string | null } | null {
  return _configLoadError;
}

/**
 * Read the config file into memory. Must be called once at app startup
 * before any other configMgr function is used.
 *
 * Three outcomes are possible:
 *  1. File absent   → first-run: write defaults to disk and return.
 *  2. File readable and valid → load into memory; persist only if AI defaults
 *     were added (the existing file is never clobbered on a successful parse).
 *  3. File exists but unreadable/invalid → load in-memory defaults WITHOUT
 *     writing to disk (leaving the original intact so the user can recover it).
 *     A `.bak-<timestamp>` copy is created and getConfigLoadError() is set.
 */
export async function initConfig(): Promise<void> {
  ensureConfigDir();
  _configLoadError = null;

  if (!fs.existsSync(CONFIG_FILE)) {
    // First-run: no config file on disk yet — write defaults.
    _config = { browseFolder: '', settings: { ...defaultSettings } };
    if (createDefaultAISettings(_config)) await persistConfig();
    return;
  }

  // Config file exists: try to read and parse it. The sync read is acceptable
  // here because initConfig() runs exactly once at startup (see issue 003).
  try {
    // The config file is untrusted (hand-editable, syncable, corruptible), so
    // validate it through the zod schema rather than casting. Malformed fields
    // degrade to defaults; a non-object top level returns null.
    const parsed = parseConfigYaml(yaml.load(fs.readFileSync(CONFIG_FILE, 'utf-8')));
    if (parsed) {
      _config = { ...parsed, settings: { ...defaultSettings, ...parsed.settings } };
      if (createDefaultAISettings(_config)) await persistConfig();
      return;
    }

    // Parsed as valid YAML but top-level value isn't an object.
    const errorMsg = 'Config file top-level value is not an object';
    logger.error(`[configMgr] ${errorMsg} — running on in-memory defaults. File: ${CONFIG_FILE}`);
    _configLoadError = { error: errorMsg, backupPath: backupBadConfig() };

  } catch (err) {
    // YAML syntax error, I/O error (EACCES, EBUSY, …), or any other read failure.
    logger.error('[configMgr] Failed to read/parse config file — running on in-memory defaults.', CONFIG_FILE, err);
    _configLoadError = { error: String(err), backupPath: backupBadConfig() };
  }

  // File exists but is unreadable/corrupt: use in-memory defaults, do NOT persist
  // (leave the on-disk file untouched so the user can recover or inspect it).
  _config = { browseFolder: '', settings: { ...defaultSettings } };
  createDefaultAISettings(_config);
}

/**
 * Return the in-memory config object. No file I/O.
 */
export function getConfig(): AppConfig {
  return _config;
}

/**
 * Merge partial updates into the in-memory config and persist to disk.
 *
 * This is the ONLY way to mutate config from the renderer: each call touches
 * only the keys it carries, and the main process is single-threaded, so
 * concurrent updates to different keys can never clobber each other. There is
 * deliberately no whole-config "replace" path exposed to the renderer.
 *
 * Any key whose value is `undefined` is treated as a deletion (e.g. pass
 * `curSubFolder: undefined` to remove it entirely).
 */
export function updateConfig(updates: Partial<AppConfig>): Promise<void> {
  _config = { ..._config, ...updates };
  // A key explicitly set to undefined means "delete this key"
  for (const key of Object.keys(updates) as (keyof AppConfig)[]) {
    if (updates[key] === undefined) {
      delete _config[key];
    }
  }

  // Enforce defaults and normalize AI model selection before persisting.
  // The in-memory mutation above is synchronous, so getConfig() reflects the
  // change immediately; the returned promise resolves once it reaches disk.
  createDefaultAISettings(_config);
  return persistConfig();
}
