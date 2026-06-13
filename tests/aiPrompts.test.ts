/**
 * Unit tests for buildSystemPrompt (src/ai/aiPrompts.ts).
 *
 * Pure string composition — no LLM involved. Verifies that the user's selected
 * persona is appended to the base system prompt, and that blank/absent personas
 * fall back to the base prompt unchanged.
 */
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, MKBROWSER_SYSTEM_PROMPT } from '../src/ai/aiPrompts';

describe('buildSystemPrompt', () => {
  it('returns the base prompt unchanged when no persona is given', () => {
    expect(buildSystemPrompt()).toBe(MKBROWSER_SYSTEM_PROMPT);
    expect(buildSystemPrompt(undefined)).toBe(MKBROWSER_SYSTEM_PROMPT);
  });

  it('returns the base prompt unchanged for blank / whitespace-only personas', () => {
    expect(buildSystemPrompt('')).toBe(MKBROWSER_SYSTEM_PROMPT);
    expect(buildSystemPrompt('   \n\t  ')).toBe(MKBROWSER_SYSTEM_PROMPT);
  });

  it('appends a non-empty persona after the base prompt', () => {
    const persona = 'You are a terse pirate.';
    const result = buildSystemPrompt(persona);
    expect(result).toBe(`${MKBROWSER_SYSTEM_PROMPT}\n\n${persona}`);
    expect(result.startsWith(MKBROWSER_SYSTEM_PROMPT)).toBe(true);
    expect(result.endsWith(persona)).toBe(true);
  });

  it('trims surrounding whitespace from the persona before appending', () => {
    const result = buildSystemPrompt('  Be concise.  ');
    expect(result).toBe(`${MKBROWSER_SYSTEM_PROMPT}\n\nBe concise.`);
  });
});
