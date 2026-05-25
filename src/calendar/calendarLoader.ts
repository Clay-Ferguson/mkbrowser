import path from 'node:path';
import fs from 'node:fs';
import { fdir } from 'fdir';
import yaml from 'js-yaml';
import { RRule, Weekday } from 'rrule';

export interface CalendarEventResult {
  id: string;
  title: string;
  /** Milliseconds since epoch for the due date (start of day) */
  start: number;
  /** Same as start — all calendar items are all-day events */
  end: number;
  /** Full path to the source markdown file */
  filePath: string;
  /** First 5 lines (up to 400 chars) of body content after front matter */
  snippet: string;
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

const BYDAY_MAP: Record<string, Weekday> = {
  MO: RRule.MO, TU: RRule.TU, WE: RRule.WE, TH: RRule.TH,
  FR: RRule.FR, SA: RRule.SA, SU: RRule.SU,
};

const FREQ_MAP: Record<string, number> = {
  daily: RRule.DAILY, weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY, yearly: RRule.YEARLY,
};

interface RRuleYaml {
  freq?: string;
  interval?: number;
  byday?: string;
  until?: string;
  count?: number;
}

function expandRRule(
  rruleYaml: RRuleYaml,
  dueDate: Date,
  startMs: number,
  endMs: number,
  durationMs: number,
  filePath: string,
  title: string,
  snippet: string,
): CalendarEventResult[] {
  const freq = FREQ_MAP[(rruleYaml.freq ?? '').toLowerCase()];
  if (freq === undefined) return [];

  const byweekday = rruleYaml.byday
    ? rruleYaml.byday.split(',').map(s => BYDAY_MAP[s.trim().toUpperCase()]).filter(Boolean)
    : undefined;

  const until = rruleYaml.until ? parseDueDate(rruleYaml.until) : undefined;

  const isAllDay = startMs === dueDate.getTime() && endMs === dueDate.getTime();

  const rule = new RRule({
    freq,
    interval: rruleYaml.interval ?? 1,
    byweekday: byweekday && byweekday.length > 0 ? byweekday : undefined,
    until: until ?? undefined,
    count: rruleYaml.count,
    dtstart: isAllDay ? dueDate : new Date(startMs),
  });

  return rule.all().map((occurrenceDate, i) => {
    let occStart: number;
    let occEnd: number;
    if (isAllDay) {
      occStart = new Date(occurrenceDate.getFullYear(), occurrenceDate.getMonth(), occurrenceDate.getDate()).getTime();
      occEnd = occStart;
    } else {
      occStart = new Date(occurrenceDate.getFullYear(), occurrenceDate.getMonth(), occurrenceDate.getDate(),
        occurrenceDate.getHours(), occurrenceDate.getMinutes(), 0, 0).getTime();
      occEnd = occStart + durationMs;
    }
    return { id: `${filePath}::${i}`, title, start: occStart, end: occEnd, filePath, snippet };
  });
}

function extractFrontMatterYaml(content: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(content);
  return match ? match[1] : null;
}

function extractSnippet(content: string): string {
  const fmMatch = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/.exec(content);
  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const lines = body.split(/\r?\n/).filter(l => l.trim().length > 0).slice(0, 5);
  const joined = lines.join('\n');
  if (joined.length <= 400) return joined;
  return joined.slice(0, 400) + '...';
}

/** Parse a single markdown file and return its calendar entries (>1 for recurring events), or [] if no valid 'due'. */
export async function loadCalendarEntryForFile(filePath: string): Promise<CalendarEventResult[]> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const yamlStr = extractFrontMatterYaml(content);
    if (!yamlStr) return [];

    const parsed = yaml.load(yamlStr) as Record<string, unknown> | null;
    if (!parsed || typeof parsed.due !== 'string') return [];

    const dueDate = parseDueDate(parsed.due);
    if (!dueDate) return [];

    const title = path.basename(filePath, '.md');
    const snippet = extractSnippet(content);

    let startMs = dueDate.getTime();
    let endMs = dueDate.getTime();
    let durationMs = 0;

    const startTimeStr = typeof parsed.start === 'string' ? parsed.start : null;
    const duration = typeof parsed.duration === 'number' ? parsed.duration : null;

    if (startTimeStr) {
      const time = parseStartTime(startTimeStr);
      if (time) {
        const startDate = new Date(dueDate);
        startDate.setHours(time.hours, time.minutes, 0, 0);
        startMs = startDate.getTime();
        durationMs = (duration ?? 1) * 60 * 60 * 1000;
        endMs = startMs + durationMs;
      }
    }

    if (parsed.rrule && typeof parsed.rrule === 'object' && !Array.isArray(parsed.rrule)) {
      return expandRRule(
        parsed.rrule as RRuleYaml,
        dueDate, startMs, endMs, durationMs,
        filePath, title, snippet,
      );
    }

    return [{ id: filePath, title, start: startMs, end: endMs, filePath, snippet }];
  } catch {
    return [];
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
  return results.flat();
}
