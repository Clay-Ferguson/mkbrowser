/**
 * Object blocks resolved against user-defined types: validation (`parseGenericObject`), the
 * render decision (`resolveObjectBlock`), and unknown-key detection lives in
 * objectKeyChecker.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { parseObjectBlock } from '../src/shared/objects/objectBlock';
import { parseGenericObject, resolveObjectBlock } from '../src/shared/objects/genericObject';
import type { TypeDefinitions } from '../src/shared/shared';
import { PERSON_DEFS } from './fixtures/personTypeDefs';

/** Parses a person block and validates it against the person definition. */
function person(code: string) {
  const block = parseObjectBlock('yaml', code);
  if (!block) throw new Error('expected an object block');
  return parseGenericObject(PERSON_DEFS.person!, block.data);
}

/** The validated data of a person block (fails the test if it is invalid). */
function personData(code: string) {
  const result = person(code);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** Rows as [key, value] pairs. */
const pairs = (rows: { key: string; value: string }[]) => rows.map(({ key, value }) => [key, value]);

describe('parseGenericObject', () => {
  it('makes the first property the title and lists the rest in definition order', () => {
    const data = personData([
      'type: person',
      'notes: Old friend',
      'email: clay@example.com',
      'name: Clay Ferguson',
      'bd: 1980-05-12',
      'cell_phone: 555-123-4567',
      'other_phone: (555) 987-6543',
      'address: 1 Main St, Dallas, TX',
    ].join('\n'));
    expect(data.title).toEqual({ key: 'name', value: 'Clay Ferguson', propertyType: 'text', description: 'Full name' });
    expect(pairs(data.rows)).toEqual([
      ['bd', '1980-05-12'],
      ['cell_phone', '555-123-4567'],
      ['other_phone', '(555) 987-6543'],
      ['email', 'clay@example.com'],
      ['address', '1 Main St, Dallas, TX'],
      ['notes', 'Old friend'],
    ]);
    expect(data.unknown).toEqual([]);
  });

  it('looks up each property type from the definition', () => {
    const data = personData('type: person\nemail: a@b.c\naddress: 1 Main St\nbd: May 12');
    expect(data.rows.map((r) => [r.key, r.propertyType])).toEqual([
      ['bd', 'text'],
      ['email', 'email'],
      ['address', 'address'],
    ]);
  });

  it('leaves out properties with no value, and gives a blank title an empty value', () => {
    const data = personData('type: person\nemail: clay@example.com\nnotes: ""');
    expect(data.title?.value).toBe('');
    expect(pairs(data.rows)).toEqual([['email', 'clay@example.com']]);
  });

  it('accepts an unquoted all-digit phone number', () => {
    expect(pairs(personData('type: person\ncell_phone: 5551234567').rows)).toEqual([['cell_phone', '5551234567']]);
  });

  it('keeps the line breaks of a multi-line value', () => {
    expect(pairs(personData('type: person\naddress: |\n  1 Main St\n  Dallas, TX 75001\n').rows))
      .toEqual([['address', '1 Main St\nDallas, TX 75001']]);
  });

  it('lists unknown keys last, in block order, with their values as text', () => {
    const data = personData('nickname: C\ntype: person\nname: Clay\ntags: [a, b]\nzip: 75001\nempty:');
    expect(data.unknown).toEqual([
      { key: 'nickname', value: 'C' },
      { key: 'tags', value: '["a","b"]' },
      { key: 'zip', value: '75001' },
      { key: 'empty', value: '' },
    ]);
  });

  it('rejects a defined property that is not text', () => {
    expect(person('type: person\nname: Clay\naddress:\n  street: 1 Main St')).toEqual({
      ok: false,
      error: 'address must be text',
    });
  });

  it('rejects a block with none of its properties filled in', () => {
    const result = person('type: person\nnickname: C');
    expect(result).toEqual({ ok: false, error: 'needs at least one of name, bd, cell_phone, other_phone, email, address, notes' });
    expect(person('type: person\nname: ""\nemail:').ok).toBe(false);
  });

  it('renders a type with no properties as an untitled card', () => {
    const result = parseGenericObject({ properties: {} }, { type: 'thing', extra: 1 });
    expect(result).toEqual({ ok: true, value: { title: null, rows: [], unknown: [{ key: 'extra', value: '1' }] } });
  });
});

describe('resolveObjectBlock', () => {
  it('resolves a valid block of a defined type to its data', () => {
    const resolved = resolveObjectBlock('yaml', 'type: person\nname: Clay\nnickname: C', PERSON_DEFS);
    expect(resolved?.kind).toBe('object');
    if (resolved?.kind !== 'object') return;
    expect(resolved.type).toBe('person');
    expect(resolved.data.title?.value).toBe('Clay');
    expect(resolved.data.unknown).toEqual([{ key: 'nickname', value: 'C' }]);
  });

  it('reports a defined type whose values do not fit', () => {
    expect(resolveObjectBlock('yaml', 'type: person\naddress: [a, b]', PERSON_DEFS)).toEqual({
      kind: 'invalid',
      type: 'person',
      error: 'address must be text',
    });
  });

  it('works for any defined type', () => {
    const defs: TypeDefinitions = {
      gadget: { properties: { model: { description: '', type: 'text' }, site: { description: 'Vendor', type: 'url' } } },
    };
    const resolved = resolveObjectBlock('yaml', 'type: gadget\nmodel: X1\nsite: example.com', defs);
    expect(resolved?.kind === 'object' && resolved.data.rows).toEqual([
      { key: 'site', value: 'example.com', propertyType: 'url', description: 'Vendor' },
    ]);
  });

  it.each([
    ['an undefined type', 'yaml', 'type: gadget\nname: x'],
    ['a type that differs only in case', 'yaml', 'type: Person\nname: Clay'],
    ['a type naming an Object.prototype member', 'yaml', 'type: toString\nname: Clay'],
    ['yaml without a type', 'yaml', 'name: Clay'],
    ['malformed yaml', 'yaml', 'type: person\n name: [x'],
    ['a non-yaml language', 'json', '{"type": "person", "name": "Clay"}'],
  ])('returns null for %s', (_label, language, code) => {
    expect(resolveObjectBlock(language, code, PERSON_DEFS)).toBeNull();
  });

  it('returns null for every block when no types are defined', () => {
    expect(resolveObjectBlock('yaml', 'type: person\nname: Clay', {})).toBeNull();
  });
});
