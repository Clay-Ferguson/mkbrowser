import { describe, it, expect } from 'vitest';
import { getRelativePath, buildMarkdownLinks, decodeMarkdownUrl } from '../src/renderer/linkUtil';

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
});

describe('buildMarkdownLinks', () => {
  it('renders images as inline embeds and other files as links, separated by a blank line', () => {
    const result = buildMarkdownLinks('/a/b/note.md', ['/a/b/pic.png', '/a/b/doc.md']);
    expect(result).toBe('![pic.png](pic.png)\n\n[doc.md](doc.md)');
  });

  it('percent-encodes spaces in the URL while keeping the readable display name', () => {
    const result = buildMarkdownLinks('/a/b/note.md', ['/a/b/my file.md']);
    expect(result).toBe('[my file.md](my%20file.md)');
  });

  it('percent-encodes spaces in directory segments without encoding separators', () => {
    const result = buildMarkdownLinks('/a/b/note.md', ['/a/b/my sub/my pic.png']);
    expect(result).toBe('![my pic.png](my%20sub/my%20pic.png)');
  });

  it('percent-encodes parentheses so they cannot terminate the link destination', () => {
    const result = buildMarkdownLinks('/a/b/note.md', ['/a/b/screenshot 1).png']);
    expect(result).toBe('![screenshot 1).png](screenshot%201%29.png)');
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
