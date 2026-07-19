import path from 'node:path';
import fs from 'node:fs';
import { fdir } from 'fdir';
import { RRule, Weekday } from 'rrule';
import { loadYaml } from '../shared/yamlUtil';
import { logger } from '../shared/logUtil';
import { buildCalendarFilter } from '../shared/pathPattern';
import { mapWithConcurrency } from '../shared/asyncUtil';
import { coerceDueDate } from '../shared/calendarUtil';
import { splitFrontMatter } from '../shared/frontMatterUtil';

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

/**
 * Parse a start-time string into 24-hour `{ hours, minutes }`. Accepts both the
 * 12-hour form (`"1:30 PM"`) and the 24-hour form (`"13:30"`). Returns null on
 * anything unrecognized so the caller can warn and fall back to an all-day event.
 */
function parseStartTime(timeStr: string): { hours: number; minutes: number } | null {
  const trimmed = timeStr.trim();

  const match12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(trimmed);
  if (match12) {
    const [, hourStr, minStr, meridiemStr] = match12;
    let hours = parseInt(hourStr!, 10);
    const minutes = parseInt(minStr!, 10);
    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
    if (meridiemStr!.toUpperCase() === 'AM') {
      if (hours === 12) hours = 0;
    } else {
      if (hours !== 12) hours += 12;
    }
    return { hours, minutes };
  }

  const match24 = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (match24) {
    const [, hourStr, minStr] = match24;
    const hours = parseInt(hourStr!, 10);
    const minutes = parseInt(minStr!, 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes };
  }

  return null;
}

/**
 * Coerce a `duration:` value (hours) into a positive finite number, or null if it
 * is absent/invalid. Tolerates numeric strings (`"2"`) the same way
 * {@link normalizeRRule} does for `interval`, and rejects the values that would
 * otherwise silently corrupt the event: `NaN` (from YAML `.nan`, which is `typeof
 * 'number'` and would make `end` NaN) and non-positive numbers (which would place
 * `end` at or before `start`). Returns null so the caller can warn and default to 1.
 */
function coerceDuration(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number(value.trim()) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
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
 * Recurring items are expanded only within a sliding window around "now": from
 * MAX_PAST_YEARS back to MAX_FUTURE_YEARS ahead. The window bounds total
 * memory/render load across *all* recurring items while guaranteeing that a
 * long-lived rule (e.g. a daily reminder created years ago) always renders
 * around the present. Expansion must never start at the rule's dtstart with a
 * flat occurrence cap: an old-enough daily rule would exhaust the cap entirely
 * in the past and silently vanish from today's calendar. Occurrences outside
 * the window simply aren't shown.
 */
const MAX_PAST_YEARS = 5;
const MAX_FUTURE_YEARS = 2;

/**
 * Backstop cap on the number of in-window occurrences generated for a single
 * recurring item. The window above is the operative bound — at the finest
 * supported frequency (daily, interval 1) a 7-year window yields at most
 * ~2,600 occurrences — so this only fires on unexpected runaway output.
 * Invariant: this must stay comfortably larger than the window's daily
 * worst case (windowYears * 366), otherwise a daily rule gets truncated
 * partway through the window and occurrences near "today" vanish — the exact
 * bug the windowing exists to prevent.
 */
const MAX_OCCURRENCES = 5000;

/** Cap simultaneous file reads to avoid EMFILE on large vaults. */
const CALENDAR_READ_CONCURRENCY = 50;

interface RRuleYaml {
  freq?: string;
  interval?: number;
  byday?: string;
  until?: string | Date;
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
    until: typeof raw.until === 'string' || raw.until instanceof Date ? raw.until : undefined,
    count: toPositiveInt(raw.count),
  };
}

/**
 * Expand a parsed `rrule:` YAML block into individual {@link CalendarEventResult}
 * occurrences. Each occurrence inherits the event's title, snippet, and filePath,
 * and gets a unique `id` formed from `filePath + "::" + occurrenceIndex` so the
 * calendar can distinguish repeated events from distinct files.
 *
 * RRule arithmetic is performed entirely in UTC (wall-clock encoded via
 * `Date.UTC(...)`) to avoid weekday drift on non-UTC machines and DST shifts for
 * timed events; each occurrence's UTC components are decoded back to local time
 * before being returned. See the inline comment for the full rationale.
 *
 * Returns `[]` when `rruleYaml.freq` is absent or unrecognized.
 */
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
    ? rruleYaml.byday
        .split(',')
        .map(s => BYDAY_MAP[s.trim().toUpperCase()])
        .filter((w): w is Weekday => w !== undefined)
    : undefined;

  const isAllDay = startMs === dueDate.getTime() && endMs === dueDate.getTime();

  // RRule must be driven entirely in UTC, otherwise it produces wrong results for
  // non-UTC machines. Internally rrule does its date/weekday arithmetic on the UTC
  // components of `dtstart` and returns occurrences carrying those values in their UTC
  // components. If we feed a local-time Date (whose UTC components differ from the
  // wall-clock by the tz offset), a `byday: MO` rule lands on the wrong weekday east/west
  // of UTC, and a timed event drifts an hour across DST. We therefore encode the intended
  // wall-clock into UTC via Date.UTC(...) when building the rule, and decode each
  // occurrence's UTC components back into a *local* timestamp for the calendar to render.
  // The dtstart wall-clock is read from the local Date the loader already built.
  const wall = new Date(isAllDay ? dueDate.getTime() : startMs);
  const dtstart = isAllDay
    ? new Date(Date.UTC(wall.getFullYear(), wall.getMonth(), wall.getDate()))
    : new Date(Date.UTC(wall.getFullYear(), wall.getMonth(), wall.getDate(), wall.getHours(), wall.getMinutes()));

  // RRule treats `until` as inclusive (occurrences with dtstart <= until). Encode it as
  // the END of the until day, not its midnight: an all-day dtstart sits at UTC midnight
  // and would still pass, but a timed dtstart carries wall-clock hours (e.g. 13:30) and is
  // strictly greater than midnight of the same day — so a midnight `until` would drop the
  // final occurrence, ending the recurrence one occurrence early (the UI's default
  // `until: 12/31/2027` on every timed repeat would stop on 12/30).
  const untilDate = rruleYaml.until ? coerceDueDate(rruleYaml.until) : null;
  const until = untilDate
    ? new Date(Date.UTC(untilDate.getFullYear(), untilDate.getMonth(), untilDate.getDate(), 23, 59, 59, 999))
    : undefined;

  const rule = new RRule({
    freq,
    interval: rruleYaml.interval ?? 1,
    byweekday: byweekday && byweekday.length > 0 ? byweekday : undefined,
    until: until ?? undefined,
    count: rruleYaml.count,
    dtstart,
  });

  // Expand only the sliding window around "now" (see MAX_PAST_YEARS above) so
  // that items configured to repeat forever can't overflow memory or overload
  // the calendar component, while an old rule still always reaches the present.
  // The window bounds are encoded into the same UTC-as-wall-clock frame as
  // dtstart (see above) so the comparison rrule performs is frame-consistent.
  // The iterator's `len` counts only in-window occurrences, so MAX_OCCURRENCES
  // acts purely as a backstop on what this window can return.
  const now = new Date();
  const windowStart = new Date(Date.UTC(now.getFullYear() - MAX_PAST_YEARS, now.getMonth(), now.getDate()));
  const windowEnd = new Date(Date.UTC(now.getFullYear() + MAX_FUTURE_YEARS, now.getMonth(), now.getDate()));

  return rule
    .between(windowStart, windowEnd, true, (_date, len) => len < MAX_OCCURRENCES)
    .map((occurrenceDate, i) => {
    // Decode the UTC components rrule produced back into a local wall-clock timestamp.
    let occStart: number;
    let occEnd: number;
    if (isAllDay) {
      occStart = new Date(occurrenceDate.getUTCFullYear(), occurrenceDate.getUTCMonth(), occurrenceDate.getUTCDate()).getTime();
      occEnd = occStart;
    } else {
      occStart = new Date(occurrenceDate.getUTCFullYear(), occurrenceDate.getUTCMonth(), occurrenceDate.getUTCDate(),
        occurrenceDate.getUTCHours(), occurrenceDate.getUTCMinutes(), 0, 0).getTime();
      occEnd = occStart + durationMs;
    }
    return { id: `${filePath}::${i}`, title, start: occStart, end: occEnd, filePath, snippet };
  });
}

/**
 * Extract a short preview snippet from a markdown file body (the text after the
 * front-matter block). Returns up to 5 non-empty lines joined with newlines,
 * capped at 400 characters (with a trailing `...` when truncated).
 */
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

    const parsed = loadYaml(fm.yamlStr) as Record<string, unknown> | null;
    // No `due` at all means "not a calendar file" — skip quietly. A `due` that is
    // present but unparseable is a likely user mistake, so make it discoverable.
    //
    // ⚠️ Absence has TWO spellings here: a key that is missing entirely reads back
    // as `undefined`, while an explicitly empty `due:` line parses to YAML `null`.
    // Both mean "no due date" and both must skip quietly — a check for only one of
    // them lets the other fall through to coerceDueDate() and log a bogus
    // "'due' is not a recognized date: undefined"
    // warning for every non-calendar markdown file that merely has front matter,
    // once per calendar scan. The same trap applies to `duration`/`start` below.
    if (!parsed || parsed.due === undefined || parsed.due === null) return [];

    const dueDate = coerceDueDate(parsed.due);
    if (!dueDate) {
      logger.warn(`Skipping calendar entry ${filePath}: 'due' is not a recognized date: ${JSON.stringify(parsed.due)}`);
      return [];
    }

    // Strip the .md extension case-insensitively — the crawl filter admits
    // `.MD`/`.Md` too, and `path.basename(f, '.md')` only strips exact lowercase.
    const title = path.basename(filePath).replace(/\.md$/i, '');
    const snippet = extractSnippet(fm.body);

    let startMs = dueDate.getTime();
    let endMs = dueDate.getTime();
    let durationMs = 0;

    // Validate duration up front so a bad value (NaN from `.nan`, negative, or a
    // non-numeric string) is surfaced rather than silently corrupting `end`.
    // coerceDuration maps *absent* (undefined/null) and *invalid* values to the
    // same null, so the warning must be gated on presence — and an absent key is
    // `undefined`, not `null` (see the `due` comment above). Testing only
    // `!== null` would warn "invalid 'duration' undefined" for every calendar
    // file that simply omits the optional field.
    const duration = coerceDuration(parsed.duration);
    if (parsed.duration !== undefined && parsed.duration !== null && duration === null) {
      logger.warn(`Calendar entry ${filePath}: ignoring invalid 'duration' ${JSON.stringify(parsed.duration)} (expected a positive number of hours); defaulting to 1`);
    }

    const startTimeStr = typeof parsed.start === 'string' ? parsed.start : null;
    if (startTimeStr) {
      const time = parseStartTime(startTimeStr);
      if (time) {
        const startDate = new Date(dueDate);
        startDate.setHours(time.hours, time.minutes, 0, 0);
        startMs = startDate.getTime();
        durationMs = (duration ?? 1) * 60 * 60 * 1000;
        endMs = startMs + durationMs;
      } else {
        logger.warn(`Calendar entry ${filePath}: unrecognized 'start' time "${startTimeStr}" (use "1:30 PM" or "13:30"); treating event as all-day`);
      }
    } else if (parsed.start !== undefined && parsed.start !== null) {
      // Warn only when `start` is present with a non-string value (e.g. a bare
      // 13:30 that YAML read as something else). An absent key is `undefined` —
      // not `null` — and is the normal all-day case, so it must stay silent
      // (see the `due` comment above for the undefined-vs-null trap).
      logger.warn(`Calendar entry ${filePath}: 'start' must be a time string like "1:30 PM" or "13:30", got ${JSON.stringify(parsed.start)}; treating event as all-day`);
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

/**
 * Scan a folder recursively for markdown files that carry a `due:` front-matter
 * field and return all resulting calendar events. Each file may produce more than
 * one event when it has an `rrule:` block (recurring events). Hidden files and
 * user-configured ignore patterns are excluded; file reads are bounded to
 * CALENDAR_READ_CONCURRENCY concurrent operations to avoid EMFILE on large vaults.
 */
export async function loadCalendarEvents(
  folderPath: string,
  ignoredPaths: string[] = [],
): Promise<CalendarEventResult[]> {
  // Same predicate the live watcher uses (see buildCalendarFilter) so the initial
  // crawl and live updates always agree on which files are calendar sources.
  const exclude = buildCalendarFilter(ignoredPaths);

  const api = new fdir()
    .withFullPaths()
    .exclude((dirName, dirPath) => exclude(dirName, dirPath, true))
    .filter((filePath) => !exclude(path.basename(filePath), filePath, false))
    .crawl(folderPath);

  const files = await api.withPromise();
  const results = await mapWithConcurrency(files, CALENDAR_READ_CONCURRENCY, loadCalendarEntryForFile);
  return results.flat();
}
