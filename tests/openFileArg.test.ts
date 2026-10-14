/**
 * `--open-file` command-line argument tests — parsing the flag's value, and
 * resolving it to an existing file inside the browsed root folder. Resolution
 * runs against a fresh temp folder per test.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getOpenFileArg, resolveOpenFile } from '../src/main/openFileArg';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'open-file-arg-test-'));
  await fs.promises.mkdir(path.join(tmpDir, 'sub'));
  await fs.promises.writeFile(path.join(tmpDir, 'GUIDE.md'), '# Guide');
  await fs.promises.writeFile(path.join(tmpDir, 'sub', 'note.md'), '# Note');
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('getOpenFileArg', () => {
  it('returns the value of --open-file=<path>', () => {
    expect(getOpenFileArg(['--help-docs', '--open-file=USER_GUIDE.md'])).toBe('USER_GUIDE.md');
  });

  it('returns undefined when the flag is absent or empty', () => {
    expect(getOpenFileArg(['/some/folder', '--help-docs'])).toBeUndefined();
    expect(getOpenFileArg(['--open-file='])).toBeUndefined();
  });

  it('ignores the space-separated form', () => {
    expect(getOpenFileArg(['--open-file', 'USER_GUIDE.md'])).toBeUndefined();
  });
});

describe('resolveOpenFile', () => {
  it('resolves a file relative to the root folder', async () => {
    expect(await resolveOpenFile(tmpDir, 'GUIDE.md')).toBe(path.join(tmpDir, 'GUIDE.md'));
    expect(await resolveOpenFile(tmpDir, 'sub/note.md')).toBe(path.join(tmpDir, 'sub', 'note.md'));
  });

  it('accepts an absolute path inside the root folder', async () => {
    const absolute = path.join(tmpDir, 'sub', 'note.md');
    expect(await resolveOpenFile(tmpDir, absolute)).toBe(absolute);
  });

  it('rejects missing files, folders, and paths outside the root', async () => {
    expect(await resolveOpenFile(tmpDir, 'missing.md')).toBeNull();
    expect(await resolveOpenFile(tmpDir, 'sub')).toBeNull();
    expect(await resolveOpenFile(tmpDir, '.')).toBeNull();
    expect(await resolveOpenFile(path.join(tmpDir, 'sub'), '../GUIDE.md')).toBeNull();
  });
});
