import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { getConfig } from '../configMgr';
import type { AIModelConfig } from '../../shared/shared';
import { createDebugLog } from "./aiLog";
import { aiFileLogCallbacks } from "./aiFileLog";

const debugLog = createDebugLog('aiModel');

/** Shown (via the thrown error) when an AI request is made before any model is defined/selected. */
export const NO_MODEL_CONFIGURED_MESSAGE =
  'No AI model is configured. Open AI Settings → Configure Models to add one.';

/** Trim and lowercase a model name for case-insensitive lookups. */
function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

// NOTE: Local inference is served by a llama.cpp `llama-server` (or LM Studio)
// the user runs themselves, configured as an OpenAI-compatible model with a
// localhost Base URL. MkBrowser never starts, stops, or otherwise manages that
// process — it only talks to whatever is listening at the model's Base URL.
// See: (USER_GUIDE.md#configuring-ai-models)

/**
 * Resolve the active model definition from config, or throw when none is
 * configured. There is no fallback model: the user must define one in the
 * AI Models tab before AI works.
 *
 * See: (USER_GUIDE.md#ai-model)
 */
export function getActiveModelConfig(): AIModelConfig {
  const model = getActiveModel();
  if (!model) {
    debugLog('getActiveModelConfig → no active model configured');
    throw new Error(NO_MODEL_CONFIGURED_MESSAGE);
  }
  debugLog('getActiveModelConfig → provider:', model.provider, 'model:', model.model, 'baseUrl:', model.baseUrl ?? '(default)');
  return model;
}

/**
 * Create the appropriate LangChain chat model based on the active config.
 *
 * `aiFileLogCallbacks` is attached here as a *constructor* callback, which
 * makes it apply to every invocation of the returned model — and it survives
 * both `.bindTools()` and being handed to `createDeepAgent({ model })`. Since
 * all four invocation paths (invokeAI/streamAI/invokeDeepAgent/streamDeepAgent)
 * build their model here, this one line is the entire wiring for the on-disk
 * prompt/response log. See aiFileLog.ts.
 *
 * See: (USER_GUIDE.md#ai-model)
 */
export function createChatModel() {
  const { provider, model, baseUrl } = getActiveModelConfig();
  debugLog('createChatModel → provider:', provider, 'model:', model);
  if (provider === 'OPENAI') {
    if (baseUrl) {
      // OpenAI-compatible endpoint (often a local llama.cpp / LM Studio server,
      // which ignores the key). ChatOpenAI throws "Missing credentials" without
      // one, so fall back to a placeholder when OPENAI_API_KEY isn't set.
      return new ChatOpenAI({
        model,
        apiKey: process.env['OPENAI_API_KEY'] || 'no-key',
        configuration: { baseURL: baseUrl },
        callbacks: aiFileLogCallbacks,
      });
    }
    warnIfApiKeyMissing('OPENAI_API_KEY');
    return new ChatOpenAI({ model, callbacks: aiFileLogCallbacks });
  }
  if (provider === 'GOOGLE') {
    warnIfApiKeyMissing('GOOGLE_API_KEY');
    // maxRetries: 2 to fail faster on quota/auth errors instead of silently retrying many times
    return new ChatGoogleGenerativeAI({ model, maxRetries: 2, ...(baseUrl ? { baseUrl } : {}), callbacks: aiFileLogCallbacks });
  }
  warnIfApiKeyMissing('ANTHROPIC_API_KEY');
  return new ChatAnthropic({ model, ...(baseUrl ? { anthropicApiUrl: baseUrl } : {}), callbacks: aiFileLogCallbacks });
}

/**
 * Log whether a cloud provider's API-key env var is set. A missing key
 * typically surfaces later as a hang or auth error, so flagging it up front
 * makes that failure mode easier to diagnose.
 *
 * See: (USER_GUIDE.md#api-keys-for-cloud-providers)
 */
function warnIfApiKeyMissing(envVar: string): void {
  const key = process.env[envVar];
  debugLog(`createChatModel → ${envVar} is`,
    key ? `set (${key.length} chars)` : 'NOT SET — this will likely cause a hang or error');
}

/**
 * Resolve the user's currently-selected model entry from config, matched
 * case-insensitively by `config.aiModel` name. Returns undefined when nothing
 * matches (no models defined, no selection, or a stale name).
 */
export function getActiveModel(): AIModelConfig | undefined {
  const config = getConfig();
  const selectedKey = normalizeKey(config.aiModel ?? '');
  if (!selectedKey) return undefined;
  return config.aiModels?.find((m) => normalizeKey(m.name) === selectedKey);
}
