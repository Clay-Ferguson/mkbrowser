import { getConfig } from '../configMgr';
import { debugLog } from "./langGraph";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";

export type AIProvider = 'ANTHROPIC' | 'OPENAI' | 'GOOGLE' | 'LLAMACPP';

interface AIModelConfigLike {
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

function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeModel<T extends AIModelConfigLike>(model: T, readonly: boolean): Omit<T, 'readonly'> & { readonly: boolean } {
  return {
    ...model,
    name: model.name.trim(),
    model: model.model.trim(),
    readonly,
  };
}

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
  let changed = false;

  if (existingModels.length !== enforcedModels.length) {
    changed = true;
  } else {
    for (let i = 0; i < enforcedModels.length; i++) {
      if (!modelsEqual(existingModels[i], enforcedModels[i])) {
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
}// NOTE: See 'llamacpp' folder for instructions on setting up llama.cpp for local inference.

/**
 * Resolve the active AI provider and model name from the config.
 * Falls back to Anthropic Claude Haiku if nothing is configured.
 */

export function getActiveModelConfig(): { provider: 'ANTHROPIC' | 'OPENAI' | 'GOOGLE' | 'LLAMACPP'; model: string; llamacppBaseUrl: string; } {
    const config = getConfig();
    const llamacppBaseUrl = config.llamacppBaseUrl || 'http://localhost:8080/v1';

    const normalizeKey = (name: string) => name.trim().toLowerCase();

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
    return new ChatOpenAI({ model, configuration: { baseURL: llamacppBaseUrl } });
  }
  if (provider === 'OPENAI') {
    return new ChatOpenAI({ model });
  }
  if (provider === 'GOOGLE') {
    const apiKey = process.env.GOOGLE_API_KEY;
    debugLog('createChatModel → GOOGLE_API_KEY is', apiKey ? `set (${apiKey.length} chars)` : 'NOT SET — this will likely cause a hang or error');
    // maxRetries: 2 to fail faster on quota/auth errors instead of silently retrying many times
    return new ChatGoogleGenerativeAI({ model, maxRetries: 2 });
  }
  return new ChatAnthropic({ model });
}


