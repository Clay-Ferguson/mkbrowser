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

export async function loadCalendarEvents(
  folderPath: string,
  ignoredPaths: string[] = [],
): Promise<CalendarEventResult[]> {
  const shouldExclude = buildExcludePredicate(ignoredPaths);
  const events: CalendarEventResult[] = [];

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

  for (const filePath of files) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const yamlStr = extractFrontMatterYaml(content);
      if (!yamlStr) continue;

      const parsed = yaml.load(yamlStr) as Record<string, unknown> | null;
      if (!parsed || typeof parsed.due !== 'string') continue;

      const dueDate = parseDueDate(parsed.due);
      if (!dueDate) continue;

      const title = path.basename(filePath, '.md');
      events.push({
        id: filePath,
        title,
        start: dueDate.getTime(),
        end: dueDate.getTime(),
        filePath,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return events;
}
