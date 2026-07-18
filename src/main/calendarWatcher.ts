import path from 'node:path';
import type { Stats } from 'node:fs';
import * as chokidar from 'chokidar';
import type { CalendarEventResult } from './calendarLoader';
import { loadCalendarEntryForFile } from './calendarLoader';
import { buildCalendarFilter } from '../shared/pathPattern';
import { logger } from '../shared/logUtil';

export type CalendarFileChangedCallback = (results: CalendarEventResult[], filePath: string) => void;
export type CalendarFileDeletedCallback = (deletedPath: string, isFolder: boolean) => void;
export type CalendarWatcherErrorCallback = (message: string) => void;

// Single module-level watcher state. This is a deliberate design choice, not an
// oversight: the app watches exactly one active vault folder at a time, tied to
// the single mainWindow (see the 'load-calendar-events' IPC handler in main.ts).
// If multi-vault or split-view watching is ever needed, promote this state into a
// CalendarWatcher class so each view can own an independent instance.
let currentWatcher: ReturnType<typeof chokidar.watch> | null = null;
let currentFolder: string | null = null;
// The ignore patterns the active watcher was built with. Compared on each
// start request so an ignoredPaths change (edited in Settings) restarts the
// watcher instead of silently keeping the stale filter — otherwise live
// updates and the initial crawl diverge over the same folder.
let currentIgnoredPaths: string[] = [];

// Serialization chain for start/stop operations. Both startCalendarWatcher and
// stopCalendarWatcher are async and mutate the module state above across `await`
// points, and their callers (the 'load-calendar-events' IPC handler, app
// shutdown) can overlap — e.g. two rapid folder switches run two IPC handlers
// concurrently. Without serialization, a second start() call could observe
// `currentWatcher === null` while the first was still awaiting the old
// watcher's close(), and both would then create a watcher; whichever assigned
// `currentWatcher` last silently overwrote (and leaked) the other's — two live
// watchers, duplicate events, and state pointing at the wrong folder. That is
// exactly the bug this chain prevents: every public start/stop runs strictly
// after the previous one has fully completed, so the check-then-act sequences
// inside them are atomic with respect to each other.
let operationChain: Promise<void> = Promise.resolve();

/**
 * Run `op` after every previously enqueued operation has settled. The chain
 * itself swallows rejections (so one failed op can't wedge all future ones),
 * but the promise returned to the caller still rejects normally.
 */
function serialized<T>(op: () => Promise<T>): Promise<T> {
  const run = operationChain.then(op);
  operationChain = run.then(() => undefined, () => undefined);
  return run;
}

/** Order-sensitive equality for two ignore-pattern lists. */
function sameIgnoredPaths(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((pattern, i) => pattern === b[i]);
}

/**
 * Turn a chokidar watcher error into a user-facing sentence. On large vaults the
 * most common failure is Linux inotify exhaustion (`ENOSPC`): the OS runs out of
 * watch descriptors and live updates silently stop for part (or all) of the tree.
 * That gets a specific, actionable message; anything else falls back to the raw
 * error text.
 */
function describeWatcherError(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'ENOSPC') {
    return 'The system file-watch limit was reached, so calendar events may stop updating '
      + 'live for some files. Increase the inotify watch limit '
      + '(fs.inotify.max_user_watches) or reopen the calendar folder.';
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `Calendar live updates may be incomplete: ${detail}`;
}

/**
 * Build the chokidar `ignored` predicate from the *same* {@link buildCalendarFilter}
 * the initial crawl uses, so watched and loaded files never diverge.
 *
 * chokidar calls this as `(path, stats?)` — sometimes before it has stat'd the entry.
 * We derive a tri-state directory flag from `stats` and hand it to the shared filter:
 * a directory (or a pre-stat call where the type is unknown) is never pruned by the
 * `.md` rule, so folders with dotted names (`notes.2024`) stay watchable and their
 * `.md` children live-update. Only entries known to be non-`.md` *files* are ignored.
 *
 * The watch root itself is **never** ignored. chokidar applies `ignored` to the
 * root path it was asked to watch (see `_addToNodeFs` in chokidar's handler),
 * but fdir's `exclude()` in {@link loadCalendarEvents}'s crawl is only ever
 * applied to *subdirectories* — the crawl always descends into its own root.
 * Without this bypass, a calendar folder whose own name is hidden (`.notes`) or
 * matches a user ignore pattern would load events on the initial crawl and then
 * silently never live-update, because chokidar would ignore the entire tree at
 * its root. Filtering of everything *inside* the root is unaffected.
 */
function buildIgnoredFn(folderPath: string, ignoredPaths: string[]): (filePath: string, stats?: Stats) => boolean {
  const exclude = buildCalendarFilter(ignoredPaths);
  // Resolve once so comparisons are immune to trailing-slash / '.' differences
  // between the path we passed to chokidar and the path chokidar hands back.
  const rootPath = path.resolve(folderPath);
  return (filePath: string, stats?: Stats) => {
    if (path.resolve(filePath) === rootPath) return false;
    const isDirectory = stats ? stats.isDirectory() : undefined;
    return exclude(path.basename(filePath), filePath, isDirectory);
  };
}

/**
 * Start watching `folderPath` for `.md` file changes and deletions.
 *
 * - If already watching the exact same folder with the exact same `ignoredPaths`,
 *   this is a no-op. A changed ignore list restarts the watcher so its filter stays
 *   in sync with the initial crawl's.
 * - Any existing watcher is fully closed (awaited) before the new one starts, so
 *   the two never coexist and can't emit duplicate events or leak file handles.
 * - `onChanged` fires with the file's updated {@link CalendarEventResult} entries
 *   on creation or modification.
 * - `onDeleted` fires with the removed path and a `isFolder` flag on deletion.
 * - `onError` fires **at most once per watcher session** with a user-facing
 *   message when chokidar reports an error (e.g. inotify exhaustion) — enough to
 *   warn the user that live updates degraded without spamming on repeat errors.
 * - `ignoredPaths` accepts the same wildcard patterns used by folder browsing.
 * - Overlapping calls are safe: every start/stop runs through {@link serialized},
 *   so a second call issued while a restart is mid-flight simply queues behind it.
 */
export function startCalendarWatcher(
  folderPath: string,
  onChanged: CalendarFileChangedCallback,
  onDeleted: CalendarFileDeletedCallback,
  ignoredPaths: string[] = [],
  onError?: CalendarWatcherErrorCallback,
): Promise<void> {
  return serialized(() => doStartCalendarWatcher(folderPath, onChanged, onDeleted, ignoredPaths, onError));
}

/**
 * The actual start implementation. Only ever runs inside the {@link serialized}
 * chain — its check-then-stop-then-create sequence spans `await` points and is
 * only correct when no other start/stop interleaves with it (see the comment on
 * `operationChain` for the leaked-watcher bug that motivates this).
 */
async function doStartCalendarWatcher(
  folderPath: string,
  onChanged: CalendarFileChangedCallback,
  onDeleted: CalendarFileDeletedCallback,
  ignoredPaths: string[],
  onError?: CalendarWatcherErrorCallback,
): Promise<void> {
  // Don't restart if already watching the same folder with the same ignore list.
  // A changed ignoredPaths must fall through to a restart so the watcher's filter
  // matches the patterns the initial crawl just used.
  if (
    currentFolder === folderPath &&
    currentWatcher !== null &&
    sameIgnoredPaths(currentIgnoredPaths, ignoredPaths)
  ) {
    return;
  }

  // Await the close so the previous watcher is fully torn down before the new
  // one is created — otherwise the two briefly coexist and can emit duplicate
  // events / leak file handles during a folder switch.
  // NOTE: this must call the internal doStopCalendarWatcher, not the public
  // stopCalendarWatcher — the public wrapper enqueues on operationChain, and we
  // are already *inside* that chain, so calling it here would deadlock waiting
  // on ourselves.
  await doStopCalendarWatcher();

  currentFolder = folderPath;
  currentIgnoredPaths = ignoredPaths;
  const watcher = chokidar.watch(folderPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: buildIgnoredFn(folderPath, ignoredPaths),
    ignorePermissionErrors: true,
  });
  currentWatcher = watcher;

  // Surface the first error of this watcher session to the renderer so the user
  // knows live updates degraded; subsequent errors are still logged but not
  // re-reported (inotify exhaustion can fire repeatedly).
  let errorReported = false;
  watcher.on('error', (err: unknown) => {
    logger.error('Calendar watcher error:', err);
    if (!errorReported) {
      errorReported = true;
      onError?.(describeWatcherError(err));
    }
  });

  // Shared handler for file creation and modification: both load the file's
  // calendar entries and notify via onChanged.
  const handleUpsert = (filePath: string) => {
    // buildIgnoredFn() only prunes entries it can confirm are non-.md files; a
    // pre-stat event may still deliver a non-.md file (e.g. README). This guard is
    // the backstop so only .md files ever produce calendar entries.
    if (path.extname(filePath).toLowerCase() !== '.md') return;
    loadCalendarEntryForFile(filePath)
      .then(results => {
        // The load is async, so this watcher may have been stopped or replaced
        // (user switched folders) while the file was being read. Closing the
        // chokidar watcher stops *new* events, but it cannot recall a load that
        // was already in flight — without this identity check the old session
        // would still deliver an event from the previous vault to onChanged.
        if (currentWatcher !== watcher) return;
        onChanged(results, filePath);
      })
      .catch((err: unknown) => logger.error(`Failed to load calendar events for ${filePath}:`, err));
  };
  watcher.on('change', handleUpsert);
  watcher.on('add', handleUpsert);

  watcher.on('unlink', (filePath: string) => {
    if (path.extname(filePath).toLowerCase() !== '.md') return;
    onDeleted(filePath, false);
  });

  watcher.on('unlinkDir', (dirPath: string) => {
    onDeleted(dirPath, true);
  });
}

/**
 * Stop and close the active calendar watcher. A no-op when no watcher is
 * active. Serialized with {@link startCalendarWatcher}, so a stop issued while
 * a start is mid-flight waits for it and then closes the watcher it created.
 */
export function stopCalendarWatcher(): Promise<void> {
  return serialized(doStopCalendarWatcher);
}

/**
 * The actual stop implementation. Module state is cleared before the close is
 * awaited; that ordering is safe (not racy) because every caller holds the
 * {@link serialized} chain, so nothing can observe the intermediate state.
 */
async function doStopCalendarWatcher(): Promise<void> {
  if (!currentWatcher) return;
  // Capture and clear the module state before awaiting the close: the cleared
  // `currentWatcher` also disarms any in-flight handleUpsert loads belonging to
  // this watcher (they compare against it before firing onChanged).
  const watcher = currentWatcher;
  currentWatcher = null;
  currentFolder = null;
  currentIgnoredPaths = [];
  try {
    await watcher.close();
  } catch (err) {
    logger.error('Failed to close calendar watcher:', err);
  }
}
