/**
 * usageTracker.ts — AI Token Usage Tracking (main process only)
 *
 * Persists cumulative token usage to ~/.config/mk-browser/ai-usage.json.
 * Provides estimated cost calculations based on known per-token pricing.
 */

import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-provider cumulative usage. */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

/** Root shape of the ai-usage.json file. */
export interface AIUsageData {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  byProvider: Record<string, ProviderUsage>;
}

/** Usage data enriched with estimated costs. */
export interface AIUsageWithCosts extends AIUsageData {
  estimatedCosts: Record<string, number>;   // provider → USD
  totalEstimatedCost: number;
}

// ---------------------------------------------------------------------------
// Pricing table (USD per 1 million tokens)
// ---------------------------------------------------------------------------

interface PricingEntry {
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
}

/**
 * Known per-model pricing. Keys should match model identifiers used in
 * AIModelConfig.model. Checked first before falling back to provider defaults.
 */
const MODEL_PRICING: Record<string, PricingEntry> = {
  // Anthropic
  'claude-3-haiku-20240307':    { inputPer1M: 0.25,  outputPer1M: 1.25  },
  'claude-3-5-haiku-20241022':  { inputPer1M: 0.80,  outputPer1M: 4.00  },
  'claude-3-5-sonnet-20241022': { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-sonnet-4-20250514':   { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-4-opus-20260715':     { inputPer1M: 15.00, outputPer1M: 75.00 },
  // OpenAI
  'gpt-4.1-nano':              { inputPer1M: 0.10,  outputPer1M: 0.40  },
  'gpt-4.1-mini':              { inputPer1M: 0.40,  outputPer1M: 1.60  },
  'gpt-4.1':                   { inputPer1M: 2.00,  outputPer1M: 8.00  },
  'gpt-4o':                    { inputPer1M: 2.50,  outputPer1M: 10.00 },
  'gpt-4o-mini':               { inputPer1M: 0.15,  outputPer1M: 0.60  },
  // Google
  'gemini-2.0-flash-lite':     { inputPer1M: 0.075, outputPer1M: 0.30  },
  'gemini-2.0-flash':          { inputPer1M: 0.10,  outputPer1M: 0.40  },
  'gemini-1.5-flash':          { inputPer1M: 0.075, outputPer1M: 0.30  },
  'gemini-1.5-pro':            { inputPer1M: 1.25,  outputPer1M: 5.00  },
};

/**
 * Fallback pricing per provider when the specific model isn't in MODEL_PRICING.
 * Uses the cheapest tier for each provider as a conservative default.
 */
const PROVIDER_DEFAULT_PRICING: Record<string, PricingEntry> = {
  ANTHROPIC: { inputPer1M: 0.25,  outputPer1M: 1.25 },
  OPENAI:    { inputPer1M: 0.10,  outputPer1M: 0.40 },
  GOOGLE:    { inputPer1M: 0.075, outputPer1M: 0.30 },
  OLLAMA:    { inputPer1M: 0,     outputPer1M: 0    },
};

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

const CONFIG_DIR = path.join(app.getPath('home'), '.config', 'mk-browser');
const USAGE_FILE = path.join(CONFIG_DIR, 'ai-usage.json');

function defaultUsage(): AIUsageData {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalRequests: 0,
    byProvider: {},
  };
}

/** Read and parse ai-usage.json, returning defaults if it doesn't exist. */
export function loadUsage(): AIUsageData {
  try {
    if (fs.existsSync(USAGE_FILE)) {
      const raw = fs.readFileSync(USAGE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as AIUsageData;
      // Ensure all expected fields exist (forward-compatible with older files)
      return {
        totalInputTokens: parsed.totalInputTokens ?? 0,
        totalOutputTokens: parsed.totalOutputTokens ?? 0,
        totalRequests: parsed.totalRequests ?? 0,
        byProvider: parsed.byProvider ?? {},
      };
    }
  } catch {
    // Corrupt file — fall through to defaults
  }
  return defaultUsage();
}

/** Write usage data to disk. Creates the config dir if needed. */
function saveUsage(data: AIUsageData): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record token usage from a single AI request. Loads current totals,
 * increments, and persists back to disk.
 */
export function recordUsage(
  provider: string,
  inputTokens: number,
  outputTokens: number
): void {
  const data = loadUsage();

  data.totalInputTokens += inputTokens;
  data.totalOutputTokens += outputTokens;
  data.totalRequests += 1;

  if (!data.byProvider[provider]) {
    data.byProvider[provider] = { inputTokens: 0, outputTokens: 0, requests: 0 };
  }
  data.byProvider[provider].inputTokens += inputTokens;
  data.byProvider[provider].outputTokens += outputTokens;
  data.byProvider[provider].requests += 1;

  saveUsage(data);
}

/** Reset all usage stats to zero. */
export function resetUsage(): void {
  saveUsage(defaultUsage());
}

/**
 * Estimate the USD cost for a given number of tokens with a specific model/provider.
 */
export function estimateCost(
  model: string,
  provider: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model] ?? PROVIDER_DEFAULT_PRICING[provider] ?? PROVIDER_DEFAULT_PRICING.OLLAMA;
  return (inputTokens / 1_000_000) * pricing.inputPer1M
       + (outputTokens / 1_000_000) * pricing.outputPer1M;
}

/**
 * Load usage data and compute estimated costs per provider.
 * Uses provider default pricing for cost estimation (since we don't
 * track which specific model was used per-request in cumulative mode).
 */
export function getUsageWithCosts(): AIUsageWithCosts {
  const data = loadUsage();
  const estimatedCosts: Record<string, number> = {};
  let totalEstimatedCost = 0;

  for (const [provider, usage] of Object.entries(data.byProvider)) {
    const pricing = PROVIDER_DEFAULT_PRICING[provider] ?? PROVIDER_DEFAULT_PRICING.OLLAMA;
    const cost = (usage.inputTokens / 1_000_000) * pricing.inputPer1M
               + (usage.outputTokens / 1_000_000) * pricing.outputPer1M;
    estimatedCosts[provider] = cost;
    totalEstimatedCost += cost;
  }

  return { ...data, estimatedCosts, totalEstimatedCost };
}
