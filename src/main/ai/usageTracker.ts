/**
 * usageTracker.ts — AI Token Usage Tracking (main process only)
 *
 * Persists cumulative token usage and estimated cost, per model, to
 * ~/.config/mk-browser/ai-usage.json. Costs come from each model's own
 * $/1M-token prices (AI Models tab).
 *
 * See: (USER_GUIDE.md#ai-usage-statistics)
 */

import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { logger } from '../../shared/logUtil';
import type { AIModelConfig, AIUsageWithCosts, ModelUsage } from '../../shared/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Root shape of the ai-usage.json file. Usage is keyed by model *name*, and each
 * request's cost is computed from that model's own $/1M prices at the moment it
 * is recorded, so renaming, repricing, or deleting a model later never rewrites
 * history.
 */
export type AIUsageData = AIUsageWithCosts;

/** Bucket used when a request completes with no resolvable active model. */
const UNKNOWN_MODEL = '(unknown)';

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

const CONFIG_DIR = path.join(app.getPath('home'), '.config', 'mk-browser');
const USAGE_FILE = path.join(CONFIG_DIR, 'ai-usage.json');

/** Return a zeroed-out AIUsageData object used as the initial / reset state. */
function defaultUsage(): AIUsageData {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalRequests: 0,
    totalCost: 0,
    byModel: {},
  };
}

/** A finite number, or 0. */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Read and parse ai-usage.json, returning defaults if it doesn't exist or is
 * unreadable. Fields are coerced individually, so a file in an older shape just
 * reads as zeros rather than failing.
 */
export async function loadUsage(): Promise<AIUsageData> {
  try {
    const raw = await fs.promises.readFile(USAGE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AIUsageData> | null;
    const byModel: Record<string, ModelUsage> = {};
    const rawByModel = parsed?.byModel;
    if (rawByModel && typeof rawByModel === 'object') {
      for (const [name, u] of Object.entries(rawByModel)) {
        byModel[name] = {
          inputTokens: num(u?.inputTokens),
          outputTokens: num(u?.outputTokens),
          requests: num(u?.requests),
          cost: num(u?.cost),
        };
      }
    }
    return {
      totalInputTokens: num(parsed?.totalInputTokens),
      totalOutputTokens: num(parsed?.totalOutputTokens),
      totalRequests: num(parsed?.totalRequests),
      totalCost: num(parsed?.totalCost),
      byModel,
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

/**
 * Chain `task` onto the serial write queue so that concurrent calls (e.g. two
 * rapid AI requests finishing at the same time) don't race on the JSON file.
 * Errors are logged under `label` but do not break the queue for future writes.
 */
function enqueueUsageWrite(task: () => Promise<void>, label: string): Promise<void> {
  const result = usageWriteQueue.then(task);
  usageWriteQueue = result.catch((err: unknown) => logger.error(`${label}:`, err));
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Estimated USD cost of a request at the given model's prices (0 when the model is unknown). */
export function estimateCost(model: AIModelConfig | undefined, inputTokens: number, outputTokens: number): number {
  if (!model) return 0;
  return (inputTokens / 1_000_000) * model.inputPer1M
       + (outputTokens / 1_000_000) * model.outputPer1M;
}

/**
 * Record token usage from a single AI request against the model that served it.
 * Loads current totals, increments, and persists back to disk.
 */
export function recordUsage(
  model: AIModelConfig | undefined,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const name = model?.name ?? UNKNOWN_MODEL;
  const cost = estimateCost(model, inputTokens, outputTokens);
  return enqueueUsageWrite(async () => {
    const data = await loadUsage();

    data.totalInputTokens += inputTokens;
    data.totalOutputTokens += outputTokens;
    data.totalRequests += 1;
    data.totalCost += cost;

    const entry = data.byModel[name] ?? { inputTokens: 0, outputTokens: 0, requests: 0, cost: 0 };
    data.byModel[name] = {
      inputTokens: entry.inputTokens + inputTokens,
      outputTokens: entry.outputTokens + outputTokens,
      requests: entry.requests + 1,
      cost: entry.cost + cost,
    };

    await saveUsage(data);
  }, 'Failed to record AI usage');
}

/**
 * Reset all usage stats to zero.
 *
 * See: (USER_GUIDE.md#ai-usage-statistics)
 */
export function resetUsage(): Promise<void> {
  return enqueueUsageWrite(() => saveUsage(defaultUsage()), 'Failed to reset AI usage');
}

/**
 * Load usage data (totals and per-model breakdown, with costs).
 *
 * See: (USER_GUIDE.md#ai-usage-statistics)
 */
export function getUsageWithCosts(): Promise<AIUsageWithCosts> {
  return loadUsage();
}
