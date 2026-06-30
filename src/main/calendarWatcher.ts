import path from 'node:path';
import * as chokidar from 'chokidar';
import type { CalendarEventResult } from './calendarLoader';
import { loadCalendarEntryForFile } from './calendarLoader';
import { escapeRegexExceptWildcard } from '../shared/pathPattern';
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

/**
 * Build a chokidar `ignored` predicate that excludes hidden files (leading dot),
 * node_modules, any file whose extension is neither absent nor `.md`, and any path
 * matching one of the user's `extraPatterns` (wildcard-aware, case-insensitive).
 * Extensionless paths are allowed through so directories remain watchable.
 */
function buildIgnoredFn(extraPatterns: string[]): (filePath: string) => boolean {
  const compiled = extraPatterns.map(pat => {
    const escaped = escapeRegexExceptWildcard(pat);
    return new RegExp(`(^|[/\\\\])${escaped.replace(/\*/g, '.*')}([/\\\\]|$)`, 'i');
  });
  return (filePath: string) => {
    const base = path.basename(filePath);
    if (base.startsWith('.')) return true;
    if (filePath.includes('node_modules')) return true;
    const ext = path.extname(filePath).toLowerCase();
    if (ext && ext !== '.md') return true;
    return compiled.some(p => p.test(base) || p.test(filePath));
  };
}

/**
 * Start watching `folderPath` for `.md` file changes and deletions.
 *
 * - If already watching the exact same folder, this is a no-op.
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
  // Don't restart if already watching the same folder
  if (currentFolder === folderPath && currentWatcher !== null) return;

  // Await the close so the previous watcher is fully torn down before the new
  // one is created — otherwise the two briefly coexist and can emit duplicate
  // events / leak file handles during a folder switch.
  await stopCalendarWatcher();

  currentFolder = folderPath;
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
    // buildIgnoredFn() lets extensionless paths through so directories stay
    // watchable; this guard filters extensionless files (e.g. README) that
    // aren't .md.
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
  try {
    await watcher.close();
  } catch (err) {
    logger.error('Failed to close calendar watcher:', err);
  }
}

/** Return the folder path currently being watched, or `null` if no watcher is active. */
export function getCalendarWatcherFolder(): string | null {
  return currentFolder;
}
