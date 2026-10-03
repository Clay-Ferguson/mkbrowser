import { describe, it, expect } from 'vitest';
import { parseObjectBlock, readTextFields } from '../src/shared/objects/objectBlock';
import { parsePerson } from '../src/shared/objects/person';

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

// ---------------------------------------------------------------------------
// parsePerson (through parseObjectBlock, as the renderer will use it)
// ---------------------------------------------------------------------------

function person(code: string) {
  const block = parseObjectBlock('yaml', code);
  if (!block) throw new Error('expected an object block');
  return parsePerson(block.data);
}

describe('parsePerson', () => {
  it('reads all seven fields', () => {
    const code = [
      'type: person',
      'name: Clay Ferguson',
      'bd: 1980-05-12',
      'cell_phone: 555-123-4567',
      'other_phone: (555) 987-6543',
      'email: clay@example.com',
      'address: 1 Main St, Dallas, TX',
      'notes: Old friend',
    ].join('\n');
    expect(person(code)).toEqual({
      ok: true,
      value: {
        name: 'Clay Ferguson',
        bd: '1980-05-12',
        cell_phone: '555-123-4567',
        other_phone: '(555) 987-6543',
        email: 'clay@example.com',
        address: '1 Main St, Dallas, TX',
        notes: 'Old friend',
      },
    });
  });

  it('accepts a partial person', () => {
    expect(person('type: person\nemail: clay@example.com')).toEqual({
      ok: true,
      value: { email: 'clay@example.com' },
    });
  });

  it('accepts an unquoted all-digit phone number', () => {
    expect(person('type: person\ncell_phone: 5551234567')).toEqual({
      ok: true,
      value: { cell_phone: '5551234567' },
    });
  });

  it('keeps the line breaks of a multi-line address', () => {
    expect(person('type: person\naddress: |\n  1 Main St\n  Dallas, TX 75001\n')).toEqual({
      ok: true,
      value: { address: '1 Main St\nDallas, TX 75001' },
    });
  });

  it('keeps the line breaks of multi-line notes', () => {
    expect(person('type: person\nnotes: |\n  Met at a conference.\n  Prefers email.\n')).toEqual({
      ok: true,
      value: { notes: 'Met at a conference.\nPrefers email.' },
    });
  });

  it('keeps a birthday as the text it was written in', () => {
    expect(person('type: person\nbd: 1980-05-12')).toEqual({ ok: true, value: { bd: '1980-05-12' } });
    expect(person('type: person\nbd: May 12')).toEqual({ ok: true, value: { bd: 'May 12' } });
  });

  it('ignores extra properties', () => {
    expect(person('type: person\nname: Clay\nnickname: C\ntags: [a, b]')).toEqual({
      ok: true,
      value: { name: 'Clay' },
    });
  });

  it('rejects a field that is not text', () => {
    expect(person('type: person\nname: Clay\naddress:\n  street: 1 Main St')).toEqual({
      ok: false,
      error: 'address must be text',
    });
  });

  it('rejects a person with none of the fields', () => {
    const result = person('type: person\nnickname: C');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('name');
  });

  it('rejects a person whose fields are all blank', () => {
    expect(person('type: person\nname: ""\nemail:').ok).toBe(false);
  });
});
