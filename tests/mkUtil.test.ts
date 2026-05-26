import { describe, it, expect } from 'vitest';
import {
  preprocessMathEscapes,
  stripHtmlComments,
  preprocessWikiLinks,
  splitOnColumnBreaks,
} from '../src/utils/mkUtil';

// ---------------------------------------------------------------------------
// preprocessMathEscapes
// ---------------------------------------------------------------------------

describe('preprocessMathEscapes', () => {
  it('replaces escaped dollar signs with HTML entity', () => {
    expect(preprocessMathEscapes('cost is \\$5')).toBe('cost is &#36;5');
  });

  it('replaces multiple escaped dollar signs', () => {
    expect(preprocessMathEscapes('\\$10 and \\$20')).toBe('&#36;10 and &#36;20');
  });

  it('leaves unescaped dollar signs untouched', () => {
    expect(preprocessMathEscapes('$5')).toBe('$5');
  });

  it('returns empty string unchanged', () => {
    expect(preprocessMathEscapes('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// stripHtmlComments
// ---------------------------------------------------------------------------

describe('stripHtmlComments', () => {
  it('removes a single inline comment', () => {
    expect(stripHtmlComments('hello <!-- world --> there')).toBe('hello  there');
  });

  it('removes multiple comments', () => {
    expect(stripHtmlComments('a <!-- 1 --> b <!-- 2 --> c')).toBe('a  b  c');
  });

  it('removes multiline comments', () => {
    const input = 'before\n<!-- line1\nline2 -->\nafter';
    expect(stripHtmlComments(input)).toBe('before\n\nafter');
  });

  it('leaves content without comments unchanged', () => {
    expect(stripHtmlComments('no comments here')).toBe('no comments here');
  });

  it('returns empty string unchanged', () => {
    expect(stripHtmlComments('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// preprocessWikiLinks
// ---------------------------------------------------------------------------

describe('preprocessWikiLinks', () => {
  it('converts [[file]] to [file](file)', () => {
    expect(preprocessWikiLinks('[[readme]]')).toBe('[readme](readme)');
  });

  it('converts [[file|alias]] to [alias](file)', () => {
    expect(preprocessWikiLinks('[[notes/index|Home]]')).toBe('[Home](notes/index)');
  });

  it('converts [[file#section]] to [file#section](file#section)', () => {
    expect(preprocessWikiLinks('[[guide#intro]]')).toBe('[guide#intro](guide#intro)');
  });

  it('converts [[file#section|desc]] to [desc](file#section)', () => {
    expect(preprocessWikiLinks('[[guide#intro|Introduction]]')).toBe('[Introduction](guide#intro)');
  });

  it('converts multiple wikilinks in one pass', () => {
    const input = '[[a]] and [[b|B]]';
    expect(preprocessWikiLinks(input)).toBe('[a](a) and [B](b)');
  });

  it('trims whitespace around target and alias', () => {
    expect(preprocessWikiLinks('[[ file | label ]]')).toBe('[label](file)');
  });

  it('leaves regular markdown links untouched', () => {
    expect(preprocessWikiLinks('[link](url)')).toBe('[link](url)');
  });

  it('returns empty string unchanged', () => {
    expect(preprocessWikiLinks('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// splitOnColumnBreaks
// ---------------------------------------------------------------------------

describe('splitOnColumnBreaks', () => {
  it('returns a single chunk when there are no ||| separators', () => {
    const result = splitOnColumnBreaks('hello\nworld');
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('hello\nworld');
  });

  it('splits content on ||| into multiple chunks', () => {
    const result = splitOnColumnBreaks('col1\n|||\ncol2');
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('col1');
    expect(result[1].text).toBe('col2');
  });

  it('trims leading/trailing blank lines from each chunk', () => {
    const result = splitOnColumnBreaks('\n\ncol1\n\n|||\n\ncol2\n\n');
    expect(result[0].text).toBe('col1');
    expect(result[1].text).toBe('col2');
  });

  it('sets lineOffset to reflect where trimmed content starts', () => {
    // Two blank lines before "col1" → lineOffset should be 2
    const result = splitOnColumnBreaks('\n\ncol1\n|||\ncol2');
    expect(result[0].lineOffset).toBe(2);
  });

  it('does not split on ||| inside a fenced code block', () => {
    const input = '```\n|||\n```\nafter';
    const result = splitOnColumnBreaks(input);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain('|||');
  });

  it('returns one chunk with empty text for empty input', () => {
    const result = splitOnColumnBreaks('');
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('');
  });

  it('handles three or more columns', () => {
    const result = splitOnColumnBreaks('a\n|||\nb\n|||\nc');
    expect(result).toHaveLength(3);
    expect(result.map(c => c.text)).toEqual(['a', 'b', 'c']);
  });
});
