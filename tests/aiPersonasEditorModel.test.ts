import { describe, it, expect } from 'vitest';
import {
  fromConfig,
  toConfig,
  validate,
  newEditorPersona,
  resolveActive,
  markSaved,
  type EditorPersona,
} from '../src/components/views/aiPersonasEditorModel';
import { DEFAULT_PERSONA_NAME } from '../src/shared/ai/aiPrompts';
import type { AIRewritePromptDef } from '../src/shared/shared';

function makePersona(name: string, prompt = ''): EditorPersona {
  return { ...newEditorPersona(), name, prompt };
}

const SAVED: AIRewritePromptDef[] = [
  { name: 'Hemingway', prompt: 'Write spare, punchy prose.' },
  { name: 'Pirate', prompt: 'Talk like a pirate.\n\nArrr.' },
];

describe('fromConfig / toConfig', () => {
  it('round-trips the persisted personas unchanged (multi-line prompts intact)', () => {
    expect(toConfig(fromConfig(SAVED))).toEqual(SAVED);
  });

  it('records each loaded row\'s originalName and gives every row a unique id', () => {
    const editor = fromConfig(SAVED);
    expect(editor.map((p) => p.originalName)).toEqual(['Hemingway', 'Pirate']);
    expect(new Set(editor.map((p) => p.id)).size).toBe(2);
  });

  it('trims names but keeps the prompt exactly as typed', () => {
    expect(toConfig([makePersona('  Terse  ', '  be brief  ')])).toEqual([{ name: 'Terse', prompt: '  be brief  ' }]);
  });
});

describe('validate', () => {
  it('accepts valid personas, an empty list, and empty instructions', () => {
    expect(validate(fromConfig(SAVED))).toBeNull();
    expect(validate([])).toBeNull();
    expect(validate([makePersona('Blank')])).toBeNull();
  });

  it('requires a name', () => {
    expect(validate([makePersona('   ')])).toMatch(/needs a name/);
  });

  it('rejects duplicate names case-insensitively', () => {
    expect(validate([makePersona('Pirate'), makePersona(' pirate ')])).toMatch(/unique/);
  });

  it('reserves the built-in persona name', () => {
    expect(validate([makePersona(DEFAULT_PERSONA_NAME)])).toMatch(/built-in/);
    expect(validate([makePersona(` ${DEFAULT_PERSONA_NAME.toLowerCase()} `)])).toMatch(/built-in/);
  });
});

describe('resolveActive', () => {
  it('keeps the active persona when it is unchanged', () => {
    expect(resolveActive(fromConfig(SAVED), 'Pirate')).toBe('Pirate');
  });

  it('follows the active persona across a rename', () => {
    const editor = fromConfig(SAVED).map((p) => p.name === 'Pirate' ? { ...p, name: 'Captain' } : p);
    expect(resolveActive(editor, 'pirate')).toBe('Captain');
  });

  it("falls back to '' (the default persona) when the active one was deleted", () => {
    const editor = fromConfig(SAVED).filter((p) => p.name !== 'Pirate');
    expect(resolveActive(editor, 'Pirate')).toBe('');
  });

  it("stays '' when the default persona (or nothing) was active", () => {
    expect(resolveActive(fromConfig(SAVED), DEFAULT_PERSONA_NAME)).toBe('');
    expect(resolveActive(fromConfig(SAVED), '')).toBe('');
  });

  it("is '' when no personas remain", () => {
    expect(resolveActive([], 'Pirate')).toBe('');
  });

  it('does not let a new row that reuses the active name steal the selection after a rename', () => {
    const editor = fromConfig(SAVED).map((p) => p.name === 'Pirate' ? { ...p, name: 'Captain' } : p);
    editor.push(makePersona('Pirate'));
    expect(resolveActive(editor, 'Pirate')).toBe('Captain');
  });
});

describe('markSaved', () => {
  it('trims the name, keeps the id, and resets originalName to the saved name', () => {
    const row = makePersona(' New ', 'x');
    const [saved] = markSaved([row]);
    expect(saved).toMatchObject({ id: row.id, name: 'New', originalName: 'New', prompt: 'x' });
  });
});
