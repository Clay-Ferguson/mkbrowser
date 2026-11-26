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
import { loadYaml } from '../shared/yamlUtil';
import { defaultSettings, cloneDefaultSettings, parseConfigYaml, coerceNonNegativeNumber } from './configSchema';
import type { AppConfig } from '../shared/shared';
import { logger } from '../shared/logUtil';
import { writeFileAtomic } from './atomicWrite';

// Config file location — resolved per OS by Electron (Linux: ~/.config/mk-browser).
const configDir = () => app.getPath('userData');
const configFile = () => path.join(configDir(), 'config.yaml');

// `defaultSettings` is defined in and re-exported from configSchema (the schema
// references it, so it lives there to avoid a circular import).
export { defaultSettings };

// ---------------------------------------------------------------------------
// AI defaults
// ---------------------------------------------------------------------------

// There are deliberately NO built-in AI models: a fresh install has an empty
// `aiModels`, and the user defines every model themselves in the AI Models tab.
// See: (USER_GUIDE.md#configuring-ai-models)

/** Trim and lowercase a model name for case-insensitive matching. */
function modelKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Return a new AppConfig with AI-related fields populated to sensible defaults.
 * The input object is never modified. `changed` is true when any field was added
 * or normalised (caller should persist when true).
 *
 * The active model (`aiModel`) is canonicalized to the exact name of the model it
 * matches (case-insensitively); when it names no model it falls back to the first
 * model, or '' when there are none. `aiModels` is left absent when absent — there
 * is nothing to default it to.
 */
export function withDefaultAISettings(config: AppConfig): { config: AppConfig; changed: boolean } {
  let changed = false;
  const next = { ...config };

  if (next.aiModels) {
    // Ensure pricing fields are valid non-negative numbers.
    next.aiModels = next.aiModels.map((m) => {
      const inputPer1M = coerceNonNegativeNumber(m.inputPer1M) ?? 0;
      const outputPer1M = coerceNonNegativeNumber(m.outputPer1M) ?? 0;
      if (m.inputPer1M !== inputPer1M || m.outputPer1M !== outputPer1M) {
        changed = true;
        return { ...m, inputPer1M, outputPer1M };
      }
      return m;
    });
  }

  const models = next.aiModels ?? [];
  const selectedKey = modelKey(next.aiModel ?? '');
  const match = selectedKey ? models.find((m) => modelKey(m.name) === selectedKey) : undefined;
  const aiModel = match ? match.name : (models[0]?.name ?? '');
  if (next.aiModel !== aiModel) {
    next.aiModel = aiModel;
    changed = true;
  }

  if (next.aiEnabled === undefined) {
    next.aiEnabled = false;
    changed = true;
  }

  if (next.agenticMode === undefined) {
    next.agenticMode = false;
    changed = true;
  }

  if (next.agenticAllowedFolders === undefined) {
    next.agenticAllowedFolders = '';
    changed = true;
  }

  return { config: next, changed };
}

// ---------------------------------------------------------------------------
// In-memory state (single source of truth after init)
// ---------------------------------------------------------------------------

let _config: AppConfig = { browseFolder: '', settings: cloneDefaultSettings() };

// Set when initConfig() encounters a file that exists but cannot be read or
// parsed. Callers can surface this to the user; updateConfig() remains safe to
// call — it writes explicit user changes rather than guessed defaults.
let _configLoadError: { error: string; backupPath: string | null } | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Create the config directory if it does not already exist. Best effort: a
 * failure (EACCES, ENOSPC, read-only mount) is logged and swallowed, because a
 * missing directory only prevents *persisting* — the read path tolerates an
 * absent file, and persistConfig() re-runs its own mkdir before every write.
 * Throwing here would abort initConfig() and, through main.ts's app-ready
 * catch, prevent the window from ever being created.
 */
function ensureConfigDir(): void {
  try {
    if (!fs.existsSync(configDir())) {
      fs.mkdirSync(configDir(), { recursive: true });
    }
  } catch (err) {
    logger.error('[configMgr] Failed to create config directory (continuing; config will not persist):', configDir(), err);
  }
}

// Serialize config writes through a single promise chain (mirrors withIndexLock
// in indexUtil.ts, but there is only one config file so no per-key map is
// needed). The main process is single-threaded, but persistConfig() is
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
    await fs.promises.mkdir(configDir(), { recursive: true });
    await writeFileAtomic(configFile(), data);
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

/**
 * Persist wrapper for initConfig() ONLY: log-and-continue instead of rejecting.
 *
 * The writes initConfig() issues are seeding/normalization writes (first-run
 * defaults, back-filled AI fields) — the in-memory config is already complete
 * and correct before they run, so a failed flush (ENOSPC, EACCES, read-only or
 * network mount…) must never reject initConfig(). Letting the raw
 * persistConfig() rejection escape would cause two distinct failures:
 *
 *  1. First-run path: the rejection would propagate out of initConfig() into
 *     main.ts's app-ready handler, whose catch skips setupIpcHandlers() and
 *     createWindow() — a disk problem that only prevents *saving* would leave
 *     the app running with no window at all.
 *  2. Valid-config path: the `await persistConfig()` sits inside the same
 *     try/catch as the read/parse, so a pure WRITE error would be misclassified
 *     as a corrupt config file — the user's valid config.yaml backed up as
 *     "unreadable", getConfigLoadError() reporting corruption, and the
 *     already-loaded config discarded from memory in favor of blank defaults.
 *
 * Explicit user changes are different: updateConfig() still returns the real
 * write promise so callers can see and surface a persistence failure.
 */
async function persistConfigAtInit(): Promise<void> {
  try {
    await persistConfig();
  } catch (err) {
    logger.error('[configMgr] Failed to write config during init — continuing with in-memory config:', configFile(), err);
  }
}

/**
 * Copy the config file to a timestamped `.bak-<ms>` sibling as a recovery aid
 * when the file exists but cannot be parsed. Returns the backup path on success,
 * or `null` when the copy itself fails (e.g. the file is unreadable).
 */
function backupBadConfig(): string | null {
  const backupPath = `${configFile()}.bak-${Date.now()}`;
  try {
    fs.copyFileSync(configFile(), backupPath);
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
 *
 * Never rejects on a WRITE failure: any persist performed here is best-effort
 * (see persistConfigAtInit) because the in-memory config is complete before
 * the write starts. main.ts awaits this in the app-ready handler, so a
 * rejection would abort window creation over a save-only problem.
 */
export async function initConfig(): Promise<void> {
  ensureConfigDir();
  _configLoadError = null;

  if (!fs.existsSync(configFile())) {
    // First-run: no config file on disk yet — write defaults. The write is
    // best-effort (see persistConfigAtInit): the in-memory defaults are
    // already set, so a failed seed write must not reject initConfig().
    const { config: withAI, changed } = withDefaultAISettings({ browseFolder: '', settings: cloneDefaultSettings() });
    _config = withAI;
    if (changed) await persistConfigAtInit();
    return;
  }

  // Config file exists: try to read and parse it. The sync read is acceptable
  // here because initConfig() runs exactly once at startup (see issue 003).
  try {
    // The config file is untrusted (hand-editable, syncable, corruptible), so
    // validate it through the zod schema rather than casting. Malformed fields
    // degrade to defaults; a non-object top level returns null.
    const parsed = parseConfigYaml(loadYaml(fs.readFileSync(configFile(), 'utf-8')));
    if (parsed) {
      const base = { ...parsed, settings: { ...cloneDefaultSettings(), ...parsed.settings } };
      const { config: withAI, changed } = withDefaultAISettings(base);
      _config = withAI;
      // ⚠️ This persist MUST NOT throw: we are inside the try/catch that
      // classifies READ/parse failures as a corrupt config. A raw
      // `await persistConfig()` here would let a write error (ENOSPC etc.)
      // fall into that catch — backing up the user's VALID config as
      // "unreadable" and replacing the config just loaded into _config with
      // blank defaults. persistConfigAtInit swallows and logs write errors.
      if (changed) await persistConfigAtInit();
      return;
    }

    // Parsed as valid YAML but top-level value isn't an object.
    const errorMsg = 'Config file top-level value is not an object';
    logger.error(`[configMgr] ${errorMsg} — running on in-memory defaults. File: ${configFile()}`);
    _configLoadError = { error: errorMsg, backupPath: backupBadConfig() };

  } catch (err) {
    // YAML syntax error, I/O error (EACCES, EBUSY, …), or any other read failure.
    logger.error('[configMgr] Failed to read/parse config file — running on in-memory defaults.', configFile(), err);
    _configLoadError = { error: String(err), backupPath: backupBadConfig() };
  }

  // File exists but is unreadable/corrupt: use in-memory defaults, do NOT persist
  // (leave the on-disk file untouched so the user can recover or inspect it).
  _config = withDefaultAISettings({ browseFolder: '', settings: cloneDefaultSettings() }).config;
}

/**
 * Return the in-memory config object. No file I/O.
 * Readonly return type prevents accidental mutation — use updateConfig() instead.
 */
export function getConfig(): Readonly<AppConfig> {
  return _config;
}

// Keys that withDefaultAISettings reads or writes. Used to skip the
// normalization pass when an unrelated key is the only thing changing.
const AI_KEYS: ReadonlyArray<keyof AppConfig> = [
  'aiEnabled',
  'aiModels',
  'aiModel',
  'agenticMode',
  'agenticAllowedFolders',
];

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

  // Only run the AI normalization pass when the update touches an AI-related
  // key. Non-AI writes (e.g. curSubFolder, settings) must not silently mutate
  // aiModels/aiModel as a side-effect.
  if (AI_KEYS.some((k) => k in updates)) {
    _config = withDefaultAISettings(_config).config;
  }
  return persistConfig();
}
