import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import yaml from 'js-yaml';
import {
  readIndexYaml,
  reconcileIndexedFiles,
  writeIndexOptions,
  moveInIndexYaml,
  moveToEdgeInIndexYaml,
  insertIntoIndexYaml,
  renameInIndexYaml,
  getSortedDirEntries,
  validateAttachFolderLocation,
} from '../src/utils/indexUtil';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function indexPath() {
  return path.join(tmpDir, '.INDEX.yaml');
}

function writeIndex(data: object) {
  fs.writeFileSync(indexPath(), yaml.dump(data, { indent: 2 }), 'utf8');
}

function readIndex(): any {
  return yaml.load(fs.readFileSync(indexPath(), 'utf8'));
}

function touchFile(name: string, content = '') {
  fs.writeFileSync(path.join(tmpDir, name), content, 'utf8');
}

function makeDir(name: string) {
  fs.mkdirSync(path.join(tmpDir, name));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'indexUtil-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// readIndexYaml
// ---------------------------------------------------------------------------

describe('readIndexYaml', () => {
  it('returns null when no .INDEX.yaml exists', async () => {
    expect(await readIndexYaml(tmpDir)).toBeNull();
  });

  it('returns parsed object when file exists', async () => {
    writeIndex({ files: [{ name: 'a.md' }] });
    const result = await readIndexYaml(tmpDir);
    expect(result?.files).toHaveLength(1);
    expect(result?.files?.[0].name).toBe('a.md');
  });

  it('returns null for an unreadable/malformed file', async () => {
    fs.writeFileSync(indexPath(), ': : invalid: yaml: [[[', 'utf8');
    expect(await readIndexYaml(tmpDir)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// writeIndexOptions
// ---------------------------------------------------------------------------

describe('writeIndexOptions', () => {
  it('creates .INDEX.yaml with options when none exists', async () => {
    const result = await writeIndexOptions(tmpDir, { pinned: true });
    expect(result.success).toBe(true);
    const data = readIndex();
    expect(data.options?.pinned).toBe(true);
  });

  it('merges options into existing .INDEX.yaml preserving files', async () => {
    writeIndex({ files: [{ name: 'a.md' }], options: { pinned: false } });
    await writeIndexOptions(tmpDir, { pinned: true });
    const data = readIndex();
    expect(data.options.pinned).toBe(true);
    expect(data.files[0].name).toBe('a.md');
  });
});

// ---------------------------------------------------------------------------
// insertIntoIndexYaml
// ---------------------------------------------------------------------------

describe('insertIntoIndexYaml', () => {
  it('inserts at position 0 when insertAfterName is null', async () => {
    writeIndex({ files: [{ name: 'b.md' }, { name: 'c.md' }] });
    await insertIntoIndexYaml(tmpDir, 'a.md', null);
    expect(readIndex().files.map((f: any) => f.name)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('inserts after the named entry', async () => {
    writeIndex({ files: [{ name: 'a.md' }, { name: 'c.md' }] });
    await insertIntoIndexYaml(tmpDir, 'b.md', 'a.md');
    expect(readIndex().files.map((f: any) => f.name)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('appends at end when insertAfterName is not found', async () => {
    writeIndex({ files: [{ name: 'a.md' }] });
    await insertIntoIndexYaml(tmpDir, 'z.md', 'missing.md');
    expect(readIndex().files.map((f: any) => f.name)).toEqual(['a.md', 'z.md']);
  });

  it('creates .INDEX.yaml when none exists', async () => {
    await insertIntoIndexYaml(tmpDir, 'new.md', null);
    expect(readIndex().files[0].name).toBe('new.md');
  });
});

// ---------------------------------------------------------------------------
// renameInIndexYaml
// ---------------------------------------------------------------------------

describe('renameInIndexYaml', () => {
  it('renames matching entry', async () => {
    writeIndex({ files: [{ name: 'old.md', id: 'ABC' }, { name: 'other.md' }] });
    await renameInIndexYaml(tmpDir, 'old.md', 'new.md');
    const names = readIndex().files.map((f: any) => f.name);
    expect(names).toContain('new.md');
    expect(names).not.toContain('old.md');
  });

  it('preserves id on renamed entry', async () => {
    writeIndex({ files: [{ name: 'old.md', id: 'ABC123' }] });
    await renameInIndexYaml(tmpDir, 'old.md', 'new.md');
    expect(readIndex().files[0].id).toBe('ABC123');
  });

  it('is a no-op when oldName is not found', async () => {
    writeIndex({ files: [{ name: 'a.md' }] });
    await renameInIndexYaml(tmpDir, 'missing.md', 'x.md');
    expect(readIndex().files[0].name).toBe('a.md');
  });

  it('is a no-op when no .INDEX.yaml exists', async () => {
    await expect(renameInIndexYaml(tmpDir, 'a.md', 'b.md')).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// moveInIndexYaml
// ---------------------------------------------------------------------------

describe('moveInIndexYaml', () => {
  it('moves an entry up one position', async () => {
    writeIndex({ files: [{ name: 'a.md' }, { name: 'b.md' }, { name: 'c.md' }] });
    await moveInIndexYaml(tmpDir, 'b.md', 'up');
    expect(readIndex().files.map((f: any) => f.name)).toEqual(['b.md', 'a.md', 'c.md']);
  });

  it('moves an entry down one position', async () => {
    writeIndex({ files: [{ name: 'a.md' }, { name: 'b.md' }, { name: 'c.md' }] });
    await moveInIndexYaml(tmpDir, 'b.md', 'down');
    expect(readIndex().files.map((f: any) => f.name)).toEqual(['a.md', 'c.md', 'b.md']);
  });

  it('returns success without change when already at top and moving up', async () => {
    writeIndex({ files: [{ name: 'a.md' }, { name: 'b.md' }] });
    const result = await moveInIndexYaml(tmpDir, 'a.md', 'up');
    expect(result.success).toBe(true);
    expect(readIndex().files.map((f: any) => f.name)).toEqual(['a.md', 'b.md']);
  });

  it('returns success without change when already at bottom and moving down', async () => {
    writeIndex({ files: [{ name: 'a.md' }, { name: 'b.md' }] });
    const result = await moveInIndexYaml(tmpDir, 'b.md', 'down');
    expect(result.success).toBe(true);
    expect(readIndex().files.map((f: any) => f.name)).toEqual(['a.md', 'b.md']);
  });

  it('returns error when entry is not found', async () => {
    writeIndex({ files: [{ name: 'a.md' }] });
    const result = await moveInIndexYaml(tmpDir, 'missing.md', 'up');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('skips over an attach folder when moving up', async () => {
    writeIndex({
      files: [{ name: 'a.md' }, { name: 'a.md.attach' }, { name: 'b.md' }],
    });
    await moveInIndexYaml(tmpDir, 'b.md', 'up');
    // b.md should skip past a.md.attach and land before a.md
    const names = readIndex().files.map((f: any) => f.name);
    expect(names[0]).toBe('b.md');
  });
});

// ---------------------------------------------------------------------------
// moveToEdgeInIndexYaml
// ---------------------------------------------------------------------------

describe('moveToEdgeInIndexYaml', () => {
  it('moves entry to top', async () => {
    writeIndex({ files: [{ name: 'a.md' }, { name: 'b.md' }, { name: 'c.md' }] });
    await moveToEdgeInIndexYaml(tmpDir, 'c.md', 'top');
    expect(readIndex().files[0].name).toBe('c.md');
  });

  it('moves entry to bottom', async () => {
    writeIndex({ files: [{ name: 'a.md' }, { name: 'b.md' }, { name: 'c.md' }] });
    await moveToEdgeInIndexYaml(tmpDir, 'a.md', 'bottom');
    const names = readIndex().files.map((f: any) => f.name);
    expect(names[names.length - 1]).toBe('a.md');
  });

  it('returns error when entry is not found', async () => {
    writeIndex({ files: [{ name: 'a.md' }] });
    const result = await moveToEdgeInIndexYaml(tmpDir, 'missing.md', 'top');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateAttachFolderLocation
// ---------------------------------------------------------------------------

describe('validateAttachFolderLocation', () => {
  it('reorders attach folder to follow its parent file', async () => {
    writeIndex({
      files: [{ name: 'a.md.attach' }, { name: 'a.md' }, { name: 'b.md' }],
    });
    await validateAttachFolderLocation(tmpDir);
    const names = readIndex().files.map((f: any) => f.name);
    const aIdx = names.indexOf('a.md');
    const attachIdx = names.indexOf('a.md.attach');
    expect(attachIdx).toBe(aIdx + 1);
  });

  it('leaves correctly ordered attach folders unchanged', async () => {
    writeIndex({
      files: [{ name: 'a.md' }, { name: 'a.md.attach' }, { name: 'b.md' }],
    });
    const before = fs.statSync(indexPath()).mtimeMs;
    await validateAttachFolderLocation(tmpDir);
    const after = fs.statSync(indexPath()).mtimeMs;
    // File should not be rewritten
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// getSortedDirEntries
// ---------------------------------------------------------------------------

describe('getSortedDirEntries', () => {
  it('returns entries alphabetically when no .INDEX.yaml exists', async () => {
    touchFile('c.md');
    touchFile('a.md');
    touchFile('b.md');
    const entries = await getSortedDirEntries(tmpDir);
    expect(entries.map((e) => e.name)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('returns entries in index order when .INDEX.yaml exists', async () => {
    touchFile('a.md');
    touchFile('b.md');
    touchFile('c.md');
    writeIndex({ files: [{ name: 'c.md' }, { name: 'a.md' }, { name: 'b.md' }] });
    const entries = await getSortedDirEntries(tmpDir);
    expect(entries.map((e) => e.name)).toEqual(['c.md', 'a.md', 'b.md']);
  });

  it('appends disk entries not listed in the index at the end', async () => {
    touchFile('a.md');
    touchFile('b.md');
    touchFile('z.md');
    writeIndex({ files: [{ name: 'a.md' }, { name: 'b.md' }] });
    const entries = await getSortedDirEntries(tmpDir);
    expect(entries.map((e) => e.name)).toEqual(['a.md', 'b.md', 'z.md']);
  });

  it('excludes hidden files', async () => {
    touchFile('visible.md');
    touchFile('.hidden.md');
    const entries = await getSortedDirEntries(tmpDir);
    expect(entries.map((e) => e.name)).not.toContain('.hidden.md');
  });

  it('marks directories with isDir=true', async () => {
    makeDir('subdir');
    touchFile('file.md');
    const entries = await getSortedDirEntries(tmpDir);
    const subdir = entries.find((e) => e.name === 'subdir');
    const file = entries.find((e) => e.name === 'file.md');
    expect(subdir?.isDir).toBe(true);
    expect(file?.isDir).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reconcileIndexedFiles
// ---------------------------------------------------------------------------

describe('reconcileIndexedFiles', () => {
  it('is a no-op when no .INDEX.yaml and createIfMissing=false', async () => {
    touchFile('a.md', '# Hello');
    await reconcileIndexedFiles(tmpDir, false);
    expect(fs.existsSync(indexPath())).toBe(false);
  });

  it('creates .INDEX.yaml when createIfMissing=true', async () => {
    touchFile('a.md', '# Hello');
    await reconcileIndexedFiles(tmpDir, true);
    expect(fs.existsSync(indexPath())).toBe(true);
    const data = readIndex();
    expect(data.files.some((f: any) => f.name === 'a.md')).toBe(true);
  });

  it('removes deleted entries from existing index', async () => {
    touchFile('a.md', '---\nid: ABC000001\n---\n# A');
    writeIndex({ files: [{ name: 'a.md', id: 'ABC000001' }, { name: 'gone.md', id: 'XYZ000002' }] });
    await reconcileIndexedFiles(tmpDir);
    const names = readIndex().files.map((f: any) => f.name);
    expect(names).toContain('a.md');
    expect(names).not.toContain('gone.md');
  });

  it('appends new markdown files not in the index', async () => {
    touchFile('a.md', '---\nid: ABC000001\n---\n# A');
    touchFile('b.md', '# B');
    writeIndex({ files: [{ name: 'a.md', id: 'ABC000001' }] });
    await reconcileIndexedFiles(tmpDir);
    const names = readIndex().files.map((f: any) => f.name);
    expect(names).toContain('b.md');
  });

  it('writes an id into front matter of a markdown file that lacks one', async () => {
    touchFile('a.md', '# No front matter');
    writeIndex({ files: [] });
    await reconcileIndexedFiles(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, 'a.md'), 'utf8');
    expect(content).toMatch(/^---\n/);
    expect(content).toMatch(/id:/);
  });
});
