import { describe, expect, it } from 'vitest';
import { enforceDefaultAIModels, type AIModelConfigLike } from '../src/ai/aiModelEnforcement';

describe('enforceDefaultAIModels', () => {
  const defaults = [
    { name: 'Claude Haiku', provider: 'ANTHROPIC', model: 'claude-3-haiku-20240307', readonly: true },
    { name: 'GPT-4.1 Nano', provider: 'OPENAI', model: 'gpt-4.1-nano', readonly: true },
  ] as const;

  it('adds defaults when models are missing', () => {
    const result = enforceDefaultAIModels({
      existingModels: undefined,
      defaultModels: [...defaults],
      selectedModelName: undefined,
      defaultSelectedModelName: 'Claude Haiku',
    });

    expect(result.changed).toBe(true);
    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toMatchObject({ name: 'Claude Haiku', readonly: true });
    expect(result.selectedModel).toBe('Claude Haiku');
  });

  it('overwrites colliding user model by name (case-insensitive)', () => {
    const existing: AIModelConfigLike[] = [
      { name: 'claude haiku', provider: 'OPENAI', model: 'not-allowed', readonly: false },
      { name: 'My Custom', provider: 'OPENAI', model: 'gpt-4o-mini' },
    ];

    const result = enforceDefaultAIModels({
      existingModels: existing,
      defaultModels: [...defaults],
      selectedModelName: 'claude HAIKU',
      defaultSelectedModelName: 'Claude Haiku',
    });

    expect(result.models[0]).toMatchObject({
      name: 'Claude Haiku',
      provider: 'ANTHROPIC',
      model: 'claude-3-haiku-20240307',
      readonly: true,
    });

    expect(result.models.some((m) => m.name.toLowerCase() === 'claude haiku' && m.provider === 'OPENAI')).toBe(false);
    expect(result.models.some((m) => m.name === 'My Custom')).toBe(true);
    expect(result.selectedModel).toBe('Claude Haiku');
  });

  it('normalizes non-default models to readonly=false', () => {
    const existing: AIModelConfigLike[] = [
      { name: 'My Model', provider: 'OPENAI', model: 'gpt-4o-mini', readonly: true },
    ];

    const result = enforceDefaultAIModels({
      existingModels: existing,
      defaultModels: [...defaults],
      selectedModelName: 'My Model',
      defaultSelectedModelName: 'Claude Haiku',
    });

    const custom = result.models.find((m) => m.name === 'My Model');
    expect(custom).toBeTruthy();
    expect(custom?.readonly).toBe(false);
  });

  it('dedupes user models case-insensitively (keeps first)', () => {
    const existing: AIModelConfigLike[] = [
      { name: 'Custom', provider: 'OPENAI', model: 'a' },
      { name: 'custom', provider: 'OPENAI', model: 'b' },
    ];

    const result = enforceDefaultAIModels({
      existingModels: existing,
      defaultModels: [...defaults],
      selectedModelName: 'Custom',
      defaultSelectedModelName: 'Claude Haiku',
    });

    const custom = result.models.find((m) => m.name.toLowerCase() === 'custom');
    expect(custom).toMatchObject({ name: 'Custom', model: 'a', readonly: false });
    expect(result.models.filter((m) => m.name.toLowerCase() === 'custom')).toHaveLength(1);
  });

  it('falls back to default selection when selection is invalid', () => {
    const existing: AIModelConfigLike[] = [
      { name: 'My Custom', provider: 'OPENAI', model: 'gpt-4o-mini' },
    ];

    const result = enforceDefaultAIModels({
      existingModels: existing,
      defaultModels: [...defaults],
      selectedModelName: 'DOES NOT EXIST',
      defaultSelectedModelName: 'Claude Haiku',
    });

    expect(result.selectedModel).toBe('Claude Haiku');
  });
});
