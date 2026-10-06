import { describe, it, expect } from 'vitest';
import { extractLinkDestinations } from '../src/shared/markdownLinks';

/** Just the destinations, for compact assertions. */
function dests(content: string): string[] {
  return extractLinkDestinations(content).map(d => d.dest);
}

describe('extractLinkDestinations', () => {
  it('finds inline links, with or without a title', () => {
    expect(dests('See [a](a.md) and [b](sub/b.md "Title") and [c](../c.md \'t\').'))
      .toEqual(['a.md', 'sub/b.md', '../c.md']);
  });

  it('finds angle-bracket destinations (which may contain spaces)', () => {
    expect(dests('[x](<my notes/x y.md>)')).toEqual(['my notes/x y.md']);
  });

  it('keeps percent-encoding and heading fragments for the resolver', () => {
    expect(dests('[x](my%20note.md#intro)')).toEqual(['my%20note.md#intro']);
  });

  it('finds reference definitions', () => {
    expect(dests('Read [the doc][d].\n\n[d]: docs/guide.md "Guide"\n  [e]: <e f.md>'))
      .toEqual(['docs/guide.md', 'e f.md']);
  });

  it('finds wikilinks, dropping alias and section, and flags them', () => {
    expect(extractLinkDestinations('[[note]] [[dir/other|Alias]] [[third#Heading]] [[#local]]')).toEqual([
      { dest: 'note', wiki: true },
      { dest: 'dir/other', wiki: true },
      { dest: 'third', wiki: true },
    ]);
  });

  it('skips images and embeds', () => {
    expect(dests('![pic](pic.png) ![[embed.png]] [real](real.md)')).toEqual(['real.md']);
  });

  it('reads a linked image as a link to its target', () => {
    expect(dests('[![badge](badge.png)](target.md)')).toEqual(['target.md']);
  });

  it('skips external URLs and in-page anchors', () => {
    expect(dests('[w](https://x.com) [m](mailto:a@b.c) [f](file:///etc/x.md) [h](#top) [ok](ok.md)'))
      .toEqual(['ok.md']);
  });

  it('keeps a Windows absolute path (a drive letter is not a URL scheme)', () => {
    expect(dests('[w](C:/notes/a.md)')).toEqual(['C:/notes/a.md']);
  });

  it('skips links inside fenced code blocks and inline code', () => {
    const md = 'before [a](a.md)\n```\n[b](b.md)\n[[c]]\n```\n`[d](d.md)` after [e](e.md)';
    expect(dests(md)).toEqual(['a.md', 'e.md']);
  });

  it('allows balanced parentheses in a bare destination', () => {
    expect(dests('[x](notes/a_(b).md)')).toEqual(['notes/a_(b).md']);
  });
});
