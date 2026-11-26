/**
 * Unit tests for the active-model helpers in src/main/ai/aiModel.ts:
 * getActiveModel and getActiveModelConfig.
 *
 * These resolve the user's selected model from config — pure selection logic,
 * no LLM call. There is no fallback model: with nothing configured,
 * getActiveModelConfig throws. We mock configMgr (to control the config) so
 * nothing touches disk or a network.
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

import { getActiveModel, getActiveModelConfig, NO_MODEL_CONFIGURED_MESSAGE } from '../src/main/ai/aiModel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal AIModelConfig entry. */
function model(name: string, provider: AIModelConfig['provider'], baseUrl?: string): AIModelConfig {
  return { name, provider, model: `${name}-id`, ...(baseUrl ? { baseUrl } : {}), inputPer1M: 0, outputPer1M: 0, vision: true };
}

const MODELS: AIModelConfig[] = [
  model('Claude Haiku', 'ANTHROPIC'),
  model('GPT-4o', 'OPENAI'),
  model('Local Llama', 'OPENAI', 'http://localhost:8080/v1'),
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

  it('matches the name case-insensitively, ignoring surrounding whitespace', () => {
    selectModel('  local LLAMA ');
    expect(getActiveModel()?.name).toBe('Local Llama');
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
// getActiveModelConfig
// ---------------------------------------------------------------------------

describe('getActiveModelConfig', () => {
  it('returns the active model, including its Base URL', () => {
    selectModel('Local Llama');
    expect(getActiveModelConfig()).toEqual(model('Local Llama', 'OPENAI', 'http://localhost:8080/v1'));
  });

  it('throws a configure-a-model error when no models are defined', () => {
    mockGetConfig.mockReturnValue({ aiModel: '', aiModels: [] });
    expect(() => getActiveModelConfig()).toThrow(NO_MODEL_CONFIGURED_MESSAGE);
  });

  it('throws when the selection does not resolve (no fallback model)', () => {
    selectModel('Nonexistent');
    expect(() => getActiveModelConfig()).toThrow(NO_MODEL_CONFIGURED_MESSAGE);
  });
});
