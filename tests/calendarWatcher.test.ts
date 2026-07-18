/**
 * Unit tests for src/main/calendarWatcher.ts.
 *
 * chokidar and calendarLoader are mocked so the tests can (a) observe every
 * watcher instance the module creates and whether it was closed, (b) drive
 * watcher events by hand, and (c) control exactly when a file's calendar
 * entries finish loading. This makes the concurrency races deterministic
 * instead of timing-dependent.
 */
import type { Stats } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CalendarEventResult } from '../src/main/calendarLoader';

type IgnoredFn = (filePath: string, stats?: Stats) => boolean;

const mocks = vi.hoisted(() => {
  /** Fake chokidar watcher: records handlers, close state, and its options. */
  class FakeWatcher {
    watchedPath: string;
    options: { ignored: IgnoredFn };
    closed = false;
    private handlers = new Map<string, (...args: unknown[]) => void>();

    constructor(watchedPath: string, options: { ignored: IgnoredFn }) {
      this.watchedPath = watchedPath;
      this.options = options;
    }
    on(event: string, cb: (...args: unknown[]) => void): this {
      this.handlers.set(event, cb);
      return this;
    }
    async close(): Promise<void> {
      this.closed = true;
    }
    emit(event: string, ...args: unknown[]): void {
      this.handlers.get(event)?.(...args);
    }
  }
  const watchers: FakeWatcher[] = [];
  return {
    FakeWatcher,
    watchers,
    watch: (p: string, options: { ignored: IgnoredFn }) => {
      const w = new FakeWatcher(p, options);
      watchers.push(w);
      return w;
    },
    loadCalendarEntryForFile: vi.fn(
      async (filePath: string): Promise<CalendarEventResult[]> =>
        [{ id: filePath, title: 't', start: 0, end: 0, filePath, snippet: '' }],
    ),
  };
});

vi.mock('chokidar', () => ({ watch: mocks.watch }));
vi.mock('../src/main/calendarLoader', () => ({
  loadCalendarEntryForFile: mocks.loadCalendarEntryForFile,
}));

import { startCalendarWatcher, stopCalendarWatcher } from '../src/main/calendarWatcher';

const noopChanged = () => {};
const noopDeleted = () => {};

/** Drain the microtask queue a few times so all pending awaits settle. */
async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

beforeEach(() => {
  mocks.watchers.length = 0;
  mocks.loadCalendarEntryForFile.mockClear();
});

afterEach(async () => {
  await stopCalendarWatcher();
});

describe('startCalendarWatcher concurrency', () => {
  it('never leaves two live watchers when start calls overlap', async () => {
    await startCalendarWatcher('/vault/a', noopChanged, noopDeleted);

    // Simulate two rapid folder switches whose IPC handlers overlap: neither
    // start is awaited before the next begins (exactly what happens when the
    // renderer fires load-calendar-events twice in quick succession).
    const pB = startCalendarWatcher('/vault/b', noopChanged, noopDeleted);
    const pC = startCalendarWatcher('/vault/c', noopChanged, noopDeleted);
    await Promise.all([pB, pC]);
    await flushMicrotasks();

    const open = mocks.watchers.filter(w => !w.closed);
    // Exactly one watcher may survive, and it must be the last-requested folder.
    expect(open.map(w => w.watchedPath)).toEqual(['/vault/c']);
  });

  it('a stop overlapping a start still results in everything closed', async () => {
    await startCalendarWatcher('/vault/a', noopChanged, noopDeleted);
    const pB = startCalendarWatcher('/vault/b', noopChanged, noopDeleted);
    const pStop = stopCalendarWatcher();
    await Promise.all([pB, pStop]);
    await flushMicrotasks();

    expect(mocks.watchers.filter(w => !w.closed)).toEqual([]);
  });
});

describe('watcher ignored-predicate vs initial crawl', () => {
  it('never ignores the watch root itself (the fdir crawl never excludes its root)', async () => {
    // A vault folder that is itself hidden: the initial crawl (fdir) happily
    // returns its .md files because fdir's exclude() is only applied to
    // subdirectories — but chokidar applies `ignored` to the root path too.
    await startCalendarWatcher('/home/user/.notes', noopChanged, noopDeleted);
    const w = mocks.watchers.at(-1)!;
    expect(w.options.ignored('/home/user/.notes')).toBe(false);

    // Children must still be filtered normally.
    expect(w.options.ignored('/home/user/.notes/.git')).toBe(true);
  });

  it('never ignores a root that matches a user ignore pattern', async () => {
    await startCalendarWatcher('/data/archive', noopChanged, noopDeleted, ['archive']);
    const w = mocks.watchers.at(-1)!;
    expect(w.options.ignored('/data/archive')).toBe(false);
    // ...while a *subfolder* named archive is still ignored.
    expect(w.options.ignored('/data/archive/archive')).toBe(true);
  });
});

describe('stale in-flight loads', () => {
  it('does not fire onChanged for a load that finishes after the watcher was replaced', async () => {
    let resolveLoad!: (r: CalendarEventResult[]) => void;
    mocks.loadCalendarEntryForFile.mockImplementationOnce(
      () => new Promise<CalendarEventResult[]>(res => { resolveLoad = res; }),
    );

    const onChangedA = vi.fn();
    await startCalendarWatcher('/vault/a', onChangedA, noopDeleted);
    const watcherA = mocks.watchers.at(-1)!;

    // A file event arrives; its calendar entries are still loading...
    watcherA.emit('add', '/vault/a/x.md');
    // ...when the user switches to a different folder.
    await startCalendarWatcher('/vault/b', noopChanged, noopDeleted);

    // The old session's load finally completes — it must be discarded, not
    // delivered to the renderer as an event from the previous vault.
    resolveLoad([{ id: 'x', title: 't', start: 0, end: 0, filePath: '/vault/a/x.md', snippet: '' }]);
    await flushMicrotasks();
    expect(onChangedA).not.toHaveBeenCalled();
  });
});
