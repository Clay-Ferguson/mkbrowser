import path from 'node:path';
import * as chokidar from 'chokidar';
import type { CalendarEventResult } from './calendarLoader';
import { loadCalendarEntryForFile } from './calendarLoader';
import { escapeRegexExceptWildcard } from '../pathPattern';
import { logger } from '../logUtil';

export type CalendarFileChangedCallback = (results: CalendarEventResult[], filePath: string) => void;
export type CalendarFileDeletedCallback = (deletedPath: string, isFolder: boolean) => void;

let currentWatcher: ReturnType<typeof chokidar.watch> | null = null;
let currentFolder: string | null = null;

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

export function startCalendarWatcher(
  folderPath: string,
  onChanged: CalendarFileChangedCallback,
  onDeleted: CalendarFileDeletedCallback,
  ignoredPaths: string[] = [],
): void {
  // Don't restart if already watching the same folder
  if (currentFolder === folderPath && currentWatcher !== null) return;

  stopCalendarWatcher();

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

export function stopCalendarWatcher(): void {
  if (currentWatcher) {
    currentWatcher.close()
      .catch((err: unknown) => logger.error('Failed to close calendar watcher:', err));
    currentWatcher = null;
    currentFolder = null;
  }
}

export function getCalendarWatcherFolder(): string | null {
  return currentFolder;
}
