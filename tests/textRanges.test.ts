import { describe, it, expect } from 'vitest';
import { buildSearchPattern, findSpans } from '../src/renderer/textRanges';

// findSpans maps matches in a run of text nodes (given here as plain strings) back to
// (piece, offset) pairs; findTextRanges turns those into DOM Ranges. These pieces are how
// "To remove the highlight, open the **Search** menu and click **Clear Highlight**." renders.
const PIECES = ['To remove the highlight, open the ', 'Search', ' menu and click ', 'Clear Highlight', '.'];

function spans(pieces: string[], searchText: string) {
  const pattern = buildSearchPattern(searchText);
  if (!pattern) throw new Error('expected a pattern');
  return findSpans(pieces, pattern);
}

/** The matched text a span covers, rebuilt from the pieces. */
function textOf(pieces: string[], s: ReturnType<typeof spans>[number]): string {
  if (s.startPiece === s.endPiece) return pieces[s.startPiece]!.slice(s.startOffset, s.endOffset);
  return pieces[s.startPiece]!.slice(s.startOffset)
    + pieces.slice(s.startPiece + 1, s.endPiece).join('')
    + pieces[s.endPiece]!.slice(0, s.endOffset);
}

describe('buildSearchPattern', () => {
  it('rejects empty and whitespace-only text', () => {
    expect(buildSearchPattern('')).toBeNull();
    expect(buildSearchPattern('   ')).toBeNull();
  });

  it('treats regex characters literally', () => {
    expect(spans(["prop('due', 'ts')"], "prop('due'")).toHaveLength(1);
    expect(spans(['a.b'], 'a.b')).toHaveLength(1);
    expect(spans(['axb'], 'a.b')).toHaveLength(0);
  });
});

describe('findSpans', () => {
  it('finds a match inside a single piece', () => {
    expect(spans(PIECES, 'Clear Highlight')).toEqual([
      { startPiece: 3, startOffset: 0, endPiece: 3, endOffset: 15 },
    ]);
  });

  it('finds a match that crosses two pieces', () => {
    const [s, ...rest] = spans(PIECES, 'click Clear');
    expect(rest).toHaveLength(0);
    expect(s).toMatchObject({ startPiece: 2, endPiece: 3, endOffset: 5 });
    expect(textOf(PIECES, s!)).toBe('click Clear');
  });

  it('finds a match that crosses three pieces', () => {
    const [s] = spans(PIECES, 'the Search menu');
    expect(s).toMatchObject({ startPiece: 0, endPiece: 2 });
    expect(textOf(PIECES, s!)).toBe('the Search menu');
  });

  it('assigns a match ending at a piece boundary to the piece holding its last character', () => {
    expect(spans(PIECES, 'Search')).toEqual([
      { startPiece: 1, startOffset: 0, endPiece: 1, endOffset: 6 },
    ]);
  });

  it('is case-insensitive', () => {
    const [s] = spans(PIECES, 'CLICK clear');
    expect(textOf(PIECES, s!)).toBe('click Clear');
  });

  it('lets a space match a soft line break or a run of whitespace', () => {
    const pieces = ['open the\nSearch', '  menu'];
    expect(textOf(pieces, spans(pieces, 'the Search')[0]!)).toBe('the\nSearch');
    expect(textOf(pieces, spans(pieces, 'Search menu')[0]!)).toBe('Search  menu');
  });

  it('reports every match in order', () => {
    const pieces = ['foo ', 'bar', ' foo', 'bar'];
    const found = spans(pieces, 'foobar');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ startPiece: 2, endPiece: 3 });
    expect(spans(pieces, 'foo')).toHaveLength(2);
  });

  it('returns nothing when there is no match', () => {
    expect(spans(PIECES, 'nowhere')).toEqual([]);
    expect(spans([], 'anything')).toEqual([]);
  });
});
