import path from 'node:path';
import fs from 'node:fs';
import { fdir } from 'fdir';
import { load } from 'js-yaml';
import { RRule, Weekday } from 'rrule';
import { logger } from '../logUtil';
import { buildExcludePredicate } from '../pathPattern';
import { mapWithConcurrency } from '../asyncUtil';
import { parseDueStr, splitFrontMatter } from './calendarUtil';

export interface CalendarEventResult {
  id: string;
  title: string;
  /** Milliseconds since epoch for the event start. All-day items use local start-of-day. */
  start: number;
  /** Milliseconds since epoch for the event end. Equals `start` for all-day items;
   *  otherwise `start + duration`. */
  end: number;
  /** Full path to the source markdown file */
  filePath: string;
  /** First 5 lines (up to 400 chars) of body content after front matter */
  snippet: string;
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

const BYDAY_MAP: Record<string, Weekday> = {
  MO: RRule.MO, TU: RRule.TU, WE: RRule.WE, TH: RRule.TH,
  FR: RRule.FR, SA: RRule.SA, SU: RRule.SU,
};

const FREQ_MAP: Record<string, number> = {
  daily: RRule.DAILY, weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY, yearly: RRule.YEARLY,
};

/**
 * Safety cap on the number of occurrences generated for a single recurring item.
 * Without this, an unbounded rrule (no `until` and no `count` — i.e. an "ends:
 * never" repeat) makes RRule.all() loop forever, hanging the calendar. This also
 * guards against huge counts or far-future `until` dates.
 */
const MAX_OCCURRENCES = 400;

/**
 * Never populate the calendar with occurrences more than this far into the
 * future. This bounds total memory/render load across *all* recurring items
 * (each one is independently capped at MAX_OCCURRENCES, which alone could still
 * add up to many thousands of entries). For most frequencies this horizon is
 * the operative limit; MAX_OCCURRENCES is the backstop for very fine-grained
 * repeats (e.g. daily).
 */
const MAX_FUTURE_YEARS = 2;

/** Cap simultaneous file reads to avoid EMFILE on large vaults. */
const CALENDAR_READ_CONCURRENCY = 50;

interface RRuleYaml {
  freq?: string;
  interval?: number;
  byday?: string;
  until?: string;
  count?: number;
}

/**
 * Coerce an untyped `rrule:` YAML block into a validated {@link RRuleYaml}.
 *
 * `js-yaml` types its output as `unknown`, so the raw block may contain values
 * of any type (e.g. `interval: "2"` stays a string, `count: abc` is a string,
 * `freq: 1` is a number). Feeding those straight into `new RRule(...)` — or into
 * the string operations in `expandRRule` (`.toLowerCase()`, `.split()`,
 * `parseDueStr().trim()`) — produces wrong recurrences or a throw that the outer
 * try/catch swallows, silently dropping the whole event. Normalize defensively
 * here so every field has a known type before it reaches the rule engine.
 */
function normalizeRRule(raw: Record<string, unknown>): RRuleYaml {
  const toPositiveInt = (value: unknown): number | undefined => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  return {
    freq: typeof raw.freq === 'string' ? raw.freq : undefined,
    interval: toPositiveInt(raw.interval) ?? 1,
    byday: typeof raw.byday === 'string' ? raw.byday : undefined,
    until: typeof raw.until === 'string' ? raw.until : undefined,
    count: toPositiveInt(raw.count),
  };
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

  const until = rruleYaml.until ? parseDueStr(rruleYaml.until) ?? undefined : undefined;

  const isAllDay = startMs === dueDate.getTime() && endMs === dueDate.getTime();

  const rule = new RRule({
    freq,
    interval: rruleYaml.interval ?? 1,
    byweekday: byweekday && byweekday.length > 0 ? byweekday : undefined,
    until: until ?? undefined,
    count: rruleYaml.count,
    dtstart: isAllDay ? dueDate : new Date(startMs),
  });

  // we have the max occurrences and this time horizon in place so that we can 
  // be sure that calendar items that are configured to repeat forever, won't 
  // overflow memory or overload the calendar component 
  const horizon = new Date();
  horizon.setFullYear(horizon.getFullYear() + MAX_FUTURE_YEARS);
  const horizonMs = horizon.getTime();

  return rule
    .all((date, len) => date.getTime() <= horizonMs && len < MAX_OCCURRENCES)
    .map((occurrenceDate, i) => {
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

function extractSnippet(body: string): string {
  const lines = body.split(/\r?\n/).filter(l => l.trim().length > 0).slice(0, 5);
  const joined = lines.join('\n');
  if (joined.length <= 400) return joined;
  return joined.slice(0, 400) + '...';
}

/** Parse a single markdown file and return its calendar entries (>1 for recurring events), or [] if no valid 'due'. */
export async function loadCalendarEntryForFile(filePath: string): Promise<CalendarEventResult[]> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const fm = splitFrontMatter(content);
    if (!fm) return [];

    const parsed = load(fm.yaml) as Record<string, unknown> | null;
    if (!parsed || typeof parsed.due !== 'string') return [];

    const dueDate = parseDueStr(parsed.due);
    if (!dueDate) return [];

    const title = path.basename(filePath, '.md');
    const snippet = extractSnippet(fm.body);

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
        normalizeRRule(parsed.rrule as Record<string, unknown>),
        dueDate, startMs, endMs, durationMs,
        filePath, title, snippet,
      );
    }

    return [{ id: filePath, title, start: startMs, end: endMs, filePath, snippet }];
  } catch (err) {
    // Returning [] keeps a single bad file from breaking the whole calendar,
    // but the failure must not vanish silently (read errors, malformed YAML).
    logger.error(`Failed to load calendar entry from ${filePath}:`, err);
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
  const results = await mapWithConcurrency(files, CALENDAR_READ_CONCURRENCY, loadCalendarEntryForFile);
  return results.flat();
}
