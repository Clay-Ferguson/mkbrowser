import { describe, it, expect } from 'vitest';
import { parseObjectBlock, readTextFields } from '../src/shared/objects/objectBlock';

// ---------------------------------------------------------------------------
// parseObjectBlock
// ---------------------------------------------------------------------------

describe('parseObjectBlock', () => {
  it('reads a yaml mapping with a string type', () => {
    const code = 'type: person\nname: Clay Ferguson';
    expect(parseObjectBlock('yaml', code)).toEqual({
      type: 'person',
      data: { type: 'person', name: 'Clay Ferguson' },
    });
  });

  it.each(['yml', 'YAML', 'Yml'])('accepts the %s language tag', (language) => {
    expect(parseObjectBlock(language, 'type: person')?.type).toBe('person');
  });

  it('accepts JSON-style flow syntax, which is valid YAML', () => {
    expect(parseObjectBlock('yaml', '{"type": "person", "name": "Clay"}')).toEqual({
      type: 'person',
      data: { type: 'person', name: 'Clay' },
    });
  });

  it('trims the type', () => {
    expect(parseObjectBlock('yaml', 'type: "  person  "')?.type).toBe('person');
  });

  it.each(['', 'json', 'js', 'mermaid', 'yamlish'])('ignores a "%s" block', (language) => {
    expect(parseObjectBlock(language, 'type: person')).toBeNull();
  });

  it.each([
    ['no type property', 'name: Clay'],
    ['a numeric type', 'type: 5'],
    ['a boolean type', 'type: true'],
    ['a null type', 'type:'],
    ['a blank type', 'type: "   "'],
    ['a list type', 'type: [person]'],
    ['a mapping type', 'type:\n  name: person'],
    ['a top-level list', '- type: person'],
    ['a top-level scalar', 'person'],
    ['an empty block', ''],
    ['a comment-only block', '# type: person'],
    ['malformed yaml', 'type: person\n  name: [unclosed'],
    ['several documents', 'type: person\n---\ntype: person'],
  ])('returns null for %s', (_label, code) => {
    expect(parseObjectBlock('yaml', code)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readTextFields
// ---------------------------------------------------------------------------

describe('readTextFields', () => {
  const keys = ['a', 'b'] as const;

  it('returns the listed string fields', () => {
    expect(readTextFields({ a: 'one', b: 'two' }, keys)).toEqual({ ok: true, value: { a: 'one', b: 'two' } });
  });

  it('ignores keys that are not listed', () => {
    expect(readTextFields({ a: 'one', other: ['x'] }, keys)).toEqual({ ok: true, value: { a: 'one' } });
  });

  it('treats missing, null and blank values as absent', () => {
    expect(readTextFields({ a: null, b: '   ' }, keys)).toEqual({ ok: true, value: {} });
  });

  it('trims strings', () => {
    expect(readTextFields({ a: '  one\n' }, keys)).toEqual({ ok: true, value: { a: 'one' } });
  });

  it('converts numbers to text', () => {
    expect(readTextFields({ a: 5551234567, b: 0 }, keys)).toEqual({ ok: true, value: { a: '5551234567', b: '0' } });
  });

  it.each([
    ['a list', ['x']],
    ['a mapping', { x: 1 }],
    ['a boolean', true],
  ])('rejects %s, naming the field', (_label, bad) => {
    expect(readTextFields({ a: 'one', b: bad }, keys)).toEqual({ ok: false, error: 'b must be text' });
  });

  it('does not read inherited properties', () => {
    expect(readTextFields({}, ['toString', 'constructor'] as const)).toEqual({ ok: true, value: {} });
  });
});
