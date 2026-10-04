import { describe, it, expect } from 'vitest';
import { getRelativePath, decodeMarkdownUrl, formatLinkDestination, formatLinkTitle, resolveLinkPath, splitHeadingFragment, appendLinkFragment } from '../src/renderer/linkUtil';

describe('getRelativePath', () => {
  it('returns just the file name when target is in the same directory', () => {
    expect(getRelativePath('/a/b/note.md', '/a/b/pic.png')).toBe('pic.png');
  });

  it('descends into a subdirectory', () => {
    expect(getRelativePath('/a/b/note.md', '/a/b/sub/pic.png')).toBe('sub/pic.png');
  });

  it('climbs out with ../ when target is in a parent/sibling directory', () => {
    expect(getRelativePath('/a/b/note.md', '/a/c/pic.png')).toBe('../c/pic.png');
  });

  it('climbs multiple levels', () => {
    expect(getRelativePath('/a/b/c/note.md', '/a/x/pic.png')).toBe('../../x/pic.png');
  });

  it('falls back to the absolute path when the target is on another Windows drive', () => {
    // No sequence of '../' can climb from C: to D:, so a relative path is impossible.
    expect(getRelativePath('C:\\a\\b\\note.md', 'D:\\x\\pic.png')).toBe('D:/x/pic.png');
  });

  it('falls back to the absolute path when the target is on another UNC share', () => {
    expect(getRelativePath('\\\\srv\\one\\note.md', '\\\\srv\\two\\pic.png')).toBe(
      '//srv/two/pic.png'
    );
  });

  it('stays relative within the same Windows drive', () => {
    expect(getRelativePath('C:\\a\\b\\note.md', 'C:\\a\\c\\pic.png')).toBe('../c/pic.png');
  });

  it('treats Windows path segments case-insensitively', () => {
    // 'Notes' and 'notes' are the same folder on Windows, so no '../' round trip.
    expect(getRelativePath('c:\\Users\\Notes\\note.md', 'C:\\users\\notes\\pic.png')).toBe(
      'pic.png'
    );
  });

  it('keeps POSIX path segments case-sensitive', () => {
    expect(getRelativePath('/a/Notes/note.md', '/a/notes/pic.png')).toBe('../notes/pic.png');
  });
});

describe('decodeMarkdownUrl', () => {
  it('decodes percent-encoded spaces back to literal characters', () => {
    expect(decodeMarkdownUrl('../Images/Screenshot%20from%202024.png')).toBe('../Images/Screenshot from 2024.png');
  });

  it('leaves unencoded paths unchanged', () => {
    expect(decodeMarkdownUrl('../Images/pic.png')).toBe('../Images/pic.png');
  });

  it('falls back to the original string when not validly encoded', () => {
    expect(decodeMarkdownUrl('100%done.png')).toBe('100%done.png');
  });
});

describe('formatLinkDestination', () => {
  it('leaves a path bare when nothing needs escaping', () => {
    expect(formatLinkDestination('../c/img.jpg')).toBe('../c/img.jpg');
  });

  it('leaves balanced parentheses bare (CommonMark allows them)', () => {
    expect(formatLinkDestination('notes(1).md')).toBe('notes(1).md');
  });

  it('uses angle brackets for spaces', () => {
    expect(formatLinkDestination('../Job Interview Thread/HUMAN.md')).toBe(
      '<../Job Interview Thread/HUMAN.md>'
    );
  });

  it('uses angle brackets for unbalanced parentheses', () => {
    expect(formatLinkDestination('a)b.md')).toBe('<a)b.md>');
    expect(formatLinkDestination('a(b.md')).toBe('<a(b.md>');
  });

  it('percent-encodes when the path contains angle brackets', () => {
    expect(formatLinkDestination('dir/a <b>.md')).toBe('dir/a%20%3Cb%3E.md');
  });

  it('percent-encodes a literal % so decodeMarkdownUrl round-trips it', () => {
    const dest = formatLinkDestination('100% done.md');
    expect(dest).toBe('100%25%20done.md');
    expect(decodeMarkdownUrl(dest)).toBe('100% done.md');
  });

  it('percent-encodes a backslash, which would otherwise start an escape', () => {
    expect(formatLinkDestination('a\\(b.md')).toBe('a%5C%28b.md');
  });

  it('percent-encodes a character-reference-like sequence but not a plain ampersand', () => {
    expect(formatLinkDestination('Q&A.md')).toBe('Q&A.md');
    expect(formatLinkDestination('a&amp;b.md')).toBe('a%26amp%3Bb.md');
  });

  it('percent-encodes a leading # so it is not read as an in-page anchor', () => {
    expect(formatLinkDestination('#notes.md')).toBe('%23notes.md');
  });
});

describe('formatLinkTitle', () => {
  it('wraps the text in double quotes', () => {
    expect(formatLinkTitle('id:3D6B20DDF')).toBe('"id:3D6B20DDF"');
  });

  it('backslash-escapes double quotes and backslashes', () => {
    expect(formatLinkTitle('id:a"b\\c')).toBe('"id:a\\"b\\\\c"');
  });
});

describe('resolveLinkPath', () => {
  it('resolves a sibling file', () => {
    expect(resolveLinkPath('/a/b/note.md', 'other.md')).toBe('/a/b/other.md');
  });

  it('climbs with ../ and skips ./', () => {
    expect(resolveLinkPath('/a/b/note.md', './../c/./x.md')).toBe('/a/c/x.md');
  });

  it('returns an absolute destination as-is', () => {
    expect(resolveLinkPath('/a/b/note.md', '/x/y.md')).toBe('/x/y.md');
  });
});

describe('splitHeadingFragment', () => {
  it('splits a heading fragment off a .md destination', () => {
    expect(splitHeadingFragment('../a/README.md#requirements')).toEqual({ path: '../a/README.md', fragment: 'requirements' });
  });

  it('is case-insensitive about the .md extension', () => {
    expect(splitHeadingFragment('NOTES.MD#x')).toEqual({ path: 'NOTES.MD', fragment: 'x' });
  });

  it('returns no fragment when there is none', () => {
    expect(splitHeadingFragment('../a/README.md')).toEqual({ path: '../a/README.md', fragment: null });
  });

  it('treats an empty fragment as none', () => {
    expect(splitHeadingFragment('README.md#')).toEqual({ path: 'README.md', fragment: null });
  });

  it('leaves a # inside a file name alone', () => {
    expect(splitHeadingFragment('C#notes.md')).toEqual({ path: 'C#notes.md', fragment: null });
    expect(splitHeadingFragment('C#notes.md#intro')).toEqual({ path: 'C#notes.md', fragment: 'intro' });
  });

  it('ignores a # after a non-markdown file', () => {
    expect(splitHeadingFragment('photo.png#x')).toEqual({ path: 'photo.png#x', fragment: null });
  });
});

describe('appendLinkFragment', () => {
  it('appends to a bare destination', () => {
    expect(appendLinkFragment('../a/README.md', 'requirements')).toBe('../a/README.md#requirements');
  });

  it('appends inside angle brackets', () => {
    expect(appendLinkFragment('<my notes/README.md>', 'my-heading')).toBe('<my notes/README.md#my-heading>');
  });

  it('returns the destination unchanged for an empty fragment', () => {
    expect(appendLinkFragment('README.md', '')).toBe('README.md');
  });
});
