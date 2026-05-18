import path from 'node:path';
import chokidar from 'chokidar';
import type { CalendarEventResult } from './calendarLoader';
import { loadCalendarEntryForFile } from './calendarLoader';

export type CalendarFileChangedCallback = (result: CalendarEventResult | null, filePath: string) => void;
export type CalendarFileDeletedCallback = (deletedPath: string, isFolder: boolean) => void;

let currentWatcher: ReturnType<typeof chokidar.watch> | null = null;
let currentFolder: string | null = null;

function buildIgnoredFn(extraPatterns: string[]): (filePath: string) => boolean {
  const compiled = extraPatterns.map(pat => {
    const escaped = pat.replace(/[.+?^${}()|[\]\\/]/g, '\\$&');
    return new RegExp(`(^|[/\\\\])${escaped.replace(/\*/g, '.*')}([/\\\\]|$)`, 'i');
  });
  return (filePath: string) => {
    const base = path.basename(filePath);
    if (base.startsWith('.')) return true;
    if (filePath.includes('node_modules')) return true;
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

  currentWatcher.on('change', (filePath: string) => {
    console.log("************ onChange: "+filePath);
    if (path.extname(filePath).toLowerCase() !== '.md') return;
    void loadCalendarEntryForFile(filePath).then(result => onChanged(result, filePath));
  });

  currentWatcher.on('unlink', (filePath: string) => {
    console.log("************ onUnlink (file deleted): "+filePath);
    onDeleted(filePath, false);
  });

  currentWatcher.on('unlinkDir', (dirPath: string) => {
    console.log("************ onUnlinkDir (folder deleted): "+dirPath);
    onDeleted(dirPath, true);
  });
}

export function stopCalendarWatcher(): void {
  if (currentWatcher) {
    void currentWatcher.close();
    currentWatcher = null;
    currentFolder = null;
  }
}

export function getCalendarWatcherFolder(): string | null {
  return currentFolder;
}
