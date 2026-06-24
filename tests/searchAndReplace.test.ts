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

  it('isolates per-file failures: a bad file is reported as success:false without aborting the batch', async () => {
    // Many files so the bounded-concurrency pool runs multiple workers in parallel.
    const fileCount = 60;
    for (let i = 0; i < fileCount; i++) {
      await writeFile(`f${i}.md`, 'needle');
    }
    // A broken symlink with a .md name: fdir includes it as a file, but readFile
    // rejects (ENOENT), exercising the in-callback try/catch error path.
    await fs.promises.symlink(path.join(tmpDir, 'does-not-exist'), path.join(tmpDir, 'broken.md'));

    const results = await searchAndReplace(tmpDir, 'needle', 'pin', []);

    const failures = results.filter(r => !r.success);
    const successes = results.filter(r => r.success);

    // The directory-as-file produced a failure result, not a thrown abort.
    expect(failures).toHaveLength(1);
    expect(failures[0].relativePath).toBe('broken.md');
    expect(failures[0].error).toBeTruthy();

    // Every real file was still processed despite the failing entry.
    expect(successes).toHaveLength(fileCount);
    for (let i = 0; i < fileCount; i++) {
      expect(await fs.promises.readFile(path.join(tmpDir, `f${i}.md`), 'utf-8')).toBe('pin');
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
