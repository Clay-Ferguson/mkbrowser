import { describe, it, expect } from 'vitest';
import { isImageEntry, isMarkdownFile } from '../src/shared/fileTypes';

// ---------------------------------------------------------------------------
// isMarkdownFile — the single source of truth for the markdown extension
// policy. Only `.md` is markdown; `.markdown` is treated as an unknown type.
// ---------------------------------------------------------------------------

describe('isMarkdownFile', () => {
  it('returns true for .md files', () => {
    expect(isMarkdownFile('note.md')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isMarkdownFile('NOTE.MD')).toBe(true);
  });

  it('returns false for .markdown files', () => {
    expect(isMarkdownFile('note.markdown')).toBe(false);
    expect(isMarkdownFile('NOTE.Markdown')).toBe(false);
  });

  it('returns false for other extensions and extensionless names', () => {
    expect(isMarkdownFile('note.txt')).toBe(false);
    expect(isMarkdownFile('note.html')).toBe(false);
    expect(isMarkdownFile('note')).toBe(false);
  });
});

describe('isImageEntry', () => {
  it('is true for an image file, and false for a folder or a broken link with an image name', () => {
    expect(isImageEntry({ name: 'pic.png', isDirectory: false })).toBe(true);
    expect(isImageEntry({ name: 'pics.png', isDirectory: true })).toBe(false);
    expect(isImageEntry({ name: 'pic.png', isDirectory: false, isBrokenLink: true })).toBe(false);
    expect(isImageEntry({ name: 'note.md', isDirectory: false })).toBe(false);
  });
});
