import { describe, it, expect } from 'vitest';
import {
  fromTypeDefs,
  toTypeDefs,
  dropBlankProperties,
  validate,
  newEditorType,
  newEditorProperty,
  type EditorType,
} from '../src/components/views/typesEditorModel';
import type { TypeDefinitions } from '../src/shared/shared';

function makeType(name: string, props: [string, string][] = [], description = ''): EditorType {
  return {
    ...newEditorType(),
    name,
    description,
    properties: props.map(([n, d]) => ({ ...newEditorProperty(), name: n, description: d })),
  };
}

describe('fromTypeDefs / toTypeDefs', () => {
  const defs: TypeDefinitions = {
    person: {
      description: 'A contact',
      properties: {
        name: { description: 'Full name', type: 'text' },
        cell_phone: { description: 'Mobile', type: 'url', domain: 'string' },
      },
      label: 'Person',
    },
    note: { properties: {} },
  };

  it('round-trips, preserving key order and unknown keys', () => {
    const back = toTypeDefs(fromTypeDefs(defs));
    expect(back).toEqual(defs);
    expect(Object.keys(back)).toEqual(['person', 'note']);
    expect(Object.keys(back.person!.properties)).toEqual(['name', 'cell_phone']);
  });

  it('assigns unique row ids', () => {
    const editor = fromTypeDefs(defs);
    const ids = [...editor.map((t) => t.id), ...editor.flatMap((t) => t.properties.map((p) => p.id))];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('flattens multi-line descriptions', () => {
    const editor = fromTypeDefs({ t: { description: 'a\nb', properties: { p: { description: 'c\nd\n', type: 'text' } } } });
    expect(editor[0]!.description).toBe('a b');
    expect(editor[0]!.properties[0]!.description).toBe('c d');
  });

  it('trims names and omits an empty type description', () => {
    const out = toTypeDefs([makeType('  t  ', [[' p ', ' d ']], '   ')]);
    expect(out).toEqual({ t: { properties: { p: { description: 'd', type: 'text' } } } });
  });

  it('carries the property type through, separate from extra keys', () => {
    const editor = fromTypeDefs({ t: { properties: { site: { description: '', type: 'url', domain: 'x' } } } });
    expect(editor[0]!.properties[0]!.type).toBe('url');
    expect(editor[0]!.properties[0]!.extra).toEqual({ domain: 'x' });
  });

  it('defaults a new property to the text type', () => {
    expect(newEditorProperty().type).toBe('text');
  });
});

describe('dropBlankProperties', () => {
  it('drops properties with neither name nor description', () => {
    const out = dropBlankProperties([makeType('t', [['', ''], ['  ', ' '], ['a', ''], ['', 'desc']])]);
    expect(out[0]!.properties.map((p) => [p.name, p.description])).toEqual([['a', ''], ['', 'desc']]);
  });
});

describe('validate', () => {
  it('accepts a valid model', () => {
    expect(validate([makeType('person', [['name', ''], ['cell_phone', 'x']]), makeType('_note')])).toBeNull();
    expect(validate([])).toBeNull();
  });

  it('rejects an empty type name', () => {
    expect(validate([makeType('  ')])).toMatch(/cannot be empty/);
  });

  it('rejects invalid type names', () => {
    expect(validate([makeType('9lives')])).toMatch(/Invalid type name "9lives"/);
    expect(validate([makeType('my type')])).toMatch(/Invalid type name/);
    expect(validate([makeType('a-b')])).toMatch(/Invalid type name/);
  });

  it('rejects duplicate type names (after trimming)', () => {
    expect(validate([makeType('a'), makeType(' a ')])).toMatch(/must be unique/);
  });

  it('rejects a property with a description but no name', () => {
    expect(validate([makeType('t', [['', 'desc']])])).toMatch(/need a name/);
  });

  it('rejects invalid property names', () => {
    expect(validate([makeType('t', [['bad name', '']])])).toMatch(/Invalid property name "bad name" in "t"/);
  });

  it('rejects the reserved property name "type"', () => {
    expect(validate([makeType('t', [['type', '']])])).toMatch(/reserved/);
  });

  it('rejects duplicate property names within a type', () => {
    expect(validate([makeType('t', [['a', ''], ['a', '']])])).toMatch(/Duplicate property names in type "t"/);
  });

  it('allows the same property name in different types', () => {
    expect(validate([makeType('a', [['name', '']]), makeType('b', [['name', '']])])).toBeNull();
  });
});
