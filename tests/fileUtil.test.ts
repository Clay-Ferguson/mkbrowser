import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readDirectory } from '../src/main/fileUtil';
import { ATTACH_SUFFIX } from '../src/shared/specialFiles';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fileUtil-test-')));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readDirectory attach folder pre-loading', () => {
  it('pre-loads the contents of a real .attach folder', async () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.md'), '# foo', 'utf8');
    fs.mkdirSync(path.join(tmpDir, `foo.md${ATTACH_SUFFIX}`));
    fs.writeFileSync(path.join(tmpDir, `foo.md${ATTACH_SUFFIX}`, 'pic.png'), 'x', 'utf8');

    const entries = await readDirectory(tmpDir, false);
    const attach = entries.find((e) => e.name === `foo.md${ATTACH_SUFFIX}`);
    expect(attach?.attachments?.map((a) => a.name)).toEqual(['pic.png']);
  });

  it('does not recurse into symlinked .attach folders', async () => {
    // Two links resolving to their own parent. Recursing through them fans out
    // exponentially until the kernel's symlink-resolution limit (~40 levels)
    // stops it, which hangs the main process rather than returning a listing.
    fs.symlinkSync(tmpDir, path.join(tmpDir, `a.md${ATTACH_SUFFIX}`));
    fs.symlinkSync(tmpDir, path.join(tmpDir, `b.md${ATTACH_SUFFIX}`));

    const entries = await readDirectory(tmpDir, false);

    // The links still list as directories; only the pre-load is skipped.
    expect(entries.map((e) => e.name)).toEqual([`a.md${ATTACH_SUFFIX}`, `b.md${ATTACH_SUFFIX}`]);
    for (const entry of entries) {
      expect(entry.isDirectory).toBe(true);
      expect(entry.attachments).toBeUndefined();
    }
  }, 10000);
});
