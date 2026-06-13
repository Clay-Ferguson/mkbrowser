/**
 * Unit tests for messageUtil (src/ai/messageUtil.ts) — the typed accessors for
 * the loosely-typed fields LangChain attaches to messages / stream chunks.
 *
 * These are pure functions over plain objects; no LLM or LangChain runtime is
 * involved. We pass message-shaped plain objects and assert the extraction.
 */
import { describe, it, expect } from 'vitest';
import {
  getAdditionalKwargs,
  getReasoningContent,
  hasToolCalls,
  getUsageMetadata,
} from '../src/ai/messageUtil';

describe('getAdditionalKwargs', () => {
  it('returns the additional_kwargs object when present', () => {
    expect(getAdditionalKwargs({ additional_kwargs: { a: 1 } })).toEqual({ a: 1 });
  });

  it('returns an empty object when missing or for nullish input', () => {
    expect(getAdditionalKwargs({})).toEqual({});
    expect(getAdditionalKwargs(undefined)).toEqual({});
    expect(getAdditionalKwargs(null)).toEqual({});
  });
});

describe('getReasoningContent', () => {
  it('returns the reasoning_content string when present and non-empty', () => {
    expect(getReasoningContent({ additional_kwargs: { reasoning_content: 'why' } })).toBe('why');
  });

  it('returns undefined for empty, missing, or non-string reasoning_content', () => {
    expect(getReasoningContent({ additional_kwargs: { reasoning_content: '' } })).toBeUndefined();
    expect(getReasoningContent({ additional_kwargs: {} })).toBeUndefined();
    expect(getReasoningContent({ additional_kwargs: { reasoning_content: 42 } })).toBeUndefined();
    expect(getReasoningContent({})).toBeUndefined();
  });
});

describe('hasToolCalls', () => {
  it('is true when tool_calls is a non-empty array', () => {
    expect(hasToolCalls({ tool_calls: [{ name: 'x' }] })).toBe(true);
  });

  it('is false for empty array, missing, or non-array tool_calls', () => {
    expect(hasToolCalls({ tool_calls: [] })).toBe(false);
    expect(hasToolCalls({})).toBe(false);
    expect(hasToolCalls({ tool_calls: 'nope' })).toBe(false);
    expect(hasToolCalls(undefined)).toBe(false);
  });
});

describe('getUsageMetadata', () => {
  it('returns full metadata when input_tokens is numeric', () => {
    expect(
      getUsageMetadata({ usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }),
    ).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
  });

  it('leaves optional fields undefined when they are non-numeric', () => {
    expect(getUsageMetadata({ usage_metadata: { input_tokens: 7 } })).toEqual({
      input_tokens: 7,
      output_tokens: undefined,
      total_tokens: undefined,
    });
  });

  it('returns undefined when input_tokens is missing or non-numeric', () => {
    expect(getUsageMetadata({ usage_metadata: { output_tokens: 5 } })).toBeUndefined();
    expect(getUsageMetadata({ usage_metadata: { input_tokens: '10' } })).toBeUndefined();
    expect(getUsageMetadata({})).toBeUndefined();
    expect(getUsageMetadata(undefined)).toBeUndefined();
  });
});
