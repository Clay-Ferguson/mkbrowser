/**
 * findMarkdownById tests — locating a Markdown file by its front-matter id, used
 * by link auto-repair. Each test runs against a fresh temp folder.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findMarkdownById, headHasId } from '../src/main/findById';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'findbyid-test-'));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

/** Write a file (creating parent dirs) relative to the temp folder. */
async function writeFile(rel: string, content: string): Promise<string> {
  const full = path.join(tmpDir, rel);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, content, 'utf-8');
  return full;
}

const withId = (id: string, body = 'Body.') => `---\nid: ${id}\ntitle: x\n---\n${body}\n`;

describe('headHasId', () => {
  it('matches a plain id in the front matter', () => {
    expect(headHasId(withId('3D6B20DDF'), '3D6B20DDF')).toBe(true);
  });

  it('matches a quoted id', () => {
    expect(headHasId('---\nid: "3D6B20DDF"\n---\n', '3D6B20DDF')).toBe(true);
    expect(headHasId("---\nid: '3D6B20DDF'\n---\n", '3D6B20DDF')).toBe(true);
  });

  it('matches with CRLF line endings and the id not first', () => {
    expect(headHasId('---\r\ntitle: x\r\nid: ABC\r\n---\r\nBody', 'ABC')).toBe(true);
  });

  it('does not match a different id', () => {
    expect(headHasId(withId('AAA'), 'AAAB')).toBe(false);
  });

  it('ignores an id: line in the body', () => {
    expect(headHasId('---\ntitle: x\n---\nid: ABC\n', 'ABC')).toBe(false);
  });

  it('ignores files without front matter', () => {
    expect(headHasId('id: ABC\n', 'ABC')).toBe(false);
  });

  it('ignores nested (indented) id keys', () => {
    expect(headHasId('---\nmeta:\n  id: ABC\n---\n', 'ABC')).toBe(false);
  });
});

describe('findMarkdownById', () => {
  it('finds a renamed file in the likely folder', async () => {
    await writeFile('notes/other.md', withId('111'));
    const renamed = await writeFile('notes/renamed.md', withId('222'));
    expect(await findMarkdownById('222', path.join(tmpDir, 'notes'), tmpDir, [])).toBe(renamed);
  });

  it('finds a moved file anywhere under the root', async () => {
    const moved = await writeFile('a/b/c/moved.md', withId('333'));
    expect(await findMarkdownById('333', path.join(tmpDir, 'gone'), tmpDir, [])).toBe(moved);
  });

  it('only considers .md files', async () => {
    await writeFile('x/note.txt', withId('444'));
    expect(await findMarkdownById('444', path.join(tmpDir, 'x'), tmpDir, [])).toBeNull();
  });

  it('skips hidden folders and ignored paths in the root crawl', async () => {
    await writeFile('.hidden/a.md', withId('555'));
    await writeFile('archive/b.md', withId('555'));
    expect(await findMarkdownById('555', '', tmpDir, ['archive'])).toBeNull();
  });

  it('returns null when nothing matches', async () => {
    await writeFile('a.md', withId('666'));
    expect(await findMarkdownById('777', tmpDir, tmpDir, [])).toBeNull();
  });

  it('returns null for a missing root and missing likely folder', async () => {
    expect(await findMarkdownById('888', path.join(tmpDir, 'nope'), path.join(tmpDir, 'nope'), [])).toBeNull();
  });
});
