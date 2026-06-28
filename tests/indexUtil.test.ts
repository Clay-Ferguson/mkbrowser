import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as yaml from 'js-yaml';
import {
  readIndexYaml,
  reconcileIndexedFiles,
  reconcileEntries,
  appendNewEntries,
  writeIndexOptions,
  moveInIndexYaml,
  moveToEdgeInIndexYaml,
  insertIntoIndexYaml,
  renameInIndexYaml,
  getSortedDirEntries,
  validateAttachFolderLocation,
  ensureFrontMatterIdIfIndexed,
  recordFrontMatterIdInIndex,
} from '../src/main/indexUtil';
import type { IndexEntry, IndexOptions } from '../src/main/indexUtil';
import { readDirectory } from '../src/main/fileUtil';
import { parseFrontMatter } from '../src/shared/frontMatterUtil';
import { INDEX_FILENAME } from '../src/shared/specialFiles';
import { logger } from '../src/shared/logUtil';

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
// Malformed-but-valid YAML (untrusted / hand-edited index content)
//
// .INDEX.yaml is a plain file the user (or an external sync/merge tool) can
// corrupt into something that is valid YAML but the wrong *shape*. The schema
// in indexUtil must normalize these cleanly — never throw, never character-
// iterate a string, never let a non-string `name` reach `.endsWith(...)`.
// ---------------------------------------------------------------------------

describe('malformed .INDEX.yaml is normalized, not trusted', () => {
  it('treats a non-array `files` (valid YAML scalar) as empty', async () => {
    fs.writeFileSync(indexPath(), 'files: hello\n', 'utf8');
    const result = await readIndexYaml(tmpDir);
    expect(result?.files).toEqual([]);
  });

  it('drops entries that are not { name: string } but keeps the good ones', async () => {
    // A mix: a valid entry, an entry missing `name`, an entry with a numeric
    // `name`, and a bare scalar element.
    writeIndex({ files: [{ name: 'a.md' }, { id: 'X' }, { name: 123 }, 'oops'] });
    const result = await readIndexYaml(tmpDir);
    expect(result?.files).toEqual([{ name: 'a.md' }]);
  });

  it('treats a non-object `options` as empty', async () => {
    fs.writeFileSync(indexPath(), 'files: []\noptions: nope\n', 'utf8');
    const result = await readIndexYaml(tmpDir);
    expect(result?.options).toEqual({});
  });

  it('returns null for a top-level scalar or list document', async () => {
    fs.writeFileSync(indexPath(), 'just a string\n', 'utf8');
    expect(await readIndexYaml(tmpDir)).toBeNull();

    fs.writeFileSync(indexPath(), '- a\n- b\n', 'utf8');
    expect(await readIndexYaml(tmpDir)).toBeNull();
  });

  it('getSortedDirEntries falls back to alphabetical when `files` is a string', async () => {
    touchFile('b.md');
    touchFile('a.md');
    fs.writeFileSync(indexPath(), 'files: not-an-array\n', 'utf8');
    // Must not iterate the string's characters or throw.
    const names = (await getSortedDirEntries(tmpDir)).map((e) => e.name);
    expect(names).toEqual(['a.md', 'b.md']);
  });

  it('reorder/insert operations do not throw on a malformed index', async () => {
    touchFile('a.md');
    fs.writeFileSync(indexPath(), 'files: not-an-array\n', 'utf8');
    await expect(moveInIndexYaml(tmpDir, 'a.md', 'up')).resolves.not.toThrow();
    await expect(insertIntoIndexYaml(tmpDir, 'a.md', null)).resolves.toMatchObject({ success: true });
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
// insertIntoIndexYaml seeds identity at insert time (issue 012)
//
// Unlike the bulk reconcile append path, the insert bars splice a single new
// entry in. That entry must carry its identity immediately — an id for markdown,
// a create_time/size fingerprint for other files — so a rename of the freshly
// inserted file is tracked without waiting for the next reconcile.
// ---------------------------------------------------------------------------

describe('insertIntoIndexYaml seeds identity at insert time', () => {
  function readRaw(name: string) {
    return fs.readFileSync(path.join(tmpDir, name), 'utf8');
  }

  it('assigns a front-matter id to an inserted markdown file and records it on the entry', async () => {
    touchFile('a.md', '# Hello\n'); // no front matter yet
    writeIndex({ files: [] });

    await insertIntoIndexYaml(tmpDir, 'a.md', null);

    const entry = readIndex().files[0];
    expect(entry.name).toBe('a.md');
    expect(entry.id).toMatch(/^[0-9A-F]{9}$/);
    // The id is also persisted to the file's front matter, so it survives renames.
    const { yaml: fm } = parseFrontMatter(readRaw('a.md'));
    expect(fm?.id).toBe(entry.id);
  });

  it('reuses an existing front-matter id rather than minting a new one', async () => {
    touchFile('a.md', '---\nid: ABCDEF123\n---\n# Hello\n');
    writeIndex({ files: [] });

    await insertIntoIndexYaml(tmpDir, 'a.md', null);

    expect(readIndex().files[0].id).toBe('ABCDEF123');
  });

  it('records a create_time/size fingerprint for an inserted non-markdown file', async () => {
    touchFile('cover.png', 'binary-ish');
    writeIndex({ files: [] });

    await insertIntoIndexYaml(tmpDir, 'cover.png', null);

    const entry = readIndex().files[0];
    expect(entry.name).toBe('cover.png');
    expect(entry.id).toBeUndefined();
    expect(typeof entry.create_time).toBe('number');
    expect(entry.size).toBe('binary-ish'.length);
  });

  it('inserts a folder as a name-only entry', async () => {
    makeDir('Chapter 1');
    writeIndex({ files: [] });

    await insertIntoIndexYaml(tmpDir, 'Chapter 1', null);

    const entry = readIndex().files[0];
    expect(entry).toEqual({ name: 'Chapter 1' });
  });

  it('degrades to a name-only entry when the file is not on disk', async () => {
    // Best-effort: a stat failure must not fail the insert (older behavior).
    writeIndex({ files: [] });

    const result = await insertIntoIndexYaml(tmpDir, 'ghost.md', null);

    expect(result.success).toBe(true);
    expect(readIndex().files[0]).toEqual({ name: 'ghost.md' });
  });

  it('lets id-based rename detection fire on a freshly inserted markdown file before any full reconcile', async () => {
    // Insert seeds the entry's id; renaming the file (id stays in front matter)
    // and reconciling re-points the entry by id to the new name.
    touchFile('draft.md', '# Draft\n');
    writeIndex({ files: [] });
    await insertIntoIndexYaml(tmpDir, 'draft.md', null);
    const id = readIndex().files[0].id;
    expect(id).toBeTruthy();

    // Simulate a rename: move the file (front matter, incl. id, comes along).
    fs.renameSync(path.join(tmpDir, 'draft.md'), path.join(tmpDir, 'final.md'));
    await reconcileIndexedFiles(tmpDir);

    const names = readIndex().files.map((f: IndexEntry) => f.name);
    expect(names).toEqual(['final.md']); // re-pointed, not dropped+re-appended
    expect(readIndex().files[0].id).toBe(id);
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
// Error-handling contract (issue 016): mutators return { success, error } and
// never throw; documented no-ops are success; getSortedDirEntries deliberately
// throws on a hard readdir failure.
// ---------------------------------------------------------------------------

describe('error-handling contract (issue 016)', () => {
  it('reconcileIndexedFiles returns { success: true } on the happy path', async () => {
    touchFile('a.md', '# A');
    const result = await reconcileIndexedFiles(tmpDir, true);
    expect(result).toEqual({ success: true });
  });

  it('reconcileIndexedFiles is a success no-op for a non-Document-Mode folder', async () => {
    touchFile('a.md', '# A');
    // No .INDEX.yaml and createIfMissing=false: nothing to do, but not a failure.
    const result = await reconcileIndexedFiles(tmpDir, false);
    expect(result).toEqual({ success: true });
    expect(fs.existsSync(indexPath())).toBe(false);
  });

  it('reconcileIndexedFiles returns { success: false, error } when the directory cannot be read', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const missingDir = path.join(tmpDir, 'does-not-exist');
    // createIfMissing=true forces it past the "no index" no-op into the readdir,
    // which fails (ENOENT) — surfaced as a structured error, not a throw.
    const result = await reconcileIndexedFiles(missingDir, true);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    warnSpy.mockRestore();
  });

  it('renameInIndexYaml returns { success: true } on a rename and on a no-op', async () => {
    writeIndex({ files: [{ name: 'old.md', id: 'ABC' }] });
    await expect(renameInIndexYaml(tmpDir, 'old.md', 'new.md')).resolves.toEqual({ success: true });
    // oldName no longer present — a documented no-op, still success.
    await expect(renameInIndexYaml(tmpDir, 'old.md', 'x.md')).resolves.toEqual({ success: true });
  });

  it('getSortedDirEntries throws on an unreadable directory (intentional, see its doc)', async () => {
    const missingDir = path.join(tmpDir, 'does-not-exist');
    await expect(getSortedDirEntries(missingDir)).rejects.toThrow();
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
// Export order (getSortedDirEntries) must match display order (readDirectory)
// for an indexed folder — they share one ordering primitive. (issue 015)
// ---------------------------------------------------------------------------

describe('getSortedDirEntries and readDirectory agree on indexed ordering (issue 015)', () => {
  it('produce identical order, including extras not yet in the index', async () => {
    touchFile('c.md');
    touchFile('a.md');
    touchFile('b.md');
    // Extras present on disk but NOT listed in the index (e.g. just-created
    // files not yet reconciled). This is the case the two functions used to
    // order differently: readDirectory sorted extras by name, getSortedDirEntries
    // appended them in raw readdir order.
    touchFile('extra2.md');
    touchFile('extra1.md');
    makeDir('zsub');
    writeIndex({ files: [{ name: 'c.md' }, { name: 'a.md' }, { name: 'b.md' }] });

    const exportOrder = (await getSortedDirEntries(tmpDir)).map((e) => e.name);
    const displayOrder = (await readDirectory(tmpDir, false)).map((e) => e.name);

    // Indexed entries follow the index; extras come after, by natural name order.
    const expected = ['c.md', 'a.md', 'b.md', 'extra1.md', 'extra2.md', 'zsub'];
    expect(exportOrder).toEqual(expected);
    expect(displayOrder).toEqual(expected);
    expect(exportOrder).toEqual(displayOrder);
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

  it('reconciles two colliding non-markdown files without dropping or re-pointing either (issue 009)', async () => {
    // Two empty pngs share ext (.png) and size (0). Force their birthtimes equal
    // so the "createTime:size:ext" fingerprints collide exactly as they would on a
    // filesystem with an unreliable/zero birthtime — the original bug's trigger.
    // Last-writer-wins fingerprinting would re-point one entry onto the other file
    // and drop/duplicate the genuine one; the fix must leave both intact.
    touchFile('a.png', '');
    touchFile('b.png', '');

    const realStat = fs.promises.stat.bind(fs.promises);
    const statSpy = vi
      .spyOn(fs.promises, 'stat')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(async (p: any) => {
        const s = await realStat(p);
        if (typeof p === 'string' && p.endsWith('.png')) {
          (s as fs.Stats).birthtimeMs = 1000; // identical for both → colliding fingerprint
        }
        return s;
      });

    try {
      writeIndex({
        files: [
          { name: 'a.png', create_time: 1000, size: 0 },
          { name: 'b.png', create_time: 1000, size: 0 },
        ],
      });

      await reconcileIndexedFiles(tmpDir);

      const names = readIndex().files.map((f: IndexEntry) => f.name);
      // Neither entry dropped, neither re-pointed onto the other, no duplicate.
      expect(names.filter((n) => n === 'a.png')).toHaveLength(1);
      expect(names.filter((n) => n === 'b.png')).toHaveLength(1);
      expect([...names].sort()).toEqual(['a.png', 'b.png']);
    } finally {
      statSpy.mockRestore();
    }
  });

  it('assigns a unique id to every file across a large directory (bounded parallel I/O)', async () => {
    // Exercises the parallel stat/read/write fan-out: more files than the
    // concurrency limit, a mix of markdown (which gets ids written) and
    // non-markdown (fingerprinted), all reconciled in one pass.
    const COUNT = 80; // comfortably above RECONCILE_FILE_CONCURRENCY (32)
    for (let i = 0; i < COUNT; i++) {
      touchFile(`doc${i}.md`, `# Doc ${i}`); // no front matter → each needs an id
      touchFile(`asset${i}.png`, `binary-${i}`); // non-markdown → fingerprinted
    }
    writeIndex({ files: [] });

    await reconcileIndexedFiles(tmpDir);

    // Every markdown file got a distinct id, both on disk and in the index.
    const diskIds = Array.from({ length: COUNT }, (_, i) =>
      parseFrontMatter(fs.readFileSync(path.join(tmpDir, `doc${i}.md`), 'utf8')).yaml?.id,
    );
    expect(diskIds.every(Boolean)).toBe(true);
    expect(new Set(diskIds).size).toBe(COUNT);

    const data = readIndex();
    const mdEntries = data.files.filter((f: IndexEntry) => f.name.endsWith('.md'));
    expect(mdEntries).toHaveLength(COUNT);
    expect(new Set(mdEntries.map((f: IndexEntry) => f.id)).size).toBe(COUNT);

    // Non-markdown files are all listed with a (create_time, size) fingerprint.
    const pngEntries = data.files.filter((f: IndexEntry) => f.name.endsWith('.png'));
    expect(pngEntries).toHaveLength(COUNT);
    expect(pngEntries.every((f: IndexEntry) => f.size !== undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reconcileEntries / appendNewEntries (pure helpers)
//
// These are the subtle rename/filter and append branches extracted out of
// reconcileIndexedFiles. They touch no filesystem, so they can be exercised
// directly with plain maps and lightweight fake Dirents.
// ---------------------------------------------------------------------------

// A minimal stand-in for fs.Dirent — reconcileEntries/appendNewEntries only ever
// read `.name` and call `.isDirectory()`.
function fakeDirent(name: string, isDir = false): fs.Dirent {
  return { name, isDirectory: () => isDir } as unknown as fs.Dirent;
}

describe('reconcileEntries', () => {
  const emptyMaps = () => ({
    idToName: new Map<string, string>(),
    fingerprintToVisibleNames: new Map<string, string[]>(),
    nameToId: new Map<string, string>(),
    visibleNames: new Set<string>(),
  });

  it('renames a markdown entry to its file via id and marks it handled', () => {
    const maps = emptyMaps();
    maps.idToName.set('ABC', 'renamed.md');
    const { files, handledNames } = reconcileEntries([{ name: 'old.md', id: 'ABC' }], maps);
    expect(files).toEqual([{ name: 'renamed.md', id: 'ABC' }]);
    expect(handledNames.has('renamed.md')).toBe(true);
  });

  it('drops a markdown entry whose id no longer maps to any file', () => {
    const maps = emptyMaps(); // id 'GONE' not present, name not visible
    const { files, handledNames } = reconcileEntries([{ name: 'gone.md', id: 'GONE' }], maps);
    expect(files).toEqual([]);
    expect(handledNames.size).toBe(0);
  });

  it('renames a fingerprinted non-markdown entry via (create_time,size,ext)', () => {
    const maps = emptyMaps();
    // Unambiguous 1:1 fingerprint: one index entry, one disk file → confident rename.
    maps.fingerprintToVisibleNames.set('100:50:.png', ['new.png']);
    maps.visibleNames.add('new.png');
    const { files, handledNames } = reconcileEntries(
      [{ name: 'old.png', create_time: 100, size: 50 }],
      maps,
    );
    expect(files[0].name).toBe('new.png');
    expect(handledNames.has('new.png')).toBe(true);
  });

  it('drops a fingerprinted entry whose fingerprint is gone', () => {
    const maps = emptyMaps();
    const { files } = reconcileEntries([{ name: 'old.png', create_time: 1, size: 2 }], maps);
    expect(files).toEqual([]);
  });

  it('does not re-point colliding fingerprints — keeps each entry on its own file', () => {
    // Two non-markdown files with an identical fingerprint (same ext, size, and
    // birthtime — e.g. two empty pngs, or any files when birthtime is an
    // unreliable 0). Both still exist on disk under their own names; reconcile
    // must leave each entry pointing at its own file, never collapse onto one.
    const maps = emptyMaps();
    maps.fingerprintToVisibleNames.set('0:0:.png', ['a.png', 'b.png']);
    maps.visibleNames.add('a.png');
    maps.visibleNames.add('b.png');
    const { files, handledNames } = reconcileEntries(
      [
        { name: 'a.png', create_time: 0, size: 0 },
        { name: 'b.png', create_time: 0, size: 0 },
      ],
      maps,
    );
    expect(files.map((f) => f.name)).toEqual(['a.png', 'b.png']);
    expect(handledNames.has('a.png')).toBe(true);
    expect(handledNames.has('b.png')).toBe(true);
  });

  it('falls back to name-only (no re-point) when a fingerprint is ambiguous and a name is gone', () => {
    // Same colliding fingerprint, but one of the two files was renamed away
    // (a.png → c.png). Because the fingerprint is ambiguous we must NOT bind the
    // a.png entry to b.png or c.png; instead a.png is treated as gone (dropped)
    // and b.png stays put. A missed rename is the safe failure mode.
    const maps = emptyMaps();
    maps.fingerprintToVisibleNames.set('0:0:.png', ['b.png', 'c.png']);
    maps.visibleNames.add('b.png');
    maps.visibleNames.add('c.png');
    const { files, handledNames } = reconcileEntries(
      [
        { name: 'a.png', create_time: 0, size: 0 },
        { name: 'b.png', create_time: 0, size: 0 },
      ],
      maps,
    );
    // a.png dropped (not re-pointed), b.png kept on its own file.
    expect(files.map((f) => f.name)).toEqual(['b.png']);
    expect(handledNames.has('a.png')).toBe(false);
    expect(handledNames.has('b.png')).toBe(true);
    // c.png is left unhandled so the caller appends it as a new entry.
    expect(handledNames.has('c.png')).toBe(false);
  });

  it('keeps a name-only entry that is still visible and back-fills its id', () => {
    const maps = emptyMaps();
    maps.visibleNames.add('note.md');
    maps.nameToId.set('note.md', 'NEWID');
    const { files, handledNames } = reconcileEntries([{ name: 'note.md' }], maps);
    expect(files).toEqual([{ name: 'note.md', id: 'NEWID' }]);
    expect(handledNames.has('note.md')).toBe(true);
  });

  it('drops a name-only entry whose file/folder no longer exists', () => {
    const maps = emptyMaps(); // 'ghost' not in visibleNames
    const { files, handledNames } = reconcileEntries([{ name: 'ghost' }], maps);
    expect(files).toEqual([]);
    // Name-only entries are always added to handledNames before the filter runs.
    expect(handledNames.has('ghost')).toBe(true);
  });
});

describe('appendNewEntries', () => {
  const emptyMaps = () => ({
    nameToId: new Map<string, string>(),
    nameToStat: new Map<string, { createTime: number; size: number }>(),
  });

  it('appends a new markdown file with its id', () => {
    const maps = emptyMaps();
    maps.nameToId.set('new.md', 'ID1');
    const result = appendNewEntries([], [fakeDirent('new.md')], new Set(), maps);
    expect(result).toEqual([{ name: 'new.md', id: 'ID1' }]);
  });

  it('appends a new non-markdown file with a create_time+size fingerprint', () => {
    const maps = emptyMaps();
    maps.nameToStat.set('pic.png', { createTime: 7, size: 9 });
    const result = appendNewEntries([], [fakeDirent('pic.png')], new Set(), maps);
    expect(result).toEqual([{ name: 'pic.png', create_time: 7, size: 9 }]);
  });

  it('appends a new folder with just its name', () => {
    const result = appendNewEntries([], [fakeDirent('sub', true)], new Set(), emptyMaps());
    expect(result).toEqual([{ name: 'sub' }]);
  });

  it('skips entries already handled and preserves existing entries first', () => {
    const maps = emptyMaps();
    maps.nameToId.set('b.md', 'IDB');
    const existing = [{ name: 'a.md', id: 'IDA' }];
    const result = appendNewEntries(
      existing,
      [fakeDirent('a.md'), fakeDirent('b.md')],
      new Set(['a.md']),
      maps,
    );
    expect(result).toEqual([{ name: 'a.md', id: 'IDA' }, { name: 'b.md', id: 'IDB' }]);
    // Returns a new array rather than mutating the input.
    expect(result).not.toBe(existing);
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

// ---------------------------------------------------------------------------
// Front-matter id injection (issues 006/007)
//
// The id is added by round-tripping the front matter through js-yaml (we never
// hand-edit YAML text). That normalizes the block — comments are dropped and
// key order/quoting may change — which is acceptable; what must hold is that the
// id is injected (and leads the block) and that the user's field *values* and
// document body survive. Long values must not be line-folded (issue 003).
// ---------------------------------------------------------------------------

describe('injecting an id round-trips front matter without losing field values', () => {
  function readRaw(name: string) {
    return fs.readFileSync(path.join(tmpDir, name), 'utf8');
  }

  it('adds a leading id while preserving other field values and the body', async () => {
    touchFile(
      'note.md',
      '---\nzebra: keep this value\ntitle: My Title\napple: 1\n---\n# Body text\n',
    );
    writeIndex({ files: [] });

    await reconcileIndexedFiles(tmpDir);

    const raw = readRaw('note.md');
    // The id is added at the top of the block, then the original body follows.
    expect(raw).toMatch(/^---\nid: [0-9A-F]{9}\n/);
    const parsed = parseFrontMatter(raw);
    expect(parsed.content).toBe('# Body text\n');
    expect(parsed.yaml?.id).toMatch(/^[0-9A-F]{9}$/);
    expect(parsed.yaml?.zebra).toBe('keep this value');
    expect(parsed.yaml?.title).toBe('My Title');
    expect(parsed.yaml?.apple).toBe(1);
  });

  it('replaces a colliding id without leaving a duplicate mapping key', async () => {
    // b.md is a paste of a.md: same id, plus extra fields and custom key order.
    touchFile('a.md', '---\nid: DUP000001\n---\n# A');
    await new Promise((r) => setTimeout(r, 20));
    touchFile('b.md', '---\nid: DUP000001\nbeta: 2\nalpha: 1\n---\n# B\n');
    writeIndex({ files: [{ name: 'a.md', id: 'DUP000001' }] });

    await reconcileIndexedFiles(tmpDir);

    const raw = readRaw('b.md');
    // The colliding id is gone, and there is exactly one id line (no dup key
    // that js-yaml would reject on the next read).
    expect(raw).not.toContain('DUP000001');
    expect(raw.match(/^id:/gm)?.length).toBe(1);
    const parsed = parseFrontMatter(raw);
    expect(parsed.yaml?.id).not.toBe('DUP000001');
    expect(parsed.yaml?.beta).toBe(2);
    expect(parsed.yaml?.alpha).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Per-directory serialization of index mutations (issue 013)
// ---------------------------------------------------------------------------

describe('concurrent .INDEX.yaml mutations are serialized per directory (issue 013)', () => {
  it('does not drop an entry when an insert and a move race on the same directory', async () => {
    touchFile('a.md');
    touchFile('b.md');
    touchFile('c.md');
    touchFile('x.md');
    writeIndex({ files: [{ name: 'a.md' }, { name: 'b.md' }, { name: 'c.md' }] });

    // Fire both mutations WITHOUT awaiting the first. Without per-directory
    // serialization both would read the pre-mutation index and the later write
    // would clobber the earlier one (a lost update — the inserted entry or the
    // move would vanish).
    const insert = insertIntoIndexYaml(tmpDir, 'x.md', 'a.md');
    const move = moveToEdgeInIndexYaml(tmpDir, 'c.md', 'top');
    await Promise.all([insert, move]);

    const names = readIndex().files.map((f: IndexEntry) => f.name);
    // Both effects survive: the inserted entry is present AND the move happened.
    expect(names).toContain('x.md');
    expect(names[0]).toBe('c.md');
    // No entry was lost in the process.
    expect(new Set(names)).toEqual(new Set(['a.md', 'b.md', 'c.md', 'x.md']));
  });

  it('moveInIndexYaml writes .INDEX.yaml exactly once (no follow-up reorder write)', async () => {
    writeIndex({ files: [{ name: 'a.md' }, { name: 'b.md' }, { name: 'c.md' }] });

    // writeFileAtomic persists via a single rename(tmp -> target), so counting
    // renames whose destination is the index file counts index writes.
    const renameSpy = vi.spyOn(fs.promises, 'rename');
    await moveInIndexYaml(tmpDir, 'b.md', 'up');
    const indexWrites = renameSpy.mock.calls.filter(([, dest]) => dest === indexPath()).length;
    renameSpy.mockRestore();

    expect(indexWrites).toBe(1);
    expect(readIndex().files.map((f: IndexEntry) => f.name)).toEqual(['b.md', 'a.md', 'c.md']);
  });
});

// ---------------------------------------------------------------------------
// ensureFrontMatterIdIfIndexed / recordFrontMatterIdInIndex (issue 014)
// ---------------------------------------------------------------------------

describe('ensureFrontMatterIdIfIndexed (issue 014)', () => {
  it('injects an id and returns it without touching .INDEX.yaml, in Document Mode', async () => {
    writeIndex({ files: [{ name: 'note.md' }] });
    const indexBefore = fs.readFileSync(indexPath(), 'utf8');

    const { content, addedId } = await ensureFrontMatterIdIfIndexed(
      path.join(tmpDir, 'note.md'),
      '# Hello',
    );

    expect(addedId).toMatch(/^[0-9A-F]{9}$/);
    expect(parseFrontMatter(content).yaml?.id).toBe(addedId);
    // The index write is deferred to recordFrontMatterIdInIndex (post file-write),
    // so this function must leave .INDEX.yaml untouched.
    expect(fs.readFileSync(indexPath(), 'utf8')).toBe(indexBefore);
  });

  it('is a no-op when the folder is not in Document Mode', async () => {
    const { content, addedId } = await ensureFrontMatterIdIfIndexed(
      path.join(tmpDir, 'note.md'),
      '# Hello',
    );
    expect(addedId).toBeNull();
    expect(content).toBe('# Hello');
    expect(fs.existsSync(indexPath())).toBe(false);
  });

  it('is a no-op when the file already has an id', async () => {
    writeIndex({ files: [{ name: 'note.md', id: 'AAAAAAAA1' }] });
    const input = '---\nid: AAAAAAAA1\n---\n# Hello';
    const { content, addedId } = await ensureFrontMatterIdIfIndexed(
      path.join(tmpDir, 'note.md'),
      input,
    );
    expect(addedId).toBeNull();
    expect(content).toBe(input);
  });
});

describe('recordFrontMatterIdInIndex (issue 014)', () => {
  it('updates an existing entry with the id', async () => {
    writeIndex({ files: [{ name: 'note.md' }] });
    await recordFrontMatterIdInIndex(path.join(tmpDir, 'note.md'), 'ABCDEF123');
    expect(readIndex().files.find((f: IndexEntry) => f.name === 'note.md')?.id).toBe('ABCDEF123');
  });

  it('appends a new entry when the file is not yet listed (no wait for reconcile)', async () => {
    writeIndex({ files: [{ name: 'existing.md' }] });
    await recordFrontMatterIdInIndex(path.join(tmpDir, 'fresh.md'), 'ABCDEF123');
    const entry = readIndex().files.find((f: IndexEntry) => f.name === 'fresh.md');
    expect(entry).toBeDefined();
    expect(entry?.id).toBe('ABCDEF123');
  });

  it('is a no-op when the directory is not in Document Mode', async () => {
    await recordFrontMatterIdInIndex(path.join(tmpDir, 'fresh.md'), 'ABCDEF123');
    expect(fs.existsSync(indexPath())).toBe(false);
  });
});

describe('save flow leaves file and index consistent for a new file (issue 014)', () => {
  it('the injected id ends up in both the file and the index, file-written first', async () => {
    // A Document Mode folder whose index does not yet list the brand-new file.
    writeIndex({ files: [{ name: 'existing.md' }] });
    const filePath = path.join(tmpDir, 'fresh.md');

    // Mirror the write-file handler's ordering: inject id -> write file -> record id.
    const { content, addedId } = await ensureFrontMatterIdIfIndexed(filePath, '# Fresh');
    expect(addedId).not.toBeNull();
    fs.writeFileSync(filePath, content, 'utf8'); // file written BEFORE the index
    if (addedId) await recordFrontMatterIdInIndex(filePath, addedId);

    const fileId = parseFrontMatter(fs.readFileSync(filePath, 'utf8')).yaml?.id;
    const indexEntry = readIndex().files.find((f: IndexEntry) => f.name === 'fresh.md');
    expect(fileId).toBe(addedId);
    expect(indexEntry?.id).toBe(addedId);
  });
});
