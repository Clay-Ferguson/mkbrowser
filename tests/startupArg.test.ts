/**
 * Positional command-line argument tests — resolving a folder or file argument to
 * the browse root (and file) to open at startup. Runs against a fresh temp folder
 * per test.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveStartupArg } from '../src/main/startupArg';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'startup-arg-test-'));
  await fs.promises.mkdir(path.join(tmpDir, 'sub'));
  await fs.promises.writeFile(path.join(tmpDir, 'sub', 'note.md'), '# Note');
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('resolveStartupArg', () => {
  it('opens a folder argument as the browse root', async () => {
    const folder = path.join(tmpDir, 'sub');
    expect(await resolveStartupArg(folder, undefined)).toEqual({ browseFolder: folder });
  });

  it("opens a file argument with its own folder as the root", async () => {
    const file = path.join(tmpDir, 'sub', 'note.md');
    expect(await resolveStartupArg(file, undefined)).toEqual({ browseFolder: path.join(tmpDir, 'sub'), file });
  });

  it('keeps the saved browse root when it already contains the file', async () => {
    const file = path.join(tmpDir, 'sub', 'note.md');
    expect(await resolveStartupArg(file, tmpDir)).toEqual({ browseFolder: tmpDir, file });
  });

  it('ignores a saved browse root that does not contain the file', async () => {
    const file = path.join(tmpDir, 'sub', 'note.md');
    const other = path.join(tmpDir, 'other');
    expect(await resolveStartupArg(file, other)).toEqual({ browseFolder: path.join(tmpDir, 'sub'), file });
  });

  it('resolves a relative argument against the working directory', async () => {
    const relative = path.relative(process.cwd(), path.join(tmpDir, 'sub', 'note.md'));
    expect((await resolveStartupArg(relative, undefined))?.file).toBe(path.join(tmpDir, 'sub', 'note.md'));
  });

  it('returns null for a missing path', async () => {
    expect(await resolveStartupArg(path.join(tmpDir, 'missing.md'), undefined)).toBeNull();
  });
});
