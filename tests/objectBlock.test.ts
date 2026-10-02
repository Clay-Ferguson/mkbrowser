import { describe, it, expect } from 'vitest';
import { parseObjectBlock, readTextFields } from '../src/shared/objects/objectBlock';
import { parsePerson } from '../src/shared/objects/person';

// ---------------------------------------------------------------------------
// parseObjectBlock
// ---------------------------------------------------------------------------

describe('parseObjectBlock', () => {
  it('reads a yaml mapping with a string type', () => {
    const code = 'type: person\nfirst_name: Clay\nlast_name: Ferguson';
    expect(parseObjectBlock('yaml', code)).toEqual({
      type: 'person',
      data: { type: 'person', first_name: 'Clay', last_name: 'Ferguson' },
    });
  });

  it.each(['yml', 'YAML', 'Yml'])('accepts the %s language tag', (language) => {
    expect(parseObjectBlock(language, 'type: person')?.type).toBe('person');
  });

  it('accepts JSON-style flow syntax, which is valid YAML', () => {
    expect(parseObjectBlock('yaml', '{"type": "person", "first_name": "Clay"}')).toEqual({
      type: 'person',
      data: { type: 'person', first_name: 'Clay' },
    });
  });

  it('trims the type', () => {
    expect(parseObjectBlock('yaml', 'type: "  person  "')?.type).toBe('person');
  });

  it.each(['', 'json', 'js', 'mermaid', 'yamlish'])('ignores a "%s" block', (language) => {
    expect(parseObjectBlock(language, 'type: person')).toBeNull();
  });

  it.each([
    ['no type property', 'first_name: Clay'],
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
    ['malformed yaml', 'type: person\n  first_name: [unclosed'],
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
  it('reads all six fields', () => {
    const code = [
      'type: person',
      'first_name: Clay',
      'last_name: Ferguson',
      'cell_phone: 555-123-4567',
      'other_phone: (555) 987-6543',
      'email: clay@example.com',
      'address: 1 Main St, Dallas, TX',
    ].join('\n');
    expect(person(code)).toEqual({
      ok: true,
      value: {
        first_name: 'Clay',
        last_name: 'Ferguson',
        cell_phone: '555-123-4567',
        other_phone: '(555) 987-6543',
        email: 'clay@example.com',
        address: '1 Main St, Dallas, TX',
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

  it('ignores extra properties', () => {
    expect(person('type: person\nfirst_name: Clay\nnickname: C\ntags: [a, b]')).toEqual({
      ok: true,
      value: { first_name: 'Clay' },
    });
  });

  it('rejects a field that is not text', () => {
    expect(person('type: person\nfirst_name: Clay\naddress:\n  street: 1 Main St')).toEqual({
      ok: false,
      error: 'address must be text',
    });
  });

  it('rejects a person with none of the fields', () => {
    const result = person('type: person\nnickname: C');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('first_name');
  });

  it('rejects a person whose fields are all blank', () => {
    expect(person('type: person\nfirst_name: ""\nlast_name:').ok).toBe(false);
  });
});
