import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('readDirectory I/O fan-out', () => {
  it('bounds the number of concurrently processed entries (EMFILE protection)', async () => {
    // A large directory: every entry spawns its own async task (stat, and for
    // some entries fd-holding readFile/readdir calls). If those tasks all run
    // at once, the fd-holding ones can exhaust the process's file-descriptor
    // limit (EMFILE) — and because every per-entry failure in readDirectory is
    // swallowed, the damage is silent: missing aiHints, missing attachments,
    // and fabricated Date.now() timestamps from the stat-failure fallback.
    //
    // EMFILE itself is ulimit-dependent, so instead of provoking it we measure
    // the peak number of per-entry tasks in flight simultaneously, via a
    // stat spy that holds each call open for a tick so overlap is observable.
    const fileCount = 200;
    for (let i = 0; i < fileCount; i++) {
      fs.writeFileSync(path.join(tmpDir, `f${i}.md`), '', 'utf8');
    }

    const realStat = fs.promises.stat.bind(fs.promises);
    let inFlight = 0;
    let peak = 0;
    const spy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (...args) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((r) => { setTimeout(r, 1); }); // hold the slot so overlap is measurable
        return await realStat(...(args as Parameters<typeof realStat>));
      } finally {
        inFlight--;
      }
    });
    try {
      const entries = await readDirectory(tmpDir, false);
      expect(entries).toHaveLength(fileCount);
    } finally {
      spy.mockRestore();
    }

    // 32 is the codebase-wide bound for fs fan-outs (see RECONCILE_FILE_CONCURRENCY
    // in indexUtil.ts). Unbounded Promise.all would peak at ~fileCount here.
    expect(peak).toBeLessThanOrEqual(32);
  }, 15000);
});
