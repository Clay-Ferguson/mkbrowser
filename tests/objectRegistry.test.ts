import { describe, it, expect } from 'vitest';
import { resolveObjectBlock } from '../src/components/objects/objectRegistry';
import PersonObject from '../src/components/objects/PersonObject';

describe('resolveObjectBlock', () => {
  it('resolves a valid person to its component and validated data', () => {
    const resolved = resolveObjectBlock('yaml', 'type: person\nfirst_name: Clay\nnickname: C');
    expect(resolved?.kind).toBe('object');
    if (resolved?.kind !== 'object') return;
    expect(resolved.type).toBe('person');
    expect(resolved.element.type).toBe(PersonObject);
    expect(resolved.element.props).toEqual({ data: { first_name: 'Clay' } });
  });

  it('reports a registered type whose fields do not fit', () => {
    expect(resolveObjectBlock('yaml', 'type: person\naddress: [a, b]')).toEqual({
      kind: 'invalid',
      type: 'person',
      error: 'address must be text',
    });
  });

  it.each([
    ['an unregistered type', 'yaml', 'type: gadget\nname: x'],
    ['a type that differs only in case', 'yaml', 'type: Person\nfirst_name: Clay'],
    ['a type naming an Object.prototype member', 'yaml', 'type: toString\nfirst_name: Clay'],
    ['yaml without a type', 'yaml', 'first_name: Clay'],
    ['malformed yaml', 'yaml', 'type: person\n first_name: [x'],
    ['a non-yaml language', 'json', '{"type": "person", "first_name": "Clay"}'],
  ])('returns null for %s', (_label, language, code) => {
    expect(resolveObjectBlock(language, code)).toBeNull();
  });
});
