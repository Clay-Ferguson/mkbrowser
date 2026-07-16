import path from 'node:path';
import type { Stats } from 'node:fs';
import * as chokidar from 'chokidar';
import type { CalendarEventResult } from './calendarLoader';
import { loadCalendarEntryForFile } from './calendarLoader';
import { buildCalendarFilter } from '../shared/pathPattern';
import { logger } from '../shared/logUtil';

export type CalendarFileChangedCallback = (results: CalendarEventResult[], filePath: string) => void;
export type CalendarFileDeletedCallback = (deletedPath: string, isFolder: boolean) => void;

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

/** Order-sensitive equality for two ignore-pattern lists. */
function sameIgnoredPaths(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((pattern, i) => pattern === b[i]);
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
 */
function buildIgnoredFn(ignoredPaths: string[]): (filePath: string, stats?: Stats) => boolean {
  const exclude = buildCalendarFilter(ignoredPaths);
  return (filePath: string, stats?: Stats) => {
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
 * - `ignoredPaths` accepts the same wildcard patterns used by folder browsing.
 */
export async function startCalendarWatcher(
  folderPath: string,
  onChanged: CalendarFileChangedCallback,
  onDeleted: CalendarFileDeletedCallback,
  ignoredPaths: string[] = [],
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
  await stopCalendarWatcher();

  currentFolder = folderPath;
  currentIgnoredPaths = ignoredPaths;
  currentWatcher = chokidar.watch(folderPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: buildIgnoredFn(ignoredPaths),
    ignorePermissionErrors: true,
  });

  currentWatcher.on('error', (err: unknown) =>
    logger.error('Calendar watcher error:', err));

  // Shared handler for file creation and modification: both load the file's
  // calendar entries and notify via onChanged.
  const handleUpsert = (filePath: string) => {
    // buildIgnoredFn() only prunes entries it can confirm are non-.md files; a
    // pre-stat event may still deliver a non-.md file (e.g. README). This guard is
    // the backstop so only .md files ever produce calendar entries.
    if (path.extname(filePath).toLowerCase() !== '.md') return;
    loadCalendarEntryForFile(filePath)
      .then(results => onChanged(results, filePath))
      .catch((err: unknown) => logger.error(`Failed to load calendar events for ${filePath}:`, err));
  };
  currentWatcher.on('change', handleUpsert);
  currentWatcher.on('add', handleUpsert);

  currentWatcher.on('unlink', (filePath: string) => {
    // console.log("************ onUnlink (file deleted): "+filePath);
    if (path.extname(filePath).toLowerCase() !== '.md') return;
    onDeleted(filePath, false);
  });

  currentWatcher.on('unlinkDir', (dirPath: string) => {
    // console.log("************ onUnlinkDir (folder deleted): "+dirPath);
    onDeleted(dirPath, true);
  });
}

/**
 * Stop and close the active calendar watcher. Module state is cleared
 * synchronously so the "already watching" guard in {@link startCalendarWatcher}
 * sees a clean slate immediately; the underlying chokidar close is then awaited.
 * A no-op when no watcher is active.
 */
export async function stopCalendarWatcher(): Promise<void> {
  if (!currentWatcher) return;
  // Capture and clear the module state synchronously so the "already watching"
  // guard immediately sees a cleared slot, then await the close on the local.
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
