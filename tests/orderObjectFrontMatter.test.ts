/**
 * Saving a file that holds an object puts its front matter in canonical order
 * (`orderObjectFrontMatter`): `id`, then `type` and the type's properties in definition order,
 * then every other key alphabetically — moving whole lines, never re-serializing values.
 */
import { describe, it, expect } from 'vitest';
import { orderObjectFrontMatter } from '../src/shared/objects/userTypes';
import type { TypeDefinitions } from '../src/shared/shared';

const DEFS: TypeDefinitions = {
  person: {
    properties: {
      name: { description: '', type: 'text' },
      email: { description: '', type: 'email' },
      notes: { description: '', type: 'text' },
    },
  },
};

const order = (fm: string, body = 'Body.\n') => orderObjectFrontMatter(`---\n${fm}\n---\n${body}`, DEFS);

describe('orderObjectFrontMatter', () => {
  it('puts id first, then the object in definition order, then the rest alphabetically', () => {
    expect(order('zeta: 1\nemail: a@b.c\ntags: [x]\nname: Ann\nid: ABC\ntype: person\nalpha: 2'))
      .toBe('---\nid: ABC\ntype: person\nname: Ann\nemail: a@b.c\nalpha: 2\ntags: [x]\nzeta: 1\n---\nBody.\n');
  });

  it('moves multi-line values, block scalars and trailing comments with their key, verbatim', () => {
    const fm = 'notes: |\n  line one\n  line two\nlist:\n  - a\n  - b\n# about name\nname: "Ann"\ntype: person\ndue: 2026-10-12';
    expect(order(fm)).toBe(
      '---\ntype: person\nname: "Ann"\nnotes: |\n  line one\n  line two\ndue: 2026-10-12\nlist:\n  - a\n  - b\n# about name\n---\nBody.\n',
    );
  });

  it('keeps leading comments at the top', () => {
    expect(order('# header\nname: Ann\ntype: person')).toBe('---\n# header\ntype: person\nname: Ann\n---\nBody.\n');
  });

  it('returns the document unchanged when already in order', () => {
    const doc = '---\nid: X\ntype: person\nname:  Ann \nother: 1\n---\r\nBody.\r\n';
    expect(orderObjectFrontMatter(doc, DEFS)).toBe(doc);
  });

  it('leaves front matter without an object untouched', () => {
    const doc = '---\nzeta: 1\nalpha: 2\n---\nBody.';
    expect(orderObjectFrontMatter(doc, DEFS)).toBe(doc);
    const unknownType = '---\nname: Ann\ntype: robot\n---\nBody.';
    expect(orderObjectFrontMatter(unknownType, DEFS)).toBe(unknownType);
  });

  it('leaves malformed, flow-style, and fence-less documents untouched', () => {
    for (const doc of ['---\nname: [\ntype: person\n---\nB', '---\n{name: Ann, type: person}\n---\nB', 'No front matter.']) {
      expect(orderObjectFrontMatter(doc, DEFS)).toBe(doc);
    }
  });
});
