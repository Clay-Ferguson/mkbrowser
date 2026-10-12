/**
 * Front-matter decorations in the editor: each property line splits into a green `key:` and a
 * normally-colored value; the `id:` line and the `---` delimiters keep their whole-line marks.
 */
import { describe, it, expect } from 'vitest';
import { Text } from '@codemirror/state';
import { buildFrontMatterDecorations } from '../src/renderer/editor/editorFrontMatterUtil';

type Mark = [text: string, cls: string];

// Decorations as (covered text, class) pairs, in document order.
function marks(lines: string[]): Mark[] {
  const doc = Text.of(lines);
  const out: Mark[] = [];
  buildFrontMatterDecorations(doc).between(0, doc.length, (from, to, deco) => {
    out.push([doc.sliceString(from, to), (deco.spec as { class: string }).class]);
  });
  return out;
}

const DELIM: Mark = ['---', 'cm-front-matter-delim'];

describe('buildFrontMatterDecorations', () => {
  it('splits a property line into key and value', () => {
    expect(marks(['---', 'title: Hello', '---', 'Body'])).toEqual([
      DELIM,
      ['title:', 'cm-front-matter-key'],
      [' Hello', 'cm-front-matter-value'],
      DELIM,
    ]);
  });

  it('keeps the id line as a single gray mark', () => {
    expect(marks(['---', 'id: abc', '---'])).toEqual([DELIM, ['id: abc', 'cm-front-matter-id'], DELIM]);
  });

  it('marks only the key when the value is empty', () => {
    expect(marks(['---', 'tags:', '---'])).toEqual([DELIM, ['tags:', 'cm-front-matter-key'], DELIM]);
  });

  it('treats a list item line as all value', () => {
    expect(marks(['---', 'tags:', '  - item', '---'])).toEqual([
      DELIM,
      ['tags:', 'cm-front-matter-key'],
      ['  - item', 'cm-front-matter-value'],
      DELIM,
    ]);
  });

  it('starts a nested key after its indentation', () => {
    expect(marks(['---', 'obj:', '  sub: x', '---'])).toEqual([
      DELIM,
      ['obj:', 'cm-front-matter-key'],
      ['sub:', 'cm-front-matter-key'],
      [' x', 'cm-front-matter-value'],
      DELIM,
    ]);
  });

  it('ends the key at the first colon so a URL value stays whole', () => {
    expect(marks(['---', 'url: http://x.com:80', '---'])).toEqual([
      DELIM,
      ['url:', 'cm-front-matter-key'],
      [' http://x.com:80', 'cm-front-matter-value'],
      DELIM,
    ]);
  });

  it('decorates only the opening delimiter when there is no closing one', () => {
    expect(marks(['---', 'title: Hello', 'Body'])).toEqual([DELIM]);
  });

  it('returns nothing without front matter', () => {
    expect(marks(['title: Hello', 'Body'])).toEqual([]);
  });
});
