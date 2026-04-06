/**
 * Tests for #file: directive preprocessing (preprocessPrompt, wildcardToRegex).
 * These tests exercise the prompt parsing and file inclusion logic without
 * requiring any AI API key or network access.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  preprocessPrompt,
  wildcardToRegex,
  FILE_DIRECTIVE_REGEX,
  getImageMimeType,
  isImageFile,
  MAX_IMAGE_SIZE_BYTES,
} from '../src/ai/promptPreprocess';

// ── Test fixture directory ─────────────────────────────────────────
// NOTE: Must NOT live under test-data/ — that directory is wiped by search.test.ts's beforeAll.
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'ai-preprocess-data');

/** Minimal valid 1×1 red PNG (68 bytes). */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
);

/** Create fixture files for tests */
function createFixtures() {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_DIR, 'HUMAN.md'), 'This is the prompt.\n#file:*\n');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'notes.txt'), 'Some notes here.');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'data.csv'), 'col1,col2\na,b\n');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'readme.md'), '# Readme\nHello world.');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'report.md'), '## Report\nFindings.');
  // Real tiny PNG for image tests
  fs.writeFileSync(path.join(FIXTURE_DIR, 'photo.png'), TINY_PNG);
  fs.writeFileSync(path.join(FIXTURE_DIR, 'diagram.jpg'), TINY_PNG); // reuse bytes, extension matters
  fs.writeFileSync(path.join(FIXTURE_DIR, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="red"/></svg>');
}

/** Clean up fixture directory */
function removeFixtures() {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
}

beforeAll(() => {
  removeFixtures();
  createFixtures();
});

afterAll(() => {
  removeFixtures();
});

// ── wildcardToRegex ────────────────────────────────────────────────

describe('wildcardToRegex', () => {
  it('matches everything with *', () => {
    const re = wildcardToRegex('*');
    expect(re.test('anything.txt')).toBe(true);
    expect(re.test('foo')).toBe(true);
    expect(re.test('')).toBe(true);
  });

  it('matches files by extension with *.md', () => {
    const re = wildcardToRegex('*.md');
    expect(re.test('readme.md')).toBe(true);
    expect(re.test('notes.txt')).toBe(false);
    expect(re.test('.md')).toBe(true);
  });

  it('matches files by prefix with data.*', () => {
    const re = wildcardToRegex('data.*');
    expect(re.test('data.csv')).toBe(true);
    expect(re.test('data.json')).toBe(true);
    expect(re.test('mydata.csv')).toBe(false);
  });

  it('matches exact filenames', () => {
    const re = wildcardToRegex('notes.txt');
    expect(re.test('notes.txt')).toBe(true);
    expect(re.test('notes.txt.bak')).toBe(false);
    expect(re.test('mynotes.txt')).toBe(false);
  });

  it('escapes regex-special characters like + and ()', () => {
    const re = wildcardToRegex('file(1)+2.txt');
    expect(re.test('file(1)+2.txt')).toBe(true);
    expect(re.test('file12.txt')).toBe(false);
  });
});

// ── FILE_DIRECTIVE_REGEX ───────────────────────────────────────────

describe('FILE_DIRECTIVE_REGEX', () => {
  it('matches #file:* on its own line', () => {
    const m = FILE_DIRECTIVE_REGEX.exec('#file:*');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('*');
  });

  it('matches with leading/trailing whitespace', () => {
    const m = FILE_DIRECTIVE_REGEX.exec('  #file:*.md  ');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('*.md');
  });

  it('captures the full pattern after the colon', () => {
    const m = FILE_DIRECTIVE_REGEX.exec('#file:notes.txt');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('notes.txt');
  });

  it('does not match when embedded in other text', () => {
    expect(FILE_DIRECTIVE_REGEX.test('please use #file:* to include')).toBe(false);
  });

  it('does not match lines without #file: prefix', () => {
    expect(FILE_DIRECTIVE_REGEX.test('# file:notes.txt')).toBe(false);
    expect(FILE_DIRECTIVE_REGEX.test('regular text')).toBe(false);
  });
});

// ── preprocessPrompt ───────────────────────────────────────────────

describe('preprocessPrompt', () => {
  it('returns text unchanged when no directives are present', async () => {
    const input = 'Hello, AI.\nPlease help me.';
    const result = await preprocessPrompt(input, FIXTURE_DIR);
    expect(result.text).toBe(input);
    expect(result.images).toHaveLength(0);
  });

  it('includes all text files with #file:* and excludes HUMAN.md and images', async () => {
    const input = 'Summarize everything.\n#file:*';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    // Directive line should be stripped
    expect(result.text).not.toContain('#file:');

    // Prompt text preserved
    expect(result.text).toContain('Summarize everything.');

    // Should contain attached_files block with text files only
    expect(result.text).toContain('<attached_files>');
    expect(result.text).toContain('</attached_files>');
    expect(result.text).toContain('<file path="notes.txt">');
    expect(result.text).toContain('<file path="data.csv">');
    expect(result.text).toContain('<file path="readme.md">');
    expect(result.text).toContain('<file path="report.md">');

    // Image files should NOT be in the text block
    expect(result.text).not.toContain('<file path="photo.png">');
    expect(result.text).not.toContain('<file path="diagram.jpg">');

    // HUMAN.md must be excluded
    expect(result.text).not.toContain('<file path="HUMAN.md">');

    // Images should be in the images array
    expect(result.images.length).toBeGreaterThanOrEqual(2);
    const imageNames = result.images.map(i => i.fileName);
    expect(imageNames).toContain('photo.png');
    expect(imageNames).toContain('diagram.jpg');
  });

  it('filters by extension with #file:*.md', async () => {
    const input = 'Review the markdown files.\n#file:*.md';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result.text).toContain('<file path="readme.md">');
    expect(result.text).toContain('<file path="report.md">');
    expect(result.text).not.toContain('<file path="notes.txt">');
    expect(result.text).not.toContain('<file path="data.csv">');
    expect(result.text).not.toContain('<file path="HUMAN.md">');
    expect(result.images).toHaveLength(0);
  });

  it('includes a specific file with #file:notes.txt', async () => {
    const input = 'Check this file.\n#file:notes.txt';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result.text).toContain('<file path="notes.txt">');
    expect(result.text).toContain('Some notes here.');

    // Other files should not be included
    expect(result.text).not.toContain('<file path="data.csv">');
    expect(result.text).not.toContain('<file path="readme.md">');
    expect(result.images).toHaveLength(0);
  });

  it('handles multiple directives and deduplicates', async () => {
    const input = 'Look at these.\n#file:notes.txt\n#file:*.txt';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    // notes.txt should appear only once despite matching both patterns
    const occurrences = (result.text.match(/<file path="notes\.txt">/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('strips directives from anywhere in the text', async () => {
    const input = '#file:notes.txt\nMiddle text here.\n#file:data.csv\nEnd text.';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result.text).not.toContain('#file:');
    expect(result.text).toContain('Middle text here.');
    expect(result.text).toContain('End text.');
    expect(result.text).toContain('<file path="notes.txt">');
    expect(result.text).toContain('<file path="data.csv">');
  });

  it('silently ignores patterns that match nothing', async () => {
    const input = 'Hello.\n#file:nonexistent.xyz';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result.text).toBe('Hello.');
    expect(result.text).not.toContain('<attached_files>');
    expect(result.images).toHaveLength(0);
  });

  it('handles directives with leading/trailing whitespace', async () => {
    const input = 'Hello.\n  #file:notes.txt  ';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result.text).toContain('<file path="notes.txt">');
    expect(result.text).not.toContain('#file:');
  });

  it('handles prefix wildcard pattern like data.*', async () => {
    const input = 'Show data files.\n#file:data.*';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result.text).toContain('<file path="data.csv">');
    expect(result.text).not.toContain('<file path="notes.txt">');
  });

  it('appends attached_files block after the prompt text', async () => {
    const input = 'My prompt.\n#file:notes.txt';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    const promptEnd = result.text.indexOf('My prompt.');
    const attachStart = result.text.indexOf('<attached_files>');
    expect(promptEnd).toBeLessThan(attachStart);
  });
});

// ── Image attachment tests ─────────────────────────────────────────

describe('getImageMimeType', () => {
  it('returns correct MIME types for common extensions', () => {
    expect(getImageMimeType('.png')).toBe('image/png');
    expect(getImageMimeType('.jpg')).toBe('image/jpeg');
    expect(getImageMimeType('.jpeg')).toBe('image/jpeg');
    expect(getImageMimeType('.gif')).toBe('image/gif');
    expect(getImageMimeType('.webp')).toBe('image/webp');
    expect(getImageMimeType('.svg')).toBe('image/svg+xml');
    expect(getImageMimeType('.bmp')).toBe('image/bmp');
    expect(getImageMimeType('.ico')).toBe('image/x-icon');
    expect(getImageMimeType('.tiff')).toBe('image/tiff');
    expect(getImageMimeType('.tif')).toBe('image/tiff');
    expect(getImageMimeType('.avif')).toBe('image/avif');
  });

  it('is case-insensitive', () => {
    expect(getImageMimeType('.PNG')).toBe('image/png');
    expect(getImageMimeType('.Jpg')).toBe('image/jpeg');
  });

  it('returns application/octet-stream for unknown extension', () => {
    expect(getImageMimeType('.xyz')).toBe('application/octet-stream');
  });
});

describe('isImageFile', () => {
  it('identifies image file extensions', () => {
    expect(isImageFile('photo.png')).toBe(true);
    expect(isImageFile('photo.jpg')).toBe(true);
    expect(isImageFile('photo.jpeg')).toBe(true);
    expect(isImageFile('photo.gif')).toBe(true);
    expect(isImageFile('photo.webp')).toBe(true);
    expect(isImageFile('icon.svg')).toBe(true);
    expect(isImageFile('icon.bmp')).toBe(true);
    expect(isImageFile('icon.avif')).toBe(true);
  });

  it('rejects non-image extensions', () => {
    expect(isImageFile('notes.txt')).toBe(false);
    expect(isImageFile('data.csv')).toBe(false);
    expect(isImageFile('readme.md')).toBe(false);
    expect(isImageFile('script.js')).toBe(false);
  });
});

describe('preprocessPrompt — image handling', () => {
  it('separates image files from text files with #file:*', async () => {
    const input = 'Describe all files.\n#file:*';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    // Text files go in <attached_files> block
    expect(result.text).toContain('<file path="notes.txt">');
    expect(result.text).toContain('<file path="data.csv">');
    expect(result.text).toContain('<file path="readme.md">');

    // Image files should NOT appear in text block
    expect(result.text).not.toContain('<file path="photo.png">');
    expect(result.text).not.toContain('<file path="diagram.jpg">');
    expect(result.text).not.toContain('<file path="icon.svg">');

    // Images should be in the images array
    const imageNames = result.images.map(i => i.fileName).sort();
    expect(imageNames).toContain('photo.png');
    expect(imageNames).toContain('diagram.jpg');
    expect(imageNames).toContain('icon.svg');
  });

  it('includes only matching images with #file:*.png', async () => {
    const input = 'Show PNG.\n#file:*.png';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result.images).toHaveLength(1);
    expect(result.images[0].fileName).toBe('photo.png');
    expect(result.images[0].mimeType).toBe('image/png');
    expect(result.images[0].base64Data.length).toBeGreaterThan(0);

    // No text attachments
    expect(result.text).not.toContain('<attached_files>');
  });

  it('includes specific image with #file:diagram.jpg', async () => {
    const input = 'Check this.\n#file:diagram.jpg';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result.images).toHaveLength(1);
    expect(result.images[0].fileName).toBe('diagram.jpg');
    expect(result.images[0].mimeType).toBe('image/jpeg');
  });

  it('treats SVG files as images', async () => {
    const input = 'Check SVG.\n#file:icon.svg';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result.images).toHaveLength(1);
    expect(result.images[0].fileName).toBe('icon.svg');
    expect(result.images[0].mimeType).toBe('image/svg+xml');
    // SVG content should be base64-encoded, not in text block
    expect(result.text).not.toContain('<file path="icon.svg">');
  });

  it('correctly base64-encodes image content', async () => {
    const input = 'Encode test.\n#file:photo.png';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result.images).toHaveLength(1);
    // Verify the base64 round-trips back to the original content
    const decoded = Buffer.from(result.images[0].base64Data, 'base64');
    const original = fs.readFileSync(path.join(FIXTURE_DIR, 'photo.png'));
    expect(decoded.equals(original)).toBe(true);
  });

  it('excludes images when includeImages is false', async () => {
    const input = 'Describe all.\n#file:*';
    const result = await preprocessPrompt(input, FIXTURE_DIR, false);

    // No images in the result
    expect(result.images).toHaveLength(0);

    // Text files still present
    expect(result.text).toContain('<file path="notes.txt">');

    // Image files should not appear at all (neither in text nor images)
    expect(result.text).not.toContain('photo.png');
    expect(result.text).not.toContain('diagram.jpg');
  });

  it('skips oversized images with a note', async () => {
    // Create a file that's just over the limit (we'll use a custom fixture dir)
    const oversizedDir = path.resolve(__dirname, '..', 'test-data', 'ai-preprocess-oversize');
    fs.mkdirSync(oversizedDir, { recursive: true });

    // Create a file that's larger than MAX_IMAGE_SIZE_BYTES
    // We just need the file to exist on disk with the right size
    const oversizedPath = path.join(oversizedDir, 'huge.png');
    const fd = fs.openSync(oversizedPath, 'w');
    fs.ftruncateSync(fd, MAX_IMAGE_SIZE_BYTES + 1);
    fs.closeSync(fd);
    fs.writeFileSync(path.join(oversizedDir, 'HUMAN.md'), 'test');

    try {
      const input = 'Check images.\n#file:huge.png';
      const result = await preprocessPrompt(input, oversizedDir);

      // Image should be skipped
      expect(result.images).toHaveLength(0);

      // Should have a skip note in the text
      expect(result.text).toContain('[Skipped image "huge.png": exceeds 10 MB limit');
    } finally {
      fs.rmSync(oversizedDir, { recursive: true, force: true });
    }
  });

  it('handles mixed text and image directives', async () => {
    const input = 'Mixed content.\n#file:notes.txt\n#file:photo.png';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    // Text file in XML block
    expect(result.text).toContain('<file path="notes.txt">');
    expect(result.text).toContain('Some notes here.');

    // Image in images array
    expect(result.images).toHaveLength(1);
    expect(result.images[0].fileName).toBe('photo.png');
  });
});
