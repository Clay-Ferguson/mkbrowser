import path from 'node:path';
import fs from 'node:fs';
import { fdir } from 'fdir';
import yaml from 'js-yaml';

export interface CalendarEventResult {
  id: string;
  title: string;
  /** Milliseconds since epoch for the due date (start of day) */
  start: number;
  /** Same as start — all calendar items are all-day events */
  end: number;
  /** Full path to the source markdown file */
  filePath: string;
}

function parseDueDate(dateStr: string): Date | null {
  // Expects M/D/YYYY or MM/DD/YYYY or MM/DD/YY
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return null;
  let [month, day, year] = parts.map(Number);
  if (isNaN(month) || isNaN(day) || isNaN(year)) return null;
  if (year < 100) year += 2000;
  const d = new Date(year, month - 1, day);
  return isNaN(d.getTime()) ? null : d;
}

/** Parse a 12-hour time string like "1:30 PM" into { hours, minutes } in 24-hr. Returns null on failure. */
function parseStartTime(timeStr: string): { hours: number; minutes: number } | null {
  const match = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i.exec(timeStr.trim());
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3].toUpperCase();
  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
  if (meridiem === 'AM') {
    if (hours === 12) hours = 0;
  } else {
    if (hours !== 12) hours += 12;
  }
  return { hours, minutes };
}

function buildExcludePredicate(ignoredPaths: string[]): (name: string, fullPath: string) => boolean {
  const patterns = ignoredPaths.map(pattern => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\/]/g, '\\$&');
    return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 'i');
  });
  return (name: string, fullPath: string): boolean => {
    if (name.startsWith('.')) return true;
    return patterns.some(p => p.test(name) || p.test(fullPath));
  };
}

function extractFrontMatterYaml(content: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(content);
  return match ? match[1] : null;
}

/** Parse a single markdown file and return its calendar entry, or null if it has no valid 'due' property. */
export async function loadCalendarEntryForFile(filePath: string): Promise<CalendarEventResult | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const yamlStr = extractFrontMatterYaml(content);
    if (!yamlStr) return null;

    const parsed = yaml.load(yamlStr) as Record<string, unknown> | null;
    if (!parsed || typeof parsed.due !== 'string') return null;

    const dueDate = parseDueDate(parsed.due);
    if (!dueDate) return null;

    const title = path.basename(filePath, '.md');

    let startMs = dueDate.getTime();
    let endMs = dueDate.getTime();

    const startTimeStr = typeof parsed.start === 'string' ? parsed.start : null;
    const duration = typeof parsed.duration === 'number' ? parsed.duration : null;

    if (startTimeStr) {
      const time = parseStartTime(startTimeStr);
      if (time) {
        const startDate = new Date(dueDate);
        startDate.setHours(time.hours, time.minutes, 0, 0);
        startMs = startDate.getTime();
        const durationHours = duration ?? 1;
        endMs = startMs + durationHours * 60 * 60 * 1000;
      }
    }

    return { id: filePath, title, start: startMs, end: endMs, filePath };
  } catch {
    return null;
  }
}

export async function loadCalendarEvents(
  folderPath: string,
  ignoredPaths: string[] = [],
): Promise<CalendarEventResult[]> {
  const shouldExclude = buildExcludePredicate(ignoredPaths);

  const api = new fdir()
    .withFullPaths()
    .exclude((dirName, dirPath) => shouldExclude(dirName, dirPath))
    .filter((filePath) => {
      const fileName = path.basename(filePath);
      if (shouldExclude(fileName, filePath)) return false;
      return path.extname(filePath).toLowerCase() === '.md';
    })
    .crawl(folderPath);

  const files = await api.withPromise();
  const results = await Promise.all(files.map(loadCalendarEntryForFile));
  return results.filter((r): r is CalendarEventResult => r !== null);
}
