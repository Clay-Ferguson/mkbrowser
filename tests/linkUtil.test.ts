import { describe, it, expect } from 'vitest';
import { getRelativePath, getPathRelativeToDir, formatMarkdownFileLink, formatHeadingLink, clipboardLinkCandidates, decodeMarkdownUrl, formatLinkDestination, formatLinkTitle, resolveLinkPath, splitHeadingFragment, appendLinkFragment, isFileLinkHref } from '../src/renderer/linkUtil';

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

describe('getPathRelativeToDir', () => {
  it('returns the path below the folder', () => {
    expect(getPathRelativeToDir('/root', '/root/docs/file.md')).toBe('docs/file.md');
  });

  it('returns just the file name for a file directly in the folder', () => {
    expect(getPathRelativeToDir('/root/', '/root/file.md')).toBe('file.md');
  });

  it('uses forward slashes for Windows paths', () => {
    expect(getPathRelativeToDir('C:\\root', 'C:\\root\\docs\\file.md')).toBe('docs/file.md');
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

describe('isFileLinkHref', () => {
  it('treats relative and absolute paths as file links', () => {
    expect(isFileLinkHref('notes.md')).toBe(true);
    expect(isFileLinkHref('./notes.md')).toBe(true);
    expect(isFileLinkHref('../folder')).toBe(true);
    expect(isFileLinkHref('my%20file.md#some-heading')).toBe(true);
    expect(isFileLinkHref('/home/user/doc.md')).toBe(true);
    expect(isFileLinkHref('C:\\docs\\doc.md')).toBe(true);
  });

  it('treats URLs with a scheme, in-page anchors and empty hrefs as non-file links', () => {
    expect(isFileLinkHref('https://example.com')).toBe(false);
    expect(isFileLinkHref('http://example.com/a.md')).toBe(false);
    expect(isFileLinkHref('file:///home/user/doc.md')).toBe(false);
    expect(isFileLinkHref('mailto:someone@example.com')).toBe(false);
    expect(isFileLinkHref('#section')).toBe(false);
    expect(isFileLinkHref('')).toBe(false);
    expect(isFileLinkHref(undefined)).toBe(false);
  });
});

describe('formatMarkdownFileLink', () => {
  it('links relative to the source file, labelled with the name minus .md', () => {
    expect(formatMarkdownFileLink('/r/a/note.md', '/r/b/README.md', '')).toBe('[README](../b/README.md)');
  });

  it('adds the heading fragment and the id title', () => {
    expect(formatMarkdownFileLink('/r/a/note.md', '/r/a/doc.md', '36F7385CA', 'usage'))
      .toBe('[doc](doc.md#usage "id:36F7385CA")');
  });

  it('angle-brackets a path with spaces, fragment inside', () => {
    expect(formatMarkdownFileLink('/r/note.md', '/r/my docs/a b.md', '', 'x')).toBe('[a b](<my docs/a b.md#x>)');
  });

  it('escapes brackets in the label', () => {
    expect(formatMarkdownFileLink('/r/note.md', '/r/[x].md', '')).toBe('[\\[x\\]]([x].md)');
  });
});

describe('formatHeadingLink', () => {
  it('builds a root-relative link with the heading text', () => {
    expect(formatHeadingLink('Getting Started', 'docs/file.md', 'getting-started'))
      .toBe('[Getting Started](docs/file.md#getting-started)');
  });

  it('escapes the label and brackets a path with spaces', () => {
    expect(formatHeadingLink('A [b]', 'my docs/f.md', 'a-b')).toBe('[A \\[b\\]](<my docs/f.md#a-b>)');
  });

  it('round-trips through clipboardLinkCandidates into a file-relative link', () => {
    const copied = formatHeadingLink('A [b]', 'my docs/f.md', 'a-b');
    const parsed = clipboardLinkCandidates(copied, '/root')!;
    expect(formatMarkdownFileLink('/root/notes/n.md', parsed.paths[0]!, '', parsed.fragment, parsed.label))
      .toBe('[A \\[b\\]](<../my docs/f.md#a-b>)');
  });
});

describe('clipboardLinkCandidates', () => {
  it('resolves a root-relative path and splits off the slug', () => {
    expect(clipboardLinkCandidates('docs/file.md#heading-slug', '/root'))
      .toEqual({ paths: ['/root/docs/file.md'], fragment: 'heading-slug', label: null });
  });

  it('tries an absolute path as is, then under the root', () => {
    expect(clipboardLinkCandidates('  /home/u/file.md\n', '/root'))
      .toEqual({ paths: ['/home/u/file.md', '/root/home/u/file.md'], fragment: null, label: null });
  });

  it('parses a copied heading link, keeping the raw label', () => {
    expect(clipboardLinkCandidates('[My \\[1\\] Heading](docs/file.md#my-1-heading)', '/root'))
      .toEqual({ paths: ['/root/docs/file.md'], fragment: 'my-1-heading', label: 'My \\[1\\] Heading' });
  });

  it('unwraps and decodes the link destination', () => {
    expect(clipboardLinkCandidates('[H](<my docs/a b.md#h>)', '/root'))
      .toEqual({ paths: ['/root/my docs/a b.md'], fragment: 'h', label: 'H' });
    expect(clipboardLinkCandidates('[H](a%25b.md "id:X")', '/root'))
      .toEqual({ paths: ['/root/a%b.md'], fragment: null, label: 'H' });
  });

  it('rejects empty and multi-line text', () => {
    expect(clipboardLinkCandidates('   ', '/root')).toBeNull();
    expect(clipboardLinkCandidates('a.md\nb.md', '/root')).toBeNull();
  });
});
