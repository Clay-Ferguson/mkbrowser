import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ clipboard: {} }));
vi.mock('../src/renderer/api', () => ({ api: {}, getApi: () => undefined }));

import { parseFileUriList } from '../src/main/clipboardFiles';
import { clipboardFileExt, defaultPastedFileName, normalizePastedFileName } from '../src/renderer/clipboardFile';
import { imageExtForMime } from '../src/renderer/clipboard';

describe('parseFileUriList', () => {
  it('reads the paths of a text/uri-list', () => {
    expect(parseFileUriList('file:///home/me/report.pdf\r\nfile:///home/me/b.png\r\n')).toEqual([
      '/home/me/report.pdf',
      '/home/me/b.png',
    ]);
  });

  it('skips the gnome-copied-files header line', () => {
    expect(parseFileUriList('copy\nfile:///tmp/a.txt')).toEqual(['/tmp/a.txt']);
    expect(parseFileUriList('cut\nfile:///tmp/a.txt')).toEqual(['/tmp/a.txt']);
  });

  it('decodes percent-encoded characters', () => {
    expect(parseFileUriList('file:///home/me/My%20Report.pdf')).toEqual(['/home/me/My Report.pdf']);
  });

  it('skips comments, blanks, non-file URIs and trailing NULs', () => {
    expect(parseFileUriList('# comment\n\nhttps://example.com/x.png\nfile:///tmp/a.png\0')).toEqual(['/tmp/a.png']);
  });

  it('returns nothing for plain text', () => {
    expect(parseFileUriList('just some text')).toEqual([]);
  });
});

describe('imageExtForMime', () => {
  it('maps known image types and defaults to .png', () => {
    expect(imageExtForMime('image/jpeg')).toBe('.jpg');
    expect(imageExtForMime('image/gif')).toBe('.gif');
    expect(imageExtForMime('image/webp')).toBe('.webp');
    expect(imageExtForMime('image/png')).toBe('.png');
    expect(imageExtForMime('image/x-unknown')).toBe('.png');
  });
});

describe('defaultPastedFileName / clipboardFileExt', () => {
  const blob = new Blob([]);

  it('suggests just the extension for image bytes', () => {
    const file = { kind: 'image' as const, blob, ext: '.png' };
    expect(defaultPastedFileName(file)).toBe('.png');
    expect(clipboardFileExt(file)).toBe('.png');
  });

  it("suggests a copied file's own name, minus any id it carries", () => {
    const file = { kind: 'path' as const, sourcePath: '/docs/report--3D6B20DDF.pdf' };
    expect(defaultPastedFileName(file)).toBe('report.pdf');
    expect(clipboardFileExt(file)).toBe('.pdf');
  });

  it('gives no extension for a name without one', () => {
    expect(clipboardFileExt({ kind: 'path', sourcePath: '/docs/Makefile' })).toBe('');
    expect(clipboardFileExt({ kind: 'path', sourcePath: '/docs/.bashrc' })).toBe('');
  });
});

describe('normalizePastedFileName', () => {
  const TIMESTAMP_PNG = /^\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2}-\d{3}\.png$/;

  it('keeps a typed name, trimmed', () => {
    expect(normalizePastedFileName('  diagram.png ', '.png')).toBe('diagram.png');
  });

  it('keeps a name typed without the suggested extension', () => {
    expect(normalizePastedFileName('diagram', '.png')).toBe('diagram');
  });

  it('falls back to a timestamp name when blank or just the extension', () => {
    expect(normalizePastedFileName('   ', '.png')).toMatch(TIMESTAMP_PNG);
    expect(normalizePastedFileName('.png', '.png')).toMatch(TIMESTAMP_PNG);
  });
});
