/**
 * Tests for #file: directive preprocessing (preprocessPrompt, wildcardToRegex).
 * These tests exercise the prompt parsing and file inclusion logic without
 * requiring any AI API key or network access.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { preprocessPrompt, wildcardToRegex, FILE_DIRECTIVE_REGEX } from '../src/ai/promptPreprocess';

// ── Test fixture directory ─────────────────────────────────────────
const FIXTURE_DIR = path.resolve(__dirname, '..', 'test-data', 'ai-preprocess');

/** Create fixture files for tests */
function createFixtures() {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_DIR, 'HUMAN.md'), 'This is the prompt.\n#file:*\n');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'notes.txt'), 'Some notes here.');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'data.csv'), 'col1,col2\na,b\n');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'readme.md'), '# Readme\nHello world.');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'report.md'), '## Report\nFindings.');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'image.png'), 'fake-binary-content');
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
    expect(result).toBe(input);
  });

  it('includes all files with #file:* and excludes HUMAN.md', async () => {
    const input = 'Summarize everything.\n#file:*';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    // Directive line should be stripped
    expect(result).not.toContain('#file:');

    // Prompt text preserved
    expect(result).toContain('Summarize everything.');

    // Should contain attached_files block
    expect(result).toContain('<attached_files>');
    expect(result).toContain('</attached_files>');

    // Should include all non-HUMAN.md files
    expect(result).toContain('<file path="notes.txt">');
    expect(result).toContain('<file path="data.csv">');
    expect(result).toContain('<file path="readme.md">');
    expect(result).toContain('<file path="report.md">');
    expect(result).toContain('<file path="image.png">');

    // HUMAN.md must be excluded
    expect(result).not.toContain('<file path="HUMAN.md">');
  });

  it('filters by extension with #file:*.md', async () => {
    const input = 'Review the markdown files.\n#file:*.md';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result).toContain('<file path="readme.md">');
    expect(result).toContain('<file path="report.md">');
    expect(result).not.toContain('<file path="notes.txt">');
    expect(result).not.toContain('<file path="data.csv">');
    expect(result).not.toContain('<file path="HUMAN.md">');
  });

  it('includes a specific file with #file:notes.txt', async () => {
    const input = 'Check this file.\n#file:notes.txt';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result).toContain('<file path="notes.txt">');
    expect(result).toContain('Some notes here.');

    // Other files should not be included
    expect(result).not.toContain('<file path="data.csv">');
    expect(result).not.toContain('<file path="readme.md">');
  });

  it('handles multiple directives and deduplicates', async () => {
    const input = 'Look at these.\n#file:notes.txt\n#file:*.txt';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    // notes.txt should appear only once despite matching both patterns
    const occurrences = (result.match(/<file path="notes\.txt">/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('strips directives from anywhere in the text', async () => {
    const input = '#file:notes.txt\nMiddle text here.\n#file:data.csv\nEnd text.';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result).not.toContain('#file:');
    expect(result).toContain('Middle text here.');
    expect(result).toContain('End text.');
    expect(result).toContain('<file path="notes.txt">');
    expect(result).toContain('<file path="data.csv">');
  });

  it('silently ignores patterns that match nothing', async () => {
    const input = 'Hello.\n#file:nonexistent.xyz';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result).toBe('Hello.');
    expect(result).not.toContain('<attached_files>');
  });

  it('handles directives with leading/trailing whitespace', async () => {
    const input = 'Hello.\n  #file:notes.txt  ';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result).toContain('<file path="notes.txt">');
    expect(result).not.toContain('#file:');
  });

  it('handles prefix wildcard pattern like data.*', async () => {
    const input = 'Show data files.\n#file:data.*';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    expect(result).toContain('<file path="data.csv">');
    expect(result).not.toContain('<file path="notes.txt">');
  });

  it('appends attached_files block after the prompt text', async () => {
    const input = 'My prompt.\n#file:notes.txt';
    const result = await preprocessPrompt(input, FIXTURE_DIR);

    const promptEnd = result.indexOf('My prompt.');
    const attachStart = result.indexOf('<attached_files>');
    expect(promptEnd).toBeLessThan(attachStart);
  });
});
