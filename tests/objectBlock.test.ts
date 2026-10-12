import { describe, it, expect } from 'vitest';
import { findTopLevelKeys, readTextFields } from '../src/shared/objects/objectBlock';

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
// findTopLevelKeys
// ---------------------------------------------------------------------------

describe('findTopLevelKeys', () => {
  /** The located keys, each as the exact text its range covers. */
  const located = (code: string) => findTopLevelKeys(code).map(({ key, from, to }) => [key, code.slice(from, to)]);

  it('locates each key at the start of a line', () => {
    expect(located('type: person\nname: Clay\nemail:')).toEqual([
      ['type', 'type'],
      ['name', 'name'],
      ['email', 'email'],
    ]);
  });

  it('skips indented lines: block scalar bodies, nested mappings and list items', () => {
    const code = 'address: |\n  street: 1 Main St\n  city: Dallas\nnested:\n  inner: 1\nlist:\n  - a: 1\nlast: x';
    expect(located(code).map(([key]) => key)).toEqual(['address', 'nested', 'list', 'last']);
  });

  it('covers the quotes of a quoted key but reports the key without them', () => {
    expect(located('"full name": Clay\n\'nick\': C')).toEqual([
      ['full name', '"full name"'],
      ['nick', "'nick'"],
    ]);
  });

  it('allows spaces before the colon and stops at the first colon', () => {
    expect(located('web site : http://example.com')).toEqual([['web site', 'web site']]);
  });

  it('ignores comments, blank lines, document markers and flow syntax', () => {
    expect(located('# note: x\n\n---\n{a: 1}\n- item: 1\nplain text')).toEqual([]);
  });

  it('does not treat a colon without a following space as a key', () => {
    expect(located('time:12:30\nurl:http://x')).toEqual([]);
  });
});
