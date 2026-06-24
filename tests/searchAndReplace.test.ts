/**
 * searchAndReplace tests — verifies bounded-concurrency processing, per-file
 * error isolation, and that output is equivalent to the previous sequential
 * implementation. Each test runs against a fresh temp folder because
 * searchAndReplace mutates files on disk.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { searchAndReplace } from '../src/searchAndReplace';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snr-test-'));
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

describe('searchAndReplace', () => {
  it('returns empty results for an empty search string', async () => {
    await writeFile('a.md', 'hello world');
    const results = await searchAndReplace(tmpDir, '', 'x', []);
    expect(results).toEqual([]);
  });

  it('replaces matches and reports counts, only for files with matches', async () => {
    await writeFile('a.md', 'foo and foo again');
    await writeFile('b.txt', 'foo here');
    await writeFile('c.md', 'nothing to see');

    const results = await searchAndReplace(tmpDir, 'foo', 'bar', []);

    // Only files with at least one replacement appear
    expect(results).toHaveLength(2);

    const byRel = new Map(results.map(r => [r.relativePath, r]));
    expect(byRel.get('a.md')).toMatchObject({ replacementCount: 2, success: true });
    expect(byRel.get('b.txt')).toMatchObject({ replacementCount: 1, success: true });
    expect(byRel.has('c.md')).toBe(false);

    // Files were actually modified on disk
    expect(await fs.promises.readFile(path.join(tmpDir, 'a.md'), 'utf-8')).toBe('bar and bar again');
    expect(await fs.promises.readFile(path.join(tmpDir, 'b.txt'), 'utf-8')).toBe('bar here');
    expect(await fs.promises.readFile(path.join(tmpDir, 'c.md'), 'utf-8')).toBe('nothing to see');
  });

  it('does not write or report files when the replacement reproduces the original bytes', async () => {
    // searchText === replaceText: every match "replaces" with identical text,
    // so the count is > 0 but the file's content is unchanged. The file must
    // not be rewritten (no mtime churn) and must not appear in results.
    const file = await writeFile('a.md', 'foo and foo again');
    const before = await fs.promises.stat(file);

    // Ensure any rewrite would produce a detectably different mtime.
    await new Promise(resolve => setTimeout(resolve, 10));

    const results = await searchAndReplace(tmpDir, 'foo', 'foo', []);

    expect(results).toEqual([]);
    const after = await fs.promises.stat(file);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await fs.promises.readFile(file, 'utf-8')).toBe('foo and foo again');
  });

  it('only processes .md and .txt files', async () => {
    await writeFile('keep.md', 'token');
    await writeFile('skip.json', 'token');
    await writeFile('skip.log', 'token');

    const results = await searchAndReplace(tmpDir, 'token', 'X', []);

    expect(results.map(r => r.relativePath)).toEqual(['keep.md']);
    expect(await fs.promises.readFile(path.join(tmpDir, 'skip.json'), 'utf-8')).toBe('token');
  });

  it('treats search text as a literal (regex metacharacters are escaped)', async () => {
    await writeFile('a.md', 'a.b a.b axb');
    const results = await searchAndReplace(tmpDir, 'a.b', 'Z', []);
    expect(results[0].replacementCount).toBe(2); // only the two literal "a.b", not "axb"
    expect(await fs.promises.readFile(path.join(tmpDir, 'a.md'), 'utf-8')).toBe('Z Z axb');
  });

  it('treats replacement text as a literal ($-patterns are inserted verbatim)', async () => {
    // Each `$`-sequence below would be interpreted as a special replacement
    // pattern if replaceText were passed as a string to String.replace:
    //   $&  -> the matched text, $$ -> a single $, $1 -> a capture group, etc.
    // The replacer-function fix must insert them verbatim instead.
    // searchAndReplace crawls the whole folder, so recreate the single file
    // before each case to keep them independent.
    const cases = ['$&', '$$', '$1', '$5', '$`', "$'"];
    for (const replacement of cases) {
      await writeFile('p.md', 'price tag');
      await searchAndReplace(tmpDir, 'price', replacement, []);
      expect(await fs.promises.readFile(path.join(tmpDir, 'p.md'), 'utf-8')).toBe(`${replacement} tag`);
    }
  });

  // Triggering a per-file failure deterministically requires a file that lists in
  // the crawl but fails to read; we use an unreadable file (chmod 000). The OS
  // permission check is bypassed for root, so skip there rather than assert a
  // failure that can't happen.
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  it.skipIf(isRoot)('isolates per-file failures: a bad file is reported as success:false without aborting the batch', async () => {
    // Many files so the bounded-concurrency pool runs multiple workers in parallel.
    const fileCount = 60;
    for (let i = 0; i < fileCount; i++) {
      await writeFile(`f${i}.md`, 'needle');
    }
    // An unreadable .md file: fdir lists it (it's a real regular file), but
    // readFile rejects (EACCES), exercising the in-callback try/catch error path.
    const badPath = await writeFile('bad.md', 'needle');
    await fs.promises.chmod(badPath, 0o000);

    let results;
    try {
      results = await searchAndReplace(tmpDir, 'needle', 'pin', []);
    } finally {
      // Restore perms so afterEach can remove the temp tree.
      await fs.promises.chmod(badPath, 0o644);
    }

    const failures = results.filter(r => !r.success);
    const successes = results.filter(r => r.success);

    // The unreadable file produced a failure result, not a thrown abort.
    expect(failures).toHaveLength(1);
    expect(failures[0].relativePath).toBe('bad.md');
    expect(failures[0].error).toBeTruthy();

    // Every real file was still processed despite the failing entry.
    expect(successes).toHaveLength(fileCount);
    for (let i = 0; i < fileCount; i++) {
      expect(await fs.promises.readFile(path.join(tmpDir, `f${i}.md`), 'utf-8')).toBe('pin');
    }
  });

  it('does not follow symlinks: files reachable only via a symlink are never written', async () => {
    // A destructive bulk replace must stay confined to regular files physically
    // under folderPath. Symlinks (to files OR directories) that escape the tree
    // must be skipped entirely — never read, never rewritten, never clobbered.
    await writeFile('real.md', 'needle');

    // A real target living OUTSIDE the searched folder.
    const outsideDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snr-outside-'));
    const outsideFile = path.join(outsideDir, 'secret.md');
    await fs.promises.writeFile(outsideFile, 'needle', 'utf-8');
    const outsideSubFile = path.join(outsideDir, 'inner.md');
    await fs.promises.writeFile(outsideSubFile, 'needle', 'utf-8');

    try {
      // A .md-named symlink pointing at the outside file, and a symlinked
      // directory whose contents would otherwise be reachable.
      await fs.promises.symlink(outsideFile, path.join(tmpDir, 'linkfile.md'));
      await fs.promises.symlink(outsideDir, path.join(tmpDir, 'linkdir'));

      const results = await searchAndReplace(tmpDir, 'needle', 'pin', []);

      // Only the genuine in-tree file is touched.
      expect(results.map(r => r.relativePath)).toEqual(['real.md']);
      expect(await fs.promises.readFile(path.join(tmpDir, 'real.md'), 'utf-8')).toBe('pin');

      // The outside files are completely untouched.
      expect(await fs.promises.readFile(outsideFile, 'utf-8')).toBe('needle');
      expect(await fs.promises.readFile(outsideSubFile, 'utf-8')).toBe('needle');

      // The symlink itself is not clobbered into a regular file.
      expect((await fs.promises.lstat(path.join(tmpDir, 'linkfile.md'))).isSymbolicLink()).toBe(true);
    } finally {
      await fs.promises.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('writes atomically and leaves no temp files behind after replacing', async () => {
    await writeFile('a.md', 'foo foo');
    await writeFile('sub/b.txt', 'foo');

    const results = await searchAndReplace(tmpDir, 'foo', 'bar', []);

    expect(results).toHaveLength(2);
    // Content was replaced...
    expect(await fs.promises.readFile(path.join(tmpDir, 'a.md'), 'utf-8')).toBe('bar bar');
    expect(await fs.promises.readFile(path.join(tmpDir, 'sub/b.txt'), 'utf-8')).toBe('bar');
    // ...and the atomic temp+rename left no stray temp files in any directory.
    const rootEntries = await fs.promises.readdir(tmpDir);
    const subEntries = await fs.promises.readdir(path.join(tmpDir, 'sub'));
    expect([...rootEntries, ...subEntries].some(name => name.endsWith('.tmp'))).toBe(false);
    expect(rootEntries.sort()).toEqual(['a.md', 'sub']);
    expect(subEntries).toEqual(['b.txt']);
  });

  it('skips files larger than the size limit and reports them as a failed result', async () => {
    // A normal file that should be processed normally.
    await writeFile('small.md', 'needle here');

    // A file just over the 20 MB ceiling. Use truncate to make it sparse so the
    // test stays fast and low-on-disk: the file *reports* a >20 MB size to stat
    // without actually writing 20 MB of bytes. The guard stats first and skips
    // it before ever reading, so its (sparse) contents never matter.
    const bigPath = await writeFile('big.md', 'needle here');
    const overLimit = 20 * 1024 * 1024 + 1;
    await fs.promises.truncate(bigPath, overLimit);
    const bigSizeBefore = (await fs.promises.stat(bigPath)).size;

    const results = await searchAndReplace(tmpDir, 'needle', 'pin', []);

    const byRel = new Map(results.map(r => [r.relativePath, r]));

    // The small file was replaced as usual.
    expect(byRel.get('small.md')).toMatchObject({ replacementCount: 1, success: true });
    expect(await fs.promises.readFile(path.join(tmpDir, 'small.md'), 'utf-8')).toBe('pin here');

    // The oversized file is reported as a non-success result with an explanatory
    // error — not silently dropped — and is left completely untouched on disk.
    const bigResult = byRel.get('big.md');
    expect(bigResult).toBeDefined();
    expect(bigResult?.success).toBe(false);
    expect(bigResult?.replacementCount).toBe(0);
    expect(bigResult?.error).toMatch(/too large/i);
    expect((await fs.promises.stat(bigPath)).size).toBe(bigSizeBefore);
  });

  it('respects ignored patterns and always excludes hidden files', async () => {
    await writeFile('keep.md', 'mark');
    await writeFile('node_modules/dep.md', 'mark');
    await writeFile('.hidden.md', 'mark');

    const results = await searchAndReplace(tmpDir, 'mark', 'M', ['node_modules']);

    expect(results.map(r => r.relativePath)).toEqual(['keep.md']);
    // Ignored/hidden files left untouched
    expect(await fs.promises.readFile(path.join(tmpDir, 'node_modules/dep.md'), 'utf-8')).toBe('mark');
    expect(await fs.promises.readFile(path.join(tmpDir, '.hidden.md'), 'utf-8')).toBe('mark');
  });

  it('accepts raw string patterns with wildcards (built via the shared exclude predicate)', async () => {
    // ignoredPaths is now a raw string[] (matching searchFolder); wildcard `*`
    // patterns are expanded by the shared buildExcludePredicate, not pre-compiled
    // by the caller. A `*draft*` pattern should match the basename.
    await writeFile('keep.md', 'mark');
    await writeFile('my-draft-notes.md', 'mark');

    const results = await searchAndReplace(tmpDir, 'mark', 'M', ['*draft*']);

    expect(results.map(r => r.relativePath)).toEqual(['keep.md']);
    expect(await fs.promises.readFile(path.join(tmpDir, 'my-draft-notes.md'), 'utf-8')).toBe('mark');
  });
});
