/**
 * exportFolderContents tests — focused on the case where the export output lands
 * inside the source tree, which makes the output file eligible input for the next
 * export of the same folder. Each test runs against a fresh temp folder since
 * these read and write real files on disk.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exportFolderContents } from '../src/main/exportUtil';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

/** Export tmpDir into `outputFolder`, with filename headers and dividers off. */
function exportInto(outputFolder: string, fileName: string, includeSubfolders = false) {
  return exportFolderContents(tmpDir, outputFolder, fileName, includeSubfolders, false, false);
}

describe('exportFolderContents', () => {
  it('does not read its own output back in when exporting a folder into itself', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'a.md'), 'alpha', 'utf8');

    const first = await exportInto(tmpDir, 'out.md');
    expect(first.success).toBe(true);
    const firstContent = await fs.promises.readFile(first.outputPath!, 'utf8');
    expect(firstContent).toBe('alpha');

    // The second run sees out.md sitting in the source folder; it must skip it
    // rather than concatenate the previous run's text onto this one's.
    const second = await exportInto(tmpDir, 'out.md');
    expect(second.success).toBe(true);
    expect(await fs.promises.readFile(second.outputPath!, 'utf8')).toBe(firstContent);
  });

  it('does not read its own output back in when exporting into a subfolder with subfolders included', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'a.md'), 'alpha', 'utf8');
    const outDir = path.join(tmpDir, 'exports');
    await fs.promises.mkdir(outDir);

    const first = await exportInto(outDir, 'out.md', true);
    expect(first.success).toBe(true);
    expect(await fs.promises.readFile(first.outputPath!, 'utf8')).toBe('alpha');

    const second = await exportInto(outDir, 'out.md', true);
    expect(second.success).toBe(true);
    expect(await fs.promises.readFile(second.outputPath!, 'utf8')).toBe('alpha');
  });

  it('leaves no temp file behind in the output folder', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'a.md'), 'alpha', 'utf8');
    const outDir = path.join(tmpDir, 'exports');
    await fs.promises.mkdir(outDir);

    await exportInto(outDir, 'out.md');

    expect(await fs.promises.readdir(outDir)).toEqual(['out.md']);
  });

  it('still exports other markdown files that are not the output', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'a.md'), 'alpha', 'utf8');
    await fs.promises.writeFile(path.join(tmpDir, 'b.md'), 'beta', 'utf8');

    const result = await exportInto(tmpDir, 'out.md');

    expect(result.success).toBe(true);
    expect(await fs.promises.readFile(result.outputPath!, 'utf8')).toBe('alpha\n\nbeta');
  });
});
