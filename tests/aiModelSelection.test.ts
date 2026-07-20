/**
 * Unit tests for the active-model helpers in src/main/ai/aiModel.ts:
 * getActiveModel and getActiveProvider.
 *
 * These resolve the user's selected model from config — pure selection/fallback
 * logic, no LLM call. We mock configMgr (to control the config) so nothing
 * touches disk or a network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIModelConfig } from '../src/shared/shared';

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const mockGetConfig = vi.fn<(...args: unknown[]) => unknown>();
vi.mock('../src/main/configMgr', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

import { getActiveModel, getActiveProvider } from '../src/main/ai/aiModel';

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
  model('Local LLAMA.CPP', 'LLAMACPP'),
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
    selectModel('Local LLAMA.CPP');
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
