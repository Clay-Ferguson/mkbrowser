import { describe, it, expect } from 'vitest';
import {
  fromConfig,
  toConfig,
  validate,
  newEditorModel,
  resolveActive,
  markSaved,
  parsePrice,
  type EditorModel,
} from '../src/components/views/aiModelsEditorModel';
import type { AIModelConfig } from '../src/shared/shared';

function makeModel(name: string, overrides: Partial<EditorModel> = {}): EditorModel {
  return { ...newEditorModel(), name, model: `${name}-id`, ...overrides };
}

const SAVED: AIModelConfig[] = [
  { name: 'Claude', provider: 'ANTHROPIC', model: 'claude-x', inputPer1M: 1, outputPer1M: 5, vision: true },
  { name: 'Local', provider: 'OPENAI', model: 'local', baseUrl: 'http://localhost:8080/v1', inputPer1M: 0, outputPer1M: 0, vision: false },
];

describe('fromConfig / toConfig', () => {
  it('round-trips the persisted models unchanged', () => {
    expect(toConfig(fromConfig(SAVED))).toEqual(SAVED);
  });

  it('records each loaded row\'s originalName and gives every row a unique id', () => {
    const editor = fromConfig(SAVED);
    expect(editor.map((m) => m.originalName)).toEqual(['Claude', 'Local']);
    expect(new Set(editor.map((m) => m.id)).size).toBe(2);
  });

  it('trims text fields, parses prices, and omits a blank Base URL', () => {
    const [out] = toConfig([makeModel('  Spaced  ', { model: ' id ', baseUrl: '   ', inputText: ' 2.5 ', outputText: '10' })]);
    expect(out).toEqual({ name: 'Spaced', provider: 'ANTHROPIC', model: 'id', vision: false, inputPer1M: 2.5, outputPer1M: 10 });
    expect(out).not.toHaveProperty('baseUrl');
  });
});

describe('parsePrice', () => {
  it.each([['0', 0], ['3.25', 3.25], [' 7 ', 7]])('parses %j', (text, n) => {
    expect(parsePrice(text)).toBe(n);
  });
  it.each(['', '  ', '-1', 'abc', 'NaN', 'Infinity'])('rejects %j', (text) => {
    expect(parsePrice(text)).toBeNull();
  });
});

describe('validate', () => {
  it('accepts valid models (and an empty list)', () => {
    expect(validate(fromConfig(SAVED))).toBeNull();
    expect(validate([])).toBeNull();
  });

  it('requires a name', () => {
    expect(validate([makeModel('  ')])).toMatch(/needs a name/);
  });

  it('rejects duplicate names case-insensitively', () => {
    expect(validate([makeModel('Claude'), makeModel(' claude ')])).toMatch(/unique/);
  });

  it('requires a Model ID', () => {
    expect(validate([makeModel('A', { model: ' ' })])).toMatch(/Model ID/);
  });

  it('rejects bad prices', () => {
    expect(validate([makeModel('A', { inputText: 'x' })])).toMatch(/Input/);
    expect(validate([makeModel('A', { outputText: '-2' })])).toMatch(/Output/);
  });

  it('accepts a blank or http(s) Base URL and rejects anything else', () => {
    expect(validate([makeModel('A', { baseUrl: '' })])).toBeNull();
    expect(validate([makeModel('A', { baseUrl: 'https://api.example.com/v1' })])).toBeNull();
    expect(validate([makeModel('A', { baseUrl: 'localhost:8080' })])).toMatch(/Base URL/);
    expect(validate([makeModel('A', { baseUrl: 'ftp://host' })])).toMatch(/Base URL/);
  });
});

describe('resolveActive', () => {
  it('keeps the active model when it is unchanged', () => {
    expect(resolveActive(fromConfig(SAVED), 'Local')).toBe('Local');
  });

  it('follows the active model across a rename', () => {
    const editor = fromConfig(SAVED).map((m) => m.name === 'Local' ? { ...m, name: 'Llama Local' } : m);
    expect(resolveActive(editor, 'local')).toBe('Llama Local');
  });

  it('falls back to the first model by name when the active one was deleted', () => {
    const editor = [...fromConfig(SAVED).filter((m) => m.name !== 'Claude'), makeModel('Alpha')];
    expect(resolveActive(editor, 'Claude')).toBe('Alpha');
  });

  it('makes the first model active when none was active (e.g. the very first save)', () => {
    expect(resolveActive([makeModel('Zeta'), makeModel('Beta')], '')).toBe('Beta');
  });

  it("is '' when no models remain", () => {
    expect(resolveActive([], 'Claude')).toBe('');
  });

  it('does not let a new row that merely reuses the active name steal the selection after a rename', () => {
    const editor = fromConfig(SAVED).map((m) => m.name === 'Local' ? { ...m, name: 'Renamed' } : m);
    editor.push(makeModel('Local'));
    expect(resolveActive(editor, 'Local')).toBe('Renamed');
  });
});

describe('markSaved', () => {
  it('trims fields, keeps ids, and resets originalName to the saved name', () => {
    const [row] = [makeModel(' New ', { model: ' m ' })];
    const [saved] = markSaved([row!]);
    expect(saved).toMatchObject({ id: row!.id, name: 'New', originalName: 'New', model: 'm' });
  });
});
