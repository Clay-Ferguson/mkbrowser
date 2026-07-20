import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { getConfig } from '../configMgr';
import type { AIModelConfig } from '../../shared/shared';
import { createDebugLog } from "./aiLog";

const debugLog = createDebugLog('aiModel');

export type AIProvider = 'ANTHROPIC' | 'OPENAI' | 'GOOGLE' | 'LLAMACPP';

export interface AIModelConfigLike {
  name: string;
  provider: AIProvider;
  model: string;
  readonly?: boolean;
}

interface EnforceDefaultModelsResult<T extends AIModelConfigLike> {
  models: Array<Omit<T, 'readonly'> & { readonly: boolean }>;
  selectedModel: string;
  changed: boolean;
}

/** Trim and lowercase a model name for case-insensitive map lookups. */
function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Return a copy of `model` with whitespace-trimmed name/model fields and an explicit `readonly` value. */
function normalizeModel<T extends AIModelConfigLike>(model: T, readonly: boolean): Omit<T, 'readonly'> & { readonly: boolean } {
  return {
    ...model,
    name: model.name.trim(),
    model: model.model.trim(),
    readonly,
  };
}

/** Deep-equal check for model config entries (name, provider, model string, and readonly flag). */
function modelsEqual(a: AIModelConfigLike, b: AIModelConfigLike): boolean {
  return (
    a.name === b.name &&
    a.provider === b.provider &&
    a.model === b.model &&
    Boolean(a.readonly) === Boolean(b.readonly)
  );
}

/**
 * Enforce that all default AI models are present and take precedence.
 *
 * - Name matching is case-insensitive.
 * - Any user model colliding with a default model name is overwritten by the default.
 * - Non-default models are normalized to `readonly: false`.
 * - Defaults appear first (in the order provided), then remaining user models in original order.
 * - The selected model name is canonicalized to the matched model's `name`, or set to the provided default.
 */
export function enforceDefaultAIModels<T extends AIModelConfigLike>(args: {
  existingModels?: T[];
  defaultModels: Array<Omit<T, 'readonly'> & { readonly: boolean }>;
  selectedModelName?: string;
  defaultSelectedModelName: string;
}): EnforceDefaultModelsResult<T> {
  const existingModels = args.existingModels ?? [];

  const defaultByKey = new Map<string, Omit<T, 'readonly'> & { readonly: boolean }>();
  for (const d of args.defaultModels) {
    defaultByKey.set(normalizeKey(d.name), d);
  }

  // Keep user models in original order, deduped case-insensitively, excluding any that collide with defaults.
  const seenUserKeys = new Set<string>();
  const userModels: Array<Omit<T, 'readonly'> & { readonly: boolean }> = [];

  for (const m of existingModels) {
    const key = normalizeKey(m.name);
    if (!key) continue;

    // Defaults always win, so drop any colliding entry.
    if (defaultByKey.has(key)) continue;

    if (seenUserKeys.has(key)) continue;
    seenUserKeys.add(key);

    userModels.push(normalizeModel(m, false));
  }

  const enforcedModels: Array<Omit<T, 'readonly'> & { readonly: boolean }> = [
    ...args.defaultModels.map((d) => normalizeModel(d as unknown as T, true)),
    ...userModels,
  ];

  // Canonicalize selection.
  const selectedKey = args.selectedModelName ? normalizeKey(args.selectedModelName) : '';
  const selectedMatch = selectedKey
    ? enforcedModels.find((m) => normalizeKey(m.name) === selectedKey)
    : undefined;
  const selectedModel = selectedMatch ? selectedMatch.name : args.defaultSelectedModelName;

  // Detect whether anything changed.
  //
  // `changed` drives persistence, and only the user's own models are persisted —
  // configMgr's toPersistedConfig() drops the built-ins, which are re-merged
  // from the catalog on every load. So this compares the *persisted projection*
  // of the input against that of the output (userModels), rather than the merged
  // lists. Comparing merged lists would report a change on every startup, since
  // a config read off disk can never contain the built-ins about to be merged
  // in — a pointless write per app launch.
  //
  // Projecting the input too (rather than using existingModels raw) keeps the
  // function idempotent for both shapes of input: a config straight from disk
  // (no built-ins, so the filter is a no-op) and one already enforced in memory
  // (built-ins present, and correctly ignored).
  const existingUserModels = existingModels.filter((m) => !m.readonly);

  // Index alignment is sound: userModels is built by walking existingModels in
  // order and keeping a subset of that same non-readonly set, so equal lengths
  // imply nothing was dropped and position i refers to the same entry in both.
  let changed = existingUserModels.length !== userModels.length;

  if (!changed) {
    for (let i = 0; i < userModels.length; i++) {
      if (!modelsEqual(existingUserModels[i]!, userModels[i]!)) {
        changed = true;
        break;
      }
    }
  }

  if (args.selectedModelName !== selectedModel) {
    changed = true;
  }

  // If aiModels was missing/undefined and we produced models, that is a change.
  if (args.existingModels === undefined && enforcedModels.length > 0) {
    changed = true;
  }

  return { models: enforcedModels, selectedModel, changed };
}

// NOTE: Local inference is served by a llama.cpp `llama-server` the user runs
// themselves. MkBrowser never starts, stops, or otherwise manages that process —
// it only talks to whatever is listening at the configured base URL.

/**
 * Resolve the active AI provider and model name from the config.
 * Falls back to Anthropic Claude Haiku if nothing is configured.
 */

export function getActiveModelConfig(): { provider: AIProvider; model: string; llamacppBaseUrl: string; } {
    const config = getConfig();
    const llamacppBaseUrl = config.llamacppBaseUrl || 'http://localhost:8080/v1';

    if (config.aiModel && config.aiModels) {
        const selectedKey = normalizeKey(config.aiModel);
        const entry = config.aiModels.find((m) => normalizeKey(m.name) === selectedKey);
        if (entry) {
            debugLog('getActiveModelConfig → provider:', entry.provider, 'model:', entry.model);
            return { provider: entry.provider, model: entry.model, llamacppBaseUrl };
        }
    }

    // Fallback defaults
    debugLog('getActiveModelConfig → using fallback: ANTHROPIC / claude-haiku-4-5-20251001');
    return { provider: 'ANTHROPIC', model: 'claude-haiku-4-5-20251001', llamacppBaseUrl };
}

/**
 * Create the appropriate LangChain chat model based on the active config.
 */
export function createChatModel() {
  const { provider, model, llamacppBaseUrl } = getActiveModelConfig();
  debugLog('createChatModel → provider:', provider, 'model:', model);
  if (provider === 'LLAMACPP') {
    // Local server — no API key required.
    return new ChatOpenAI({ model, configuration: { baseURL: llamacppBaseUrl } });
  }
  if (provider === 'OPENAI') {
    warnIfApiKeyMissing('OPENAI_API_KEY');
    return new ChatOpenAI({ model });
  }
  if (provider === 'GOOGLE') {
    warnIfApiKeyMissing('GOOGLE_API_KEY');
    // maxRetries: 2 to fail faster on quota/auth errors instead of silently retrying many times
    return new ChatGoogleGenerativeAI({ model, maxRetries: 2 });
  }
  warnIfApiKeyMissing('ANTHROPIC_API_KEY');
  return new ChatAnthropic({ model });
}

/**
 * Log whether a cloud provider's API-key env var is set. A missing key
 * typically surfaces later as a hang or auth error, so flagging it up front
 * makes that failure mode easier to diagnose.
 */
function warnIfApiKeyMissing(envVar: string): void {
  const key = process.env[envVar];
  debugLog(`createChatModel → ${envVar} is`,
    key ? `set (${key.length} chars)` : 'NOT SET — this will likely cause a hang or error');
}

/**
 * Resolve the user's currently-selected model entry from config, matched by
 * `config.aiModel` name. Returns undefined when nothing matches (no selection,
 * or the selected name isn't present in `config.aiModels`).
 */
export function getActiveModel(): AIModelConfig | undefined {
  const config = getConfig();
  return config.aiModels?.find((m) => m.name === config.aiModel);
}

/**
 * Provider of the active model, falling back to 'ANTHROPIC' (the default
 * provider) when no model is resolved. Used for usage accounting.
 */
export function getActiveProvider(): AIProvider {
  return getActiveModel()?.provider ?? 'ANTHROPIC';
}


