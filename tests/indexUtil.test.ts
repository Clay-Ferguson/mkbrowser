import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as yaml from 'js-yaml';
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
import type { IndexEntry, IndexOptions } from '../src/utils/indexUtil';
import { parseFrontMatter } from '../src/utils/fileUtil';
import { INDEX_FILENAME } from '../src/utils/specialFiles';
import { logger } from '../src/utils/logUtil';

type IndexData = { files: IndexEntry[]; options: IndexOptions };

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

function readIndex(): IndexData {
  return yaml.load(fs.readFileSync(indexPath(), 'utf8')) as IndexData;
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
// INDEX_FILENAME constant
// ---------------------------------------------------------------------------

describe('INDEX_FILENAME', () => {
  it('matches the Document Mode index naming convention', () => {
    // Pins the centralized constant to the literal the rest of the codebase
    // (and these tests) rely on, so a typo there can't silently change the name.
    expect(INDEX_FILENAME).toBe('.INDEX.yaml');
  });

  it('is the exact filename written to disk by reconcileIndexedFiles', async () => {
    touchFile('a.md');
    await reconcileIndexedFiles(tmpDir, true);
    expect(fs.existsSync(path.join(tmpDir, INDEX_FILENAME))).toBe(true);
  });
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

  it('logs a warning for a malformed index but stays silent on a missing one', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      // Missing file (ENOENT) is the expected "not Document Mode" case — no log.
      expect(await readIndexYaml(tmpDir)).toBeNull();
      expect(warn).not.toHaveBeenCalled();

      // Corrupt YAML is unexpected — it should be surfaced at warn level.
      fs.writeFileSync(indexPath(), ': : invalid: yaml: [[[', 'utf8');
      expect(await readIndexYaml(tmpDir)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(INDEX_FILENAME);
    } finally {
      warn.mockRestore();
    }
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
    expect(readIndex().files.map((f: IndexEntry) => f.name)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('inserts after the named entry', async () => {
    writeIndex({ files: [{ name: 'a.md' }, { name: 'c.md' }] });
    await insertIntoIndexYaml(tmpDir, 'b.md', 'a.md');
    expect(readIndex().files.map((f: IndexEntry) => f.name)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('appends at end when insertAfterName is not found', async () => {
    writeIndex({ files: [{ name: 'a.md' }] });
    await insertIntoIndexYaml(tmpDir, 'z.md', 'missing.md');
    expect(readIndex().files.map((f: IndexEntry) => f.name)).toEqual(['a.md', 'z.md']);
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
    const names = readIndex().files.map((f: IndexEntry) => f.name);
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
    expect(readIndex().files.map((f: IndexEntry) => f.name)).toEqual(['b.md', 'a.md', 'c.md']);
  });

  it('moves an entry down one position', async () => {
    writeIndex({ files: [{ name: 'a.md' }, { name: 'b.md' }, { name: 'c.md' }] });
    await moveInIndexYaml(tmpDir, 'b.md', 'down');
    expect(readIndex().files.map((f: IndexEntry) => f.name)).toEqual(['a.md', 'c.md', 'b.md']);
  });

  it('returns success without change when already at top and moving up', async () => {
    writeIndex({ files: [{ name: 'a.md' }, { name: 'b.md' }] });
    const result = await moveInIndexYaml(tmpDir, 'a.md', 'up');
    expect(result.success).toBe(true);
    expect(readIndex().files.map((f: IndexEntry) => f.name)).toEqual(['a.md', 'b.md']);
  });

  it('returns success without change when already at bottom and moving down', async () => {
    writeIndex({ files: [{ name: 'a.md' }, { name: 'b.md' }] });
    const result = await moveInIndexYaml(tmpDir, 'b.md', 'down');
    expect(result.success).toBe(true);
    expect(readIndex().files.map((f: IndexEntry) => f.name)).toEqual(['a.md', 'b.md']);
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
    const names = readIndex().files.map((f: IndexEntry) => f.name);
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
    const names = readIndex().files.map((f: IndexEntry) => f.name);
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
    const names = readIndex().files.map((f: IndexEntry) => f.name);
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
    expect(data.files.some((f: IndexEntry) => f.name === 'a.md')).toBe(true);
  });

  it('removes deleted entries from existing index', async () => {
    touchFile('a.md', '---\nid: ABC000001\n---\n# A');
    writeIndex({ files: [{ name: 'a.md', id: 'ABC000001' }, { name: 'gone.md', id: 'XYZ000002' }] });
    await reconcileIndexedFiles(tmpDir);
    const names = readIndex().files.map((f: IndexEntry) => f.name);
    expect(names).toContain('a.md');
    expect(names).not.toContain('gone.md');
  });

  it('appends new markdown files not in the index', async () => {
    touchFile('a.md', '---\nid: ABC000001\n---\n# A');
    touchFile('b.md', '# B');
    writeIndex({ files: [{ name: 'a.md', id: 'ABC000001' }] });
    await reconcileIndexedFiles(tmpDir);
    const names = readIndex().files.map((f: IndexEntry) => f.name);
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

  it('re-keys a duplicate front-matter id so copied markdown files get distinct ids', async () => {
    // b.md is a copy of a.md and carries the same front-matter id
    touchFile('a.md', '---\nid: DUP000001\n---\n# A');
    touchFile('b.md', '---\nid: DUP000001\n---\n# B');
    writeIndex({ files: [{ name: 'a.md', id: 'DUP000001' }] });

    await reconcileIndexedFiles(tmpDir);

    // Both files appear in the index, no entry lost
    const data = readIndex();
    expect(data.files.map((f: IndexEntry) => f.name).sort()).toEqual(['a.md', 'b.md']);

    // Both index entries have distinct, defined ids
    const ids = data.files.map((f: IndexEntry) => f.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(2);

    // Front matter on disk is also distinct
    const aId = parseFrontMatter(fs.readFileSync(path.join(tmpDir, 'a.md'), 'utf8')).yaml?.id;
    const bId = parseFrontMatter(fs.readFileSync(path.join(tmpDir, 'b.md'), 'utf8')).yaml?.id;
    expect(aId).toBeTruthy();
    expect(bId).toBeTruthy();
    expect(aId).not.toBe(bId);
  });

  it('lets the oldest file keep a shared id and re-keys the newer copy', async () => {
    // a.md is created first (the original); b.md is created after (the paste).
    touchFile('a.md', '---\nid: DUP000001\n---\n# A');
    await new Promise((r) => setTimeout(r, 20));
    touchFile('b.md', '---\nid: DUP000001\n---\n# B');
    writeIndex({ files: [{ name: 'a.md', id: 'DUP000001' }] });

    await reconcileIndexedFiles(tmpDir);

    // The older original keeps the original id; the newer copy gets a fresh one.
    const aId = parseFrontMatter(fs.readFileSync(path.join(tmpDir, 'a.md'), 'utf8')).yaml?.id;
    const bId = parseFrontMatter(fs.readFileSync(path.join(tmpDir, 'b.md'), 'utf8')).yaml?.id;
    expect(aId).toBe('DUP000001');
    expect(bId).not.toBe('DUP000001');

    // The pre-existing index entry still maps DUP000001 → a.md (identity preserved).
    const data = readIndex();
    const aEntry = data.files.find((f: IndexEntry) => f.name === 'a.md');
    expect(aEntry?.id).toBe('DUP000001');
  });

  it('preserves other front-matter fields when re-keying a duplicate id', async () => {
    touchFile('a.md', '---\nid: DUP000001\ntitle: Original\n---\n# A');
    await new Promise((r) => setTimeout(r, 20));
    touchFile('b.md', '---\nid: DUP000001\ntitle: Copy\ntags:\n  - x\n---\n# B');
    writeIndex({ files: [{ name: 'a.md', id: 'DUP000001' }] });

    await reconcileIndexedFiles(tmpDir);

    // b.md is re-keyed, but its other front-matter fields survive untouched.
    const bFm = parseFrontMatter(fs.readFileSync(path.join(tmpDir, 'b.md'), 'utf8')).yaml;
    expect(bFm?.id).not.toBe('DUP000001');
    expect(bFm?.title).toBe('Copy');
    expect(bFm?.tags).toEqual(['x']);
  });

  it('re-keys all but the oldest when three files share an id', async () => {
    touchFile('a.md', '---\nid: DUP000001\n---\n# A');
    await new Promise((r) => setTimeout(r, 20));
    touchFile('b.md', '---\nid: DUP000001\n---\n# B');
    await new Promise((r) => setTimeout(r, 20));
    touchFile('c.md', '---\nid: DUP000001\n---\n# C');
    writeIndex({ files: [{ name: 'a.md', id: 'DUP000001' }] });

    await reconcileIndexedFiles(tmpDir);

    const idOf = (name: string) =>
      parseFrontMatter(fs.readFileSync(path.join(tmpDir, name), 'utf8')).yaml?.id;
    const aId = idOf('a.md');
    const bId = idOf('b.md');
    const cId = idOf('c.md');

    // Oldest keeps the id; the two newer copies get fresh, mutually distinct ids.
    expect(aId).toBe('DUP000001');
    expect(new Set([aId, bId, cId]).size).toBe(3);

    // All three end up in the index with those distinct ids.
    const indexIds = readIndex().files.map((f: IndexEntry) => f.id);
    expect(new Set(indexIds).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// YAML line-folding (lineWidth: -1) — long values must not be wrapped
// ---------------------------------------------------------------------------

describe('YAML dump does not fold long lines', () => {
  function readRaw(name: string) {
    return fs.readFileSync(path.join(tmpDir, name), 'utf8');
  }

  it('keeps a >80-char filename on a single line in .INDEX.yaml', async () => {
    // js-yaml's default lineWidth (80) folds plain scalars at spaces, so a long
    // descriptive filename would be split across lines. lineWidth: -1 disables
    // that. The parsed value round-trips either way, so assert on the raw text.
    const longName =
      'a very long descriptive markdown filename that keeps going well past eighty columns wide.md';
    expect(longName.length).toBeGreaterThan(80);

    await insertIntoIndexYaml(tmpDir, longName, null);

    const raw = fs.readFileSync(indexPath(), 'utf8');
    // The full name appears verbatim on one line — folding would insert a
    // newline + indent mid-name, breaking this substring match.
    expect(raw).toContain(longName);
  });

  it('does not reflow a long front-matter value when injecting an id', async () => {
    const longTitle =
      'This is an extremely long front matter title that runs well beyond eighty characters of width';
    expect(longTitle.length).toBeGreaterThan(80);
    // Markdown file with front matter but no id — reconcile rewrites it to add one.
    touchFile('a.md', `---\ntitle: ${longTitle}\n---\n# Body`);
    writeIndex({ files: [] });

    await reconcileIndexedFiles(tmpDir);

    const raw = readRaw('a.md');
    expect(raw).toContain('id:');
    // The user's title must survive intact on one line, not folded.
    expect(raw).toContain(longTitle);
  });
});
