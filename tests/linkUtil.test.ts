import { describe, it, expect } from 'vitest';
import { getRelativePath, buildMarkdownLinks, decodeMarkdownUrl, formatLinkDestination } from '../src/renderer/linkUtil';

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

describe('buildMarkdownLinks', () => {
  it('renders images as inline embeds and other files as links, separated by a blank line', () => {
    const result = buildMarkdownLinks('/a/b/note.md', ['/a/b/pic.png', '/a/b/doc.md']);
    expect(result).toBe('![pic.png](pic.png)\n\n[doc.md](doc.md)');
  });

  it('wraps a path with spaces in angle brackets instead of percent-encoding it', () => {
    const result = buildMarkdownLinks('/a/b/note.md', ['/a/b/my file.md']);
    expect(result).toBe('[my file.md](<my file.md>)');
  });

  it('keeps spaces literal in directory segments too', () => {
    const result = buildMarkdownLinks('/a/b/note.md', ['/a/b/my sub/my pic.png']);
    expect(result).toBe('![my pic.png](<my sub/my pic.png>)');
  });

  it('wraps an unbalanced parenthesis in angle brackets so it cannot end the destination', () => {
    const result = buildMarkdownLinks('/a/b/note.md', ['/a/b/screenshot 1).png']);
    expect(result).toBe('![screenshot 1).png](<screenshot 1).png>)');
  });

  it('builds relative paths across directories', () => {
    const result = buildMarkdownLinks('/a/b/note.md', ['/a/c/img.jpg']);
    expect(result).toBe('![img.jpg](../c/img.jpg)');
  });

  it('resolves each path independently when a single call mixes different depths', () => {
    // Guards the shared, precomputed source-directory segments: every entry must be
    // resolved against the same origin regardless of its own depth or order.
    const result = buildMarkdownLinks('/a/b/note.md', [
      '/a/b/pic.png',        // same directory
      '/a/b/sub/deep.png',   // subdirectory
      '/a/c/img.jpg',        // sibling directory (needs ../)
    ]);
    expect(result).toBe(
      '![pic.png](pic.png)\n\n![deep.png](sub/deep.png)\n\n![img.jpg](../c/img.jpg)'
    );
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
