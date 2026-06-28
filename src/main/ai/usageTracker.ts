/**
 * usageTracker.ts — AI Token Usage Tracking (main process only)
 *
 * Persists cumulative token usage to ~/.config/mk-browser/ai-usage.json.
 * Provides estimated cost calculations based on known per-token pricing.
 */

import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { logger } from '../../shared/logUtil';

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
 * Per-provider pricing used for cost estimation. Cumulative usage isn't tracked
 * per-model, so each provider's cheapest tier is applied as a conservative
 * default.
 */
const PROVIDER_DEFAULT_PRICING: Record<string, PricingEntry> = {
  ANTHROPIC: { inputPer1M: 0.25,  outputPer1M: 1.25 },
  OPENAI:    { inputPer1M: 0.10,  outputPer1M: 0.40 },
  GOOGLE:    { inputPer1M: 0.075, outputPer1M: 0.30 },
  LLAMACPP:  { inputPer1M: 0,     outputPer1M: 0    },
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
export async function loadUsage(): Promise<AIUsageData> {
  try {
    const raw = await fs.promises.readFile(USAGE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as AIUsageData;
    // Ensure all expected fields exist (forward-compatible with older files)
    return {
      totalInputTokens: parsed.totalInputTokens ?? 0,
      totalOutputTokens: parsed.totalOutputTokens ?? 0,
      totalRequests: parsed.totalRequests ?? 0,
      byProvider: parsed.byProvider ?? {},
    };
  } catch {
    // Missing or corrupt file — fall through to defaults
    return defaultUsage();
  }
}

/** Write usage data to disk. Creates the config dir if needed. */
async function saveUsage(data: AIUsageData): Promise<void> {
  await fs.promises.mkdir(CONFIG_DIR, { recursive: true });
  await fs.promises.writeFile(USAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Serializes the read-modify-write cycles below. The old sync implementation
// was atomic by blocking the event loop; with async I/O, two overlapping
// recordUsage calls could otherwise lose one of the increments.
let usageWriteQueue: Promise<void> = Promise.resolve();

function enqueueUsageWrite(task: () => Promise<void>, label: string): Promise<void> {
  const result = usageWriteQueue.then(task);
  usageWriteQueue = result.catch((err: unknown) => logger.error(`${label}:`, err));
  return result;
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
): Promise<void> {
  return enqueueUsageWrite(async () => {
    const data = await loadUsage();

    data.totalInputTokens += inputTokens;
    data.totalOutputTokens += outputTokens;
    data.totalRequests += 1;

    if (!data.byProvider[provider]) {
      data.byProvider[provider] = { inputTokens: 0, outputTokens: 0, requests: 0 };
    }
    data.byProvider[provider].inputTokens += inputTokens;
    data.byProvider[provider].outputTokens += outputTokens;
    data.byProvider[provider].requests += 1;

    await saveUsage(data);
  }, 'Failed to record AI usage');
}

/** Reset all usage stats to zero. */
export function resetUsage(): Promise<void> {
  return enqueueUsageWrite(() => saveUsage(defaultUsage()), 'Failed to reset AI usage');
}

/**
 * Estimate the USD cost for a number of tokens at a provider's default pricing.
 */
export function estimateCost(
  provider: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = PROVIDER_DEFAULT_PRICING[provider] ?? PROVIDER_DEFAULT_PRICING.LLAMACPP;
  return (inputTokens / 1_000_000) * pricing.inputPer1M
       + (outputTokens / 1_000_000) * pricing.outputPer1M;
}

/**
 * Load usage data and compute estimated costs per provider.
 * Uses provider default pricing for cost estimation (since we don't
 * track which specific model was used per-request in cumulative mode).
 */
export async function getUsageWithCosts(): Promise<AIUsageWithCosts> {
  const data = await loadUsage();
  const estimatedCosts: Record<string, number> = {};
  let totalEstimatedCost = 0;

  for (const [provider, usage] of Object.entries(data.byProvider)) {
    const cost = estimateCost(provider, usage.inputTokens, usage.outputTokens);
    estimatedCosts[provider] = cost;
    totalEstimatedCost += cost;
  }

  return { ...data, estimatedCosts, totalEstimatedCost };
}
