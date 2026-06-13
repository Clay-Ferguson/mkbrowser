/**
 * Unit tests for the active-model helpers in src/ai/aiModel.ts:
 * getActiveModel, getActiveProvider, and ensureModelServerRunning.
 *
 * These resolve the user's selected model from config and decide whether the
 * local llama.cpp server needs starting — pure selection/fallback logic, no LLM
 * call. We mock configMgr (to control the config) and llamaServer (to observe
 * whether the server start is triggered) so nothing touches disk or a network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIModelConfig } from '../src/types/shared';

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const mockGetConfig = vi.fn();
vi.mock('../src/configMgr', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

const mockEnsureRunning = vi.fn(() => Promise.resolve());
vi.mock('../src/ai/llamaServer', () => ({
  ensureRunning: (...args: unknown[]) => mockEnsureRunning(...args),
}));

import { getActiveModel, getActiveProvider, ensureModelServerRunning } from '../src/ai/aiModel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal AIModelConfig entry. */
function model(name: string, provider: AIModelConfig['provider']): AIModelConfig {
  return { name, provider, model: `${name}-id`, inputPer1M: 0, outputPer1M: 0, vision: true, readonly: false };
}

const MODELS: AIModelConfig[] = [
  model('Claude Haiku', 'ANTHROPIC'),
  model('GPT-4o', 'OPENAI'),
  model('Local Gemma', 'LLAMACPP'),
];

/** Point getConfig at the given selection over the standard MODELS list. */
function selectModel(aiModel: string | undefined): void {
  mockGetConfig.mockReturnValue({ aiModel, aiModels: MODELS });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getActiveModel
// ---------------------------------------------------------------------------

describe('getActiveModel', () => {
  it('returns the entry whose name matches config.aiModel', () => {
    selectModel('GPT-4o');
    expect(getActiveModel()).toEqual(model('GPT-4o', 'OPENAI'));
  });

  it('returns undefined when no model is selected', () => {
    selectModel(undefined);
    expect(getActiveModel()).toBeUndefined();
  });

  it('returns undefined when the selected name is not in the list', () => {
    selectModel('Nonexistent');
    expect(getActiveModel()).toBeUndefined();
  });

  it('returns undefined when aiModels is missing', () => {
    mockGetConfig.mockReturnValue({ aiModel: 'GPT-4o', aiModels: undefined });
    expect(getActiveModel()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getActiveProvider
// ---------------------------------------------------------------------------

describe('getActiveProvider', () => {
  it('returns the provider of the active model', () => {
    selectModel('Local Gemma');
    expect(getActiveProvider()).toBe('LLAMACPP');
  });

  it('falls back to ANTHROPIC when nothing is selected', () => {
    selectModel(undefined);
    expect(getActiveProvider()).toBe('ANTHROPIC');
  });

  it('falls back to ANTHROPIC when the selection does not resolve', () => {
    selectModel('Nonexistent');
    expect(getActiveProvider()).toBe('ANTHROPIC');
  });
});

// ---------------------------------------------------------------------------
// ensureModelServerRunning
// ---------------------------------------------------------------------------

describe('ensureModelServerRunning', () => {
  it('starts the llama.cpp server when the active model is LLAMACPP', async () => {
    selectModel('Local Gemma');
    await ensureModelServerRunning();
    expect(mockEnsureRunning).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a cloud provider', async () => {
    selectModel('Claude Haiku');
    await ensureModelServerRunning();
    expect(mockEnsureRunning).not.toHaveBeenCalled();
  });

  it('does nothing when no model is selected', async () => {
    selectModel(undefined);
    await ensureModelServerRunning();
    expect(mockEnsureRunning).not.toHaveBeenCalled();
  });
});
