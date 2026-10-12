/**
 * A file's object (its front matter) resolved against user-defined types: validation
 * (`parseGenericObject`), the render decision (`resolveFrontMatterObject`), and which keys the
 * object owns (`objectPropertyKeys`).
 */
import { describe, it, expect } from 'vitest';
import { loadYaml } from '../src/shared/yamlUtil';
import { parseGenericObject, resolveFrontMatterObject, objectPropertyKeys } from '../src/shared/objects/genericObject';
import type { TypeDefinitions } from '../src/shared/shared';
import { PERSON_DEFS } from './fixtures/personTypeDefs';

/** Front matter YAML, parsed to the mapping the app gets from it. */
const fm = (yaml: string) => loadYaml(yaml) as Record<string, unknown>;

/** Parses person front matter and validates it against the person definition. */
function person(yaml: string) {
  return parseGenericObject(PERSON_DEFS.person!, fm(yaml));
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

  it('ignores front-matter keys the type does not define', () => {
    const data = personData('id: abc\ntype: person\nname: Clay\ntags: [a, b]\ndue: 2026-01-01\nnmae: typo');
    expect(data.title?.value).toBe('Clay');
    expect(data.rows).toEqual([]);
    expect(data).not.toHaveProperty('unknown');
  });

  it('rejects a defined property that is not text', () => {
    expect(person('type: person\nname: Clay\naddress:\n  street: 1 Main St')).toEqual({
      ok: false,
      error: 'address must be text',
    });
  });

  it('accepts an object with none of its properties filled in, as an untitled card', () => {
    expect(person('type: person\nname:\nemail: ""')).toEqual({
      ok: true,
      value: { title: { key: 'name', value: '', propertyType: 'text', description: 'Full name' }, rows: [] },
    });
  });

  it('renders a type with no properties as an untitled card', () => {
    const result = parseGenericObject({ properties: {} }, { type: 'thing', extra: 1 });
    expect(result).toEqual({ ok: true, value: { title: null, rows: [] } });
  });
});

describe('resolveFrontMatterObject', () => {
  it('resolves front matter of a defined type to its data', () => {
    const resolved = resolveFrontMatterObject(fm('id: x1\ntype: person\nname: Clay\ntags: [a]'), PERSON_DEFS);
    expect(resolved?.kind).toBe('object');
    if (resolved?.kind !== 'object') return;
    expect(resolved.type).toBe('person');
    expect(resolved.data.title?.value).toBe('Clay');
  });

  it('trims the type', () => {
    expect(resolveFrontMatterObject(fm('type: "  person  "\nname: Clay'), PERSON_DEFS)?.type).toBe('person');
  });

  it('reports a defined type whose values do not fit', () => {
    expect(resolveFrontMatterObject(fm('type: person\naddress: [a, b]'), PERSON_DEFS)).toEqual({
      kind: 'invalid',
      type: 'person',
      error: 'address must be text',
    });
  });

  it('works for any defined type', () => {
    const defs: TypeDefinitions = {
      gadget: { properties: { model: { description: '', type: 'text' }, site: { description: 'Vendor', type: 'url' } } },
    };
    const resolved = resolveFrontMatterObject(fm('type: gadget\nmodel: X1\nsite: example.com'), defs);
    expect(resolved?.kind === 'object' && resolved.data.rows).toEqual([
      { key: 'site', value: 'example.com', propertyType: 'url', description: 'Vendor' },
    ]);
  });

  it.each([
    ['an undefined type', 'type: gadget\nname: x'],
    ['a type that differs only in case', 'type: Person\nname: Clay'],
    ['a type naming an Object.prototype member', 'type: toString\nname: Clay'],
    ['front matter without a type', 'name: Clay'],
    ['a blank type', 'type:\nname: Clay'],
    ['a non-string type', 'type: [person]\nname: Clay'],
  ])('returns null for %s', (_label, yaml) => {
    expect(resolveFrontMatterObject(fm(yaml), PERSON_DEFS)).toBeNull();
  });

  it('returns null when no types are defined', () => {
    expect(resolveFrontMatterObject(fm('type: person\nname: Clay'), {})).toBeNull();
  });
});

describe('objectPropertyKeys', () => {
  it('is `type` plus every property the type defines', () => {
    expect([...objectPropertyKeys(fm('type: person\ntags: [a]\nid: x'), PERSON_DEFS)]).toEqual([
      'type', 'name', 'bd', 'cell_phone', 'other_phone', 'email', 'address', 'notes',
    ]);
  });

  it('is empty when the front matter holds no object', () => {
    expect(objectPropertyKeys(fm('type: gadget\nname: x'), PERSON_DEFS).size).toBe(0);
    expect(objectPropertyKeys(fm('name: x'), PERSON_DEFS).size).toBe(0);
  });
});
