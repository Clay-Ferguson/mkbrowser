import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadCalendarEntryForFile, loadCalendarEvents } from '../src/main/calendarLoader';
import {
  hasDueProperty,
  getDueProperty,
  getStartProperty,
  getDurationProperty,
  setDueProperty,
  setStartProperty,
  setDurationProperty,
  getRRuleProperty,
  setRRuleProperty,
  injectCalendarFrontMatter,
  parseDueStr,
  coerceDueDate,
  formatDueDate,
} from '../src/shared/calendarUtil';
import { parseFrontMatter } from '../src/shared/frontMatterUtil';

let tmpDir: string;

function f(name: string): string {
  return path.join(tmpDir, name);
}

function write(name: string, content: string): void {
  const full = f(name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-test-'));

  write('simple-event.md', `---
due: 6/15/2026
---
This is a simple calendar event for testing.
`);

  write('timed-event.md', `---
due: 7/4/2026
start: "2:00 PM"
duration: 2
---
A timed event with explicit duration.
`);

  write('timed-event-default-duration.md', `---
due: 8/1/2026
start: "9:00 AM"
---
A timed event with no explicit duration.
`);

  write('two-digit-year.md', `---
due: 3/10/27
---
Event with two-digit year.
`);

  write('iso-due.md', `---
due: 2026-03-05
---
Event whose due is written in ISO YYYY-MM-DD form.
`);

  write('no-frontmatter.md', `This file has no front matter at all.\n`);

  write('no-due.md', `---
title: No Due Field
---
This file has front matter but no due field.
`);

  write('long-body.md', `---
due: 9/1/2026
---
Line one of the body.
Line two of the body.
Line three of the body.
Line four of the body.
Line five of the body.
Line six should be truncated.
Line seven should be truncated.
`);

  write('recurring-weekly.md', `---
due: 6/1/2026
rrule:
  freq: weekly
  count: 3
---
A weekly recurring event.
`);

  write('recurring-byday.md', `---
due: 6/1/2026
rrule:
  freq: weekly
  byday: MO,WE,FR
  count: 6
---
A recurring event on Mon, Wed, Fri.
`);

  write('ignored/ignored-event.md', `---
due: 6/1/2026
---
This event is in an ignored directory.
`);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loadCalendarEntryForFile
// ---------------------------------------------------------------------------

describe('loadCalendarEntryForFile — simple all-day event', () => {
  it('returns one entry with correct title and date', async () => {
    const results = await loadCalendarEntryForFile(f('simple-event.md'));
    expect(results).toHaveLength(1);
    const [ev] = results;
    expect(ev.title).toBe('simple-event');
    expect(ev.start).toBe(new Date(2026, 5, 15).getTime());
    expect(ev.end).toBe(ev.start);
    expect(ev.filePath).toBe(f('simple-event.md'));
    expect(ev.id).toBe(f('simple-event.md'));
  });

  it('snippet contains body text (not front matter)', async () => {
    const [ev] = await loadCalendarEntryForFile(f('simple-event.md'));
    expect(ev.snippet).toContain('simple calendar event');
    expect(ev.snippet).not.toContain('due:');
  });
});

describe('loadCalendarEntryForFile — timed event with explicit duration', () => {
  it('sets start to 2 PM and end to start + 2 hours', async () => {
    const [ev] = await loadCalendarEntryForFile(f('timed-event.md'));
    const expectedStart = new Date(2026, 6, 4, 14, 0, 0, 0).getTime();
    const expectedEnd = expectedStart + 2 * 60 * 60 * 1000;
    expect(ev.start).toBe(expectedStart);
    expect(ev.end).toBe(expectedEnd);
  });
});

describe('loadCalendarEntryForFile — timed event with default duration', () => {
  it('defaults duration to 1 hour when not specified', async () => {
    const [ev] = await loadCalendarEntryForFile(f('timed-event-default-duration.md'));
    const expectedStart = new Date(2026, 7, 1, 9, 0, 0, 0).getTime();
    expect(ev.start).toBe(expectedStart);
    expect(ev.end).toBe(expectedStart + 60 * 60 * 1000);
  });
});

describe('loadCalendarEntryForFile — start/duration validation (L4)', () => {
  it('accepts a 24-hour start time', async () => {
    write('start-24h.md', `---\ndue: 6/15/2026\nstart: "13:30"\nduration: 2\n---\nBody.\n`);
    const [ev] = await loadCalendarEntryForFile(f('start-24h.md'));
    const expectedStart = new Date(2026, 5, 15, 13, 30, 0, 0).getTime();
    expect(ev.start).toBe(expectedStart);
    expect(ev.end).toBe(expectedStart + 2 * 60 * 60 * 1000);
  });

  it('demotes an unrecognized start time to an all-day event', async () => {
    write('start-bad.md', `---\ndue: 6/15/2026\nstart: "half past noon"\n---\nBody.\n`);
    const [ev] = await loadCalendarEntryForFile(f('start-bad.md'));
    expect(ev.start).toBe(new Date(2026, 5, 15).getTime());
    expect(ev.end).toBe(ev.start);
  });

  it('rejects an out-of-range 24-hour start time', async () => {
    write('start-oob.md', `---\ndue: 6/15/2026\nstart: "25:00"\n---\nBody.\n`);
    const [ev] = await loadCalendarEntryForFile(f('start-oob.md'));
    expect(ev.start).toBe(new Date(2026, 5, 15).getTime());
    expect(ev.end).toBe(ev.start);
  });

  it('tolerates a numeric-string duration', async () => {
    write('duration-string.md', `---\ndue: 6/15/2026\nstart: "9:00 AM"\nduration: "2"\n---\nBody.\n`);
    const [ev] = await loadCalendarEntryForFile(f('duration-string.md'));
    const expectedStart = new Date(2026, 5, 15, 9, 0, 0, 0).getTime();
    expect(ev.end).toBe(expectedStart + 2 * 60 * 60 * 1000);
  });

  it('defaults to 1 hour for a NaN duration instead of producing a NaN end', async () => {
    write('duration-nan.md', `---\ndue: 6/15/2026\nstart: "9:00 AM"\nduration: .nan\n---\nBody.\n`);
    const [ev] = await loadCalendarEntryForFile(f('duration-nan.md'));
    const expectedStart = new Date(2026, 5, 15, 9, 0, 0, 0).getTime();
    expect(Number.isNaN(ev.end)).toBe(false);
    expect(ev.end).toBe(expectedStart + 60 * 60 * 1000);
  });

  it('defaults to 1 hour for a negative duration', async () => {
    write('duration-negative.md', `---\ndue: 6/15/2026\nstart: "9:00 AM"\nduration: -2\n---\nBody.\n`);
    const [ev] = await loadCalendarEntryForFile(f('duration-negative.md'));
    const expectedStart = new Date(2026, 5, 15, 9, 0, 0, 0).getTime();
    expect(ev.end).toBe(expectedStart + 60 * 60 * 1000);
  });
});

describe('loadCalendarEntryForFile — two-digit year', () => {
  it('treats 2-digit year as 2000+YY', async () => {
    const [ev] = await loadCalendarEntryForFile(f('two-digit-year.md'));
    expect(ev.start).toBe(new Date(2027, 2, 10).getTime());
  });
});

describe('loadCalendarEntryForFile — ISO due date', () => {
  it('loads an event whose due is written as YYYY-MM-DD', async () => {
    const results = await loadCalendarEntryForFile(f('iso-due.md'));
    expect(results).toHaveLength(1);
    expect(results[0].start).toBe(new Date(2026, 2, 5).getTime());
  });
});

describe('loadCalendarEntryForFile — missing / invalid front matter', () => {
  it('returns [] for a file with no front matter', async () => {
    const results = await loadCalendarEntryForFile(f('no-frontmatter.md'));
    expect(results).toHaveLength(0);
  });

  it('returns [] for a file with front matter but no due field', async () => {
    const results = await loadCalendarEntryForFile(f('no-due.md'));
    expect(results).toHaveLength(0);
  });

  it('returns [] for a nonexistent file', async () => {
    const results = await loadCalendarEntryForFile(f('does-not-exist.md'));
    expect(results).toHaveLength(0);
  });
});

describe('loadCalendarEntryForFile — snippet truncation', () => {
  it('limits snippet to at most 5 non-empty body lines', async () => {
    const [ev] = await loadCalendarEntryForFile(f('long-body.md'));
    const lines = ev.snippet.split('\n');
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(ev.snippet).toContain('Line five');
    expect(ev.snippet).not.toContain('Line six');
  });
});

// ---------------------------------------------------------------------------
// loadCalendarEntryForFile — recurring events
// ---------------------------------------------------------------------------

describe('loadCalendarEntryForFile — weekly recurring (count: 3)', () => {
  it('returns 3 occurrences, each 7 days apart', async () => {
    const results = await loadCalendarEntryForFile(f('recurring-weekly.md'));
    expect(results).toHaveLength(3);
    const ms = 7 * 24 * 60 * 60 * 1000;
    expect(results[1].start - results[0].start).toBe(ms);
    expect(results[2].start - results[1].start).toBe(ms);
  });

  it('uses filePath::index as id for each occurrence', async () => {
    const results = await loadCalendarEntryForFile(f('recurring-weekly.md'));
    expect(results[0].id).toBe(`${f('recurring-weekly.md')}::0`);
    expect(results[2].id).toBe(`${f('recurring-weekly.md')}::2`);
  });

  it('all occurrences share the same filePath and title', async () => {
    const results = await loadCalendarEntryForFile(f('recurring-weekly.md'));
    for (const ev of results) {
      expect(ev.filePath).toBe(f('recurring-weekly.md'));
      expect(ev.title).toBe('recurring-weekly');
    }
  });
});

describe('loadCalendarEntryForFile — byday recurring (MO/WE/FR, count: 6)', () => {
  it('returns exactly 6 occurrences', async () => {
    const results = await loadCalendarEntryForFile(f('recurring-byday.md'));
    expect(results).toHaveLength(6);
  });

  it('all occurrences fall on Mon, Wed, or Fri', async () => {
    const results = await loadCalendarEntryForFile(f('recurring-byday.md'));
    const mwfDays = new Set([1, 3, 5]); // Mon=1, Wed=3, Fri=5
    for (const ev of results) {
      const day = new Date(ev.start).getDay();
      expect(mwfDays.has(day)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// loadCalendarEntryForFile — timezone / DST behavior
//
// rrule is local-in/local-out: occurrences carry the intended wall-clock values in
// their LOCAL components. These tests pin that contract so the "off-by-one-day" and
// DST-hour-drift footguns can't regress. They assert on local calendar Y/M/D and
// wall-clock H:M (the same basis the loader builds with), so they hold in any TZ.
// ---------------------------------------------------------------------------

describe('loadCalendarEntryForFile — timezone / DST', () => {
  it('all-day weekly occurrences land on the correct calendar day (no off-by-one)', async () => {
    write('tz-allday-weekly.md', `---\ndue: 6/1/2026\nrrule:\n  freq: weekly\n  count: 3\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('tz-allday-weekly.md'));
    expect(results.map(r => r.start)).toEqual([
      new Date(2026, 5, 1).getTime(),
      new Date(2026, 5, 8).getTime(),
      new Date(2026, 5, 15).getTime(),
    ]);
    for (const ev of results) expect(ev.end).toBe(ev.start);
  });

  it('all-day byday (MO/WE/FR) lands on Mon/Wed/Fri in every timezone', async () => {
    // The classic rrule footgun: byday arithmetic happens in rrule's UTC frame, so a
    // local-time dtstart shifts the weekday east/west of UTC (e.g. MO/WE/FR -> TU/TH/SA
    // under Asia/Tokyo) before the UTC-normalization fix.
    write('tz-allday-byday.md', `---\ndue: 6/1/2026\nrrule:\n  freq: weekly\n  byday: MO,WE,FR\n  count: 6\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('tz-allday-byday.md'));
    expect(results).toHaveLength(6);
    const mwf = new Set([1, 3, 5]); // Mon, Wed, Fri
    for (const ev of results) {
      expect(mwf.has(new Date(ev.start).getDay())).toBe(true);
    }
    expect(results.map(r => new Date(r.start).getDate())).toEqual([1, 3, 5, 8, 10, 12]);
  });

  it('all-day weekly with `until` includes the boundary occurrence', async () => {
    write('tz-allday-until.md', `---\ndue: 6/1/2026\nrrule:\n  freq: weekly\n  until: 6/15/2026\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('tz-allday-until.md'));
    expect(results.map(r => r.start)).toEqual([
      new Date(2026, 5, 1).getTime(),
      new Date(2026, 5, 8).getTime(),
      new Date(2026, 5, 15).getTime(),
    ]);
  });

  it('timed weekly with `until` includes the boundary occurrence (M1)', async () => {
    // A timed dtstart carries wall-clock hours, so a midnight-encoded `until` on the
    // final day would drop it and end the recurrence one occurrence early. The 6/15
    // occurrence at 9:00 AM must be present.
    write('tz-timed-until.md', `---\ndue: 6/1/2026\nstart: "9:00 AM"\nrrule:\n  freq: weekly\n  until: 6/15/2026\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('tz-timed-until.md'));
    expect(results.map(r => new Date(r.start).getDate())).toEqual([1, 8, 15]);
    for (const ev of results) {
      expect(new Date(ev.start).getHours()).toBe(9);
    }
  });

  it('timed weekly occurrences keep the specified wall-clock time', async () => {
    write('tz-timed-weekly.md', `---\ndue: 6/1/2026\nstart: "9:00 AM"\nrrule:\n  freq: weekly\n  count: 3\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('tz-timed-weekly.md'));
    expect(results).toHaveLength(3);
    for (const ev of results) {
      const d = new Date(ev.start);
      expect(d.getHours()).toBe(9);
      expect(d.getMinutes()).toBe(0);
    }
  });

  it('timed weekly does not drift an hour across a DST transition', async () => {
    // US spring-forward 2026 is Sun Mar 8. A 9:00 AM weekly event starting Mar 2 must
    // stay at 9:00 AM for every occurrence — before the fix the post-DST occurrences
    // read back as 10:00 AM in DST timezones.
    write('tz-timed-dst.md', `---\ndue: 3/2/2026\nstart: "9:00 AM"\nrrule:\n  freq: weekly\n  count: 3\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('tz-timed-dst.md'));
    expect(results).toHaveLength(3);
    expect(results.map(r => new Date(r.start).getHours())).toEqual([9, 9, 9]);
    expect(results.map(r => new Date(r.start).getDate())).toEqual([2, 9, 16]);
  });
});

// ---------------------------------------------------------------------------
// loadCalendarEntryForFile — malformed rrule fields (untyped YAML coercion)
// ---------------------------------------------------------------------------

describe('loadCalendarEntryForFile — malformed rrule fields', () => {
  it('treats a quoted-string interval the same as a numeric one', async () => {
    write('rrule-string-interval.md', `---\ndue: 6/1/2026\nrrule:\n  freq: weekly\n  interval: "2"\n  count: 3\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('rrule-string-interval.md'));
    expect(results).toHaveLength(3);
    const twoWeeks = 14 * 24 * 60 * 60 * 1000;
    expect(results[1].start - results[0].start).toBe(twoWeeks);
    expect(results[2].start - results[1].start).toBe(twoWeeks);
  });

  it('treats a quoted-string count the same as a numeric one', async () => {
    write('rrule-string-count.md', `---\ndue: 6/1/2026\nrrule:\n  freq: weekly\n  count: "3"\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('rrule-string-count.md'));
    expect(results).toHaveLength(3);
  });

  it('ignores a non-numeric count rather than dropping the event', async () => {
    write('rrule-garbage-count.md', `---\ndue: 6/1/2026\nrrule:\n  freq: weekly\n  count: abc\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('rrule-garbage-count.md'));
    // "abc" is not a valid count, so the rule falls back to the expansion
    // window bounds — the event must still expand, not vanish.
    expect(results.length).toBeGreaterThan(3);
  });

  it('returns no occurrences (without throwing) for a non-string freq', async () => {
    write('rrule-nonstring-freq.md', `---\ndue: 6/1/2026\nrrule:\n  freq: 1\n  count: 3\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('rrule-nonstring-freq.md'));
    expect(results).toEqual([]);
  });

  it('ignores a non-string byday rather than throwing', async () => {
    write('rrule-nonstring-byday.md', `---\ndue: 6/1/2026\nrrule:\n  freq: weekly\n  byday: 5\n  count: 2\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('rrule-nonstring-byday.md'));
    expect(results).toHaveLength(2);
  });

  it('ignores a non-string until rather than throwing', async () => {
    write('rrule-nonstring-until.md', `---\ndue: 6/1/2026\nrrule:\n  freq: weekly\n  until: 2026\n  count: 2\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('rrule-nonstring-until.md'));
    expect(results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// loadCalendarEntryForFile — long-lived recurring rules (windowed expansion)
//
// Regression guard: expansion used to start at dtstart with a flat 400-
// occurrence cap, so a daily rule created >400 days ago exhausted the cap
// entirely in the past and silently vanished from today's calendar. Expansion
// now covers a sliding window around "now", so an old rule must always render
// at the present. These tests use dates relative to the real clock on purpose.
// ---------------------------------------------------------------------------

describe('loadCalendarEntryForFile — long-lived recurring rules', () => {
  function daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }

  it('a daily "repeat forever" rule started 500 days ago still occurs today', async () => {
    write('old-daily.md', `---\ndue: ${formatDueDate(daysAgo(500))}\nrrule:\n  freq: daily\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('old-daily.md'));
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    expect(results.some(ev => ev.start === todayStart.getTime())).toBe(true);
  });

  it('a daily rule started years ago still extends into the future', async () => {
    write('old-daily-future.md', `---\ndue: ${formatDueDate(daysAgo(900))}\nrrule:\n  freq: daily\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('old-daily-future.md'));
    const oneYearAhead = new Date();
    oneYearAhead.setFullYear(oneYearAhead.getFullYear() + 1);
    expect(results.some(ev => ev.start >= oneYearAhead.getTime())).toBe(true);
  });

  it('a weekday-only rule started >2 years ago still occurs within the past week', async () => {
    write('old-weekdays.md', `---\ndue: ${formatDueDate(daysAgo(800))}\nrrule:\n  freq: daily\n  byday: MO,TU,WE,TH,FR\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('old-weekdays.md'));
    const weekAgo = daysAgo(7).getTime();
    const now = Date.now();
    expect(results.some(ev => ev.start >= weekAgo && ev.start <= now)).toBe(true);
  });

  it('a very old daily rule stays bounded: no occurrences far outside the window', async () => {
    write('ancient-daily.md', `---\ndue: ${formatDueDate(daysAgo(365 * 10))}\nrrule:\n  freq: daily\n---\nBody.\n`);
    const results = await loadCalendarEntryForFile(f('ancient-daily.md'));
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThan(5000);
    // Nothing older than the ~5-year past window (a few days of slack for
    // timezone-frame and leap-day rounding at the boundary).
    const windowFloor = daysAgo(365 * 5 + 10).getTime();
    expect(Math.min(...results.map(ev => ev.start))).toBeGreaterThanOrEqual(windowFloor);
    // ...and it still reaches today.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    expect(results.some(ev => ev.start === todayStart.getTime())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadCalendarEvents — directory scan
// ---------------------------------------------------------------------------

describe('loadCalendarEvents — directory scan', () => {
  it('returns events from all valid .md files in the calendar test-data folder', async () => {
    const results = await loadCalendarEvents(tmpDir);
    // At minimum: simple-event, timed-event, timed-event-default-duration,
    // two-digit-year, long-body, recurring-weekly(3), recurring-byday(6)
    expect(results.length).toBeGreaterThanOrEqual(10);
  });

  it('does not return entries from files without a due field', async () => {
    const results = await loadCalendarEvents(tmpDir);
    const filePaths = results.map(ev => ev.filePath);
    expect(filePaths).not.toContain(f('no-frontmatter.md'));
    expect(filePaths).not.toContain(f('no-due.md'));
  });

  it('excludes files in ignored directories when ignoredPaths is set', async () => {
    const results = await loadCalendarEvents(tmpDir, ['ignored']);
    const filePaths = results.map(ev => ev.filePath);
    expect(filePaths.some(p => p.includes('ignored'))).toBe(false);
  });

  it('includes files in ignored directory when no ignoredPaths given', async () => {
    const results = await loadCalendarEvents(tmpDir);
    const filePaths = results.map(ev => ev.filePath);
    expect(filePaths.some(p => p.includes('ignored'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseDueStr
// ---------------------------------------------------------------------------

describe('parseDueStr', () => {
  it('rejects out-of-range dates the Date constructor would roll over', () => {
    expect(parseDueStr('2/30/2024')).toBeNull();
    expect(parseDueStr('13/1/2024')).toBeNull();
    expect(parseDueStr('0/5/2025')).toBeNull();
    expect(parseDueStr('1/0/2025')).toBeNull();
    expect(parseDueStr('2/31/2025')).toBeNull();
  });

  it('rejects empty and non-numeric parts', () => {
    expect(parseDueStr('/5/2025')).toBeNull();
    expect(parseDueStr('12abc/1/2025')).toBeNull();
    expect(parseDueStr('5/2025')).toBeNull();
  });

  it('parses valid dates', () => {
    expect(parseDueStr('6/18/2026')?.getTime()).toBe(new Date(2026, 5, 18).getTime());
  });

  it('treats a 2-digit year as 2000+YY', () => {
    expect(parseDueStr('12/31/26')?.getTime()).toBe(new Date(2026, 11, 31).getTime());
  });

  it('trims surrounding whitespace', () => {
    expect(parseDueStr('  6/18/2026  ')?.getTime()).toBe(new Date(2026, 5, 18).getTime());
  });

  it('accepts a valid leap day (2/29 in a leap year)', () => {
    expect(parseDueStr('2/29/2024')?.getTime()).toBe(new Date(2024, 1, 29).getTime());
  });

  it('rejects a leap day in a non-leap year', () => {
    expect(parseDueStr('2/29/2026')).toBeNull();
  });

  it('rejects a string with more than three parts', () => {
    expect(parseDueStr('1/2/3/4')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(parseDueStr('')).toBeNull();
  });

  it('accepts the last day of months with 31 and 30 days', () => {
    expect(parseDueStr('1/31/2026')?.getDate()).toBe(31);
    expect(parseDueStr('4/30/2026')?.getDate()).toBe(30);
  });

  it('parses an ISO YYYY-MM-DD date as a local calendar date', () => {
    expect(parseDueStr('2025-03-05')?.getTime()).toBe(new Date(2025, 2, 5).getTime());
    expect(parseDueStr('  2025-3-5  ')?.getTime()).toBe(new Date(2025, 2, 5).getTime());
  });

  it('rejects out-of-range ISO dates rather than rolling over', () => {
    expect(parseDueStr('2025-02-30')).toBeNull();
    expect(parseDueStr('2025-13-01')).toBeNull();
    expect(parseDueStr('2026-02-29')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// coerceDueDate
// ---------------------------------------------------------------------------

describe('coerceDueDate', () => {
  it('parses string due values via parseDueStr (M/D/YYYY and ISO)', () => {
    expect(coerceDueDate('6/18/2026')?.getTime()).toBe(new Date(2026, 5, 18).getTime());
    expect(coerceDueDate('2025-03-05')?.getTime()).toBe(new Date(2025, 2, 5).getTime());
  });

  it('accepts a Date instance, reading its UTC calendar day (no tz shift)', () => {
    // A YAML timestamp `2025-03-05` resolves to UTC midnight; the coerced local
    // Date must still land on the 5th regardless of the machine timezone.
    const yamlDate = new Date(Date.UTC(2025, 2, 5));
    expect(coerceDueDate(yamlDate)?.getTime()).toBe(new Date(2025, 2, 5).getTime());
  });

  it('returns null for missing, invalid, or wrong-typed values', () => {
    expect(coerceDueDate(undefined)).toBeNull();
    expect(coerceDueDate(null)).toBeNull();
    expect(coerceDueDate(42)).toBeNull();
    expect(coerceDueDate('not a date')).toBeNull();
    expect(coerceDueDate(new Date(NaN))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatDueDate
// ---------------------------------------------------------------------------

describe('formatDueDate', () => {
  it('formats a date as M/D/YYYY with no zero padding', () => {
    expect(formatDueDate(new Date(2026, 5, 5))).toBe('6/5/2026');
  });

  it('keeps multi-digit month and day un-padded', () => {
    expect(formatDueDate(new Date(2026, 11, 31))).toBe('12/31/2026');
  });

  it('uses a 4-digit year', () => {
    expect(formatDueDate(new Date(2027, 0, 1))).toBe('1/1/2027');
  });

  it('round-trips with parseDueStr', () => {
    const original = new Date(2026, 6, 4);
    const reparsed = parseDueStr(formatDueDate(original));
    expect(reparsed?.getTime()).toBe(original.getTime());
  });
});

// ---------------------------------------------------------------------------
// hasDueProperty / getDueProperty
// ---------------------------------------------------------------------------

const WITH_DUE = `---\ndue: 5/1/2026\ntitle: Test\n---\nBody text.`;
const WITHOUT_DUE = `---\ntitle: No Due\n---\nBody text.`;
const NO_FM = `Just plain body text.`;
const UNCLOSED_FM = `---\ndue: 5/1/2026\nno closing fence`;

describe('hasDueProperty', () => {
  it('returns true when due is present', () => {
    expect(hasDueProperty(WITH_DUE)).toBe(true);
  });

  it('returns false when due is absent', () => {
    expect(hasDueProperty(WITHOUT_DUE)).toBe(false);
  });

  it('returns false with no front matter', () => {
    expect(hasDueProperty(NO_FM)).toBe(false);
  });

  it('returns false when front matter is not closed', () => {
    expect(hasDueProperty(UNCLOSED_FM)).toBe(false);
  });
});

describe('getDueProperty', () => {
  it('returns the due value when present', () => {
    expect(getDueProperty(WITH_DUE)).toBe('5/1/2026');
  });

  it('returns null when due is absent', () => {
    expect(getDueProperty(WITHOUT_DUE)).toBeNull();
  });

  it('returns null with no front matter', () => {
    expect(getDueProperty(NO_FM)).toBeNull();
  });

  it('trims surrounding whitespace from value', () => {
    const content = `---\ndue:   6/15/2026  \n---\n`;
    expect(getDueProperty(content)).toBe('6/15/2026');
  });
});

// ---------------------------------------------------------------------------
// getStartProperty / getDurationProperty
// ---------------------------------------------------------------------------

describe('getStartProperty', () => {
  it('returns the start value, stripping quotes', () => {
    const content = `---\ndue: 5/1/2026\nstart: "2:00 PM"\n---\n`;
    expect(getStartProperty(content)).toBe('2:00 PM');
  });

  it('returns null when start is absent', () => {
    expect(getStartProperty(WITH_DUE)).toBeNull();
  });
});

describe('getDurationProperty', () => {
  it('returns the duration value as a string', () => {
    const content = `---\ndue: 5/1/2026\nduration: 2\n---\n`;
    expect(getDurationProperty(content)).toBe('2');
  });

  it('returns null when duration is absent', () => {
    expect(getDurationProperty(WITH_DUE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setDueProperty
// ---------------------------------------------------------------------------

describe('setDueProperty', () => {
  it('replaces an existing due value', () => {
    const result = setDueProperty(WITH_DUE, '12/25/2026');
    expect(getDueProperty(result)).toBe('12/25/2026');
  });

  it('inserts due when front matter has no due field', () => {
    const result = setDueProperty(WITHOUT_DUE, '12/25/2026');
    expect(hasDueProperty(result)).toBe(true);
    expect(getDueProperty(result)).toBe('12/25/2026');
  });

  it('creates front matter and inserts due when none exists', () => {
    const result = setDueProperty(NO_FM, '1/1/2027');
    expect(result.startsWith('---')).toBe(true);
    expect(getDueProperty(result)).toBe('1/1/2027');
    expect(result).toContain('Just plain body text.');
  });

  it('does not duplicate body content', () => {
    const result = setDueProperty(WITH_DUE, '12/25/2026');
    expect(result.split('Body text.').length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// setStartProperty / setDurationProperty
// ---------------------------------------------------------------------------

describe('setStartProperty', () => {
  it('inserts a quoted start value', () => {
    const result = setStartProperty(WITH_DUE, '3:30 PM');
    expect(getStartProperty(result)).toBe('3:30 PM');
  });

  it('replaces an existing start value', () => {
    const content = `---\ndue: 5/1/2026\nstart: "9:00 AM"\n---\nBody.`;
    const result = setStartProperty(content, '4:00 PM');
    expect(getStartProperty(result)).toBe('4:00 PM');
  });
});

describe('setDurationProperty', () => {
  it('inserts a duration value', () => {
    const result = setDurationProperty(WITH_DUE, '3');
    expect(getDurationProperty(result)).toBe('3');
  });

  it('replaces an existing duration value', () => {
    const content = `---\ndue: 5/1/2026\nduration: 1\n---\nBody.`;
    const result = setDurationProperty(content, '2');
    expect(getDurationProperty(result)).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// getRRuleProperty / setRRuleProperty
// ---------------------------------------------------------------------------

const WITH_RRULE = `---\ndue: 1/5/2026\nrrule:\n  freq: weekly\n  interval: 2\n  byday: MO,WE\n  until: 12/31/28\n---\nBody.`;

describe('getRRuleProperty', () => {
  it('returns parsed rrule fields', () => {
    const r = getRRuleProperty(WITH_RRULE);
    expect(r).not.toBeNull();
    expect(r?.freq).toBe('weekly');
    expect(r?.interval).toBe('2');
    expect(r?.byday).toBe('MO,WE');
    expect(r?.until).toBe('12/31/28');
  });

  it('returns null when no rrule block', () => {
    expect(getRRuleProperty(WITH_DUE)).toBeNull();
  });

  it('returns null with no front matter', () => {
    expect(getRRuleProperty(NO_FM)).toBeNull();
  });
});

describe('setRRuleProperty', () => {
  it('adds an rrule block when none exists', () => {
    const result = setRRuleProperty(WITH_DUE, { freq: 'daily', count: '5' });
    const r = getRRuleProperty(result);
    expect(r?.freq).toBe('daily');
    expect(r?.count).toBe('5');
  });

  it('replaces an existing rrule block', () => {
    const result = setRRuleProperty(WITH_RRULE, { freq: 'monthly', count: '3' });
    const r = getRRuleProperty(result);
    expect(r?.freq).toBe('monthly');
    expect(r?.count).toBe('3');
    expect(r?.byday).toBeUndefined();
  });

  it('removes the rrule block when passed null', () => {
    const result = setRRuleProperty(WITH_RRULE, null);
    expect(getRRuleProperty(result)).toBeNull();
    expect(result).toContain('due: 1/5/2026');
  });

  it('omits interval line when interval is "1"', () => {
    const result = setRRuleProperty(WITH_DUE, { freq: 'weekly', interval: '1' });
    expect(result).not.toMatch(/^\s+interval:/m);
  });

  it('returns content unchanged when passed null with no existing rrule', () => {
    const result = setRRuleProperty(WITH_DUE, null);
    expect(result).toBe(WITH_DUE);
  });

  it('emits indented byday and until lines that read back', () => {
    const result = setRRuleProperty(WITH_DUE, {
      freq: 'weekly',
      byday: 'TU,TH',
      until: '12/31/2027',
    });
    expect(result).toMatch(/^ {2}byday: TU,TH$/m);
    expect(result).toMatch(/^ {2}until: 12\/31\/2027$/m);
    const r = getRRuleProperty(result);
    expect(r?.byday).toBe('TU,TH');
    expect(r?.until).toBe('12/31/2027');
  });

  it('emits interval line when interval is greater than 1', () => {
    const result = setRRuleProperty(WITH_DUE, { freq: 'weekly', interval: '3' });
    expect(result).toMatch(/^ {2}interval: 3$/m);
    expect(getRRuleProperty(result)?.interval).toBe('3');
  });

  it('does nothing when no front matter exists and rrule has no freq', () => {
    const result = setRRuleProperty(NO_FM, { interval: '2' });
    expect(result).toBe(NO_FM);
  });

  it('creates front matter when none exists and rrule has a freq', () => {
    const result = setRRuleProperty(NO_FM, { freq: 'daily', count: '4' });
    expect(result.startsWith('---')).toBe(true);
    const r = getRRuleProperty(result);
    expect(r?.freq).toBe('daily');
    expect(r?.count).toBe('4');
    expect(result).toContain('Just plain body text.');
  });
});

// ---------------------------------------------------------------------------
// rrule helpers on CRLF documents (Windows-authored / pasted files)
// ---------------------------------------------------------------------------

describe('rrule helpers — CRLF documents', () => {
  const CRLF_RRULE = '---\r\ndue: 1/5/2026\r\nrrule:\r\n  freq: weekly\r\n  interval: 2\r\n---\r\nBody.\r\n';

  it('sees an rrule block written with CRLF line endings', () => {
    const r = getRRuleProperty(CRLF_RRULE);
    expect(r?.freq).toBe('weekly');
    expect(r?.interval).toBe('2');
  });

  it('replaces the existing block instead of appending a duplicate rrule key', () => {
    const result = setRRuleProperty(CRLF_RRULE, { freq: 'daily' });
    expect(result.match(/rrule:/g)).toHaveLength(1);
    expect(getRRuleProperty(result)?.freq).toBe('daily');
    // A duplicate key would make js-yaml throw, and the front matter would read back as null.
    expect(parseFrontMatter(result).yaml?.due).toBe('1/5/2026');
  });

  it('removes the rrule block from a CRLF document', () => {
    const result = setRRuleProperty(CRLF_RRULE, null);
    expect(getRRuleProperty(result)).toBeNull();
    expect(parseFrontMatter(result).yaml?.due).toBe('1/5/2026');
  });

  it('leaves the CRLF body intact', () => {
    const result = setRRuleProperty(CRLF_RRULE, { freq: 'daily' });
    expect(result.endsWith('Body.\r\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rrule helpers on non-block YAML styles (M5: duplicate-key poisoning)
//
// A flow-style rrule or a quoted key is valid YAML a user can legitimately write.
// The old regex editors couldn't see them, so editing appended a second key and
// js-yaml then threw on every subsequent parse. These pin the parse/dump fix.
// ---------------------------------------------------------------------------

describe('rrule helpers — non-block YAML styles', () => {
  it('reads a flow-style rrule mapping', () => {
    const content = `---\ndue: 1/5/2026\nrrule: {freq: weekly, interval: 2}\n---\nBody.`;
    const r = getRRuleProperty(content);
    expect(r?.freq).toBe('weekly');
    expect(r?.interval).toBe('2');
  });

  it('replaces a flow-style rrule without appending a duplicate key', () => {
    const content = `---\ndue: 1/5/2026\nrrule: {freq: weekly, interval: 2}\n---\nBody.`;
    const result = setRRuleProperty(content, { freq: 'daily', count: '3' });
    expect(result.match(/rrule:/g)).toHaveLength(1);
    expect(getRRuleProperty(result)?.freq).toBe('daily');
    // A duplicate key would make js-yaml throw; the front matter must still read back.
    expect(parseFrontMatter(result).yaml?.due).toBe('1/5/2026');
  });

  it('removes a flow-style rrule cleanly', () => {
    const content = `---\ndue: 1/5/2026\nrrule: {freq: weekly}\n---\nBody.`;
    const result = setRRuleProperty(content, null);
    expect(getRRuleProperty(result)).toBeNull();
    expect(parseFrontMatter(result).yaml?.due).toBe('1/5/2026');
  });

  it('does not duplicate a quoted top-level key when injecting', () => {
    const content = `---\n"due": 3/5/2025\n---\nBody text.`;
    const result = injectCalendarFrontMatter(content, false);
    // Exactly one due mapping — a second would make js-yaml throw on the next read.
    expect(parseFrontMatter(result).yaml).not.toBeNull();
    expect(parseFrontMatter(result).yaml?.due).toBe('3/5/2025');
  });

  it('leaves unparseable front matter untouched rather than corrupting it further', () => {
    const broken = `---\ndue: 1/5/2026\nrrule:\nrrule:\n---\nBody.`;
    expect(setRRuleProperty(broken, { freq: 'daily' })).toBe(broken);
  });
});

// ---------------------------------------------------------------------------
// injectCalendarFrontMatter
// ---------------------------------------------------------------------------

describe('injectCalendarFrontMatter', () => {
  it('prepends front matter when content has none', () => {
    const result = injectCalendarFrontMatter('My note body.', false);
    expect(result.startsWith('---')).toBe(true);
    expect(result).toContain('due:');
    expect(result).toContain('start:');
    expect(result).toContain('duration: 1');
    expect(result).toContain('My note body.');
  });

  it('does not duplicate body when content already has front matter', () => {
    const result = injectCalendarFrontMatter(WITHOUT_DUE, false);
    expect(result.split('Body text.').length).toBe(2);
  });

  it('includes rrule block when repeating=true', () => {
    const result = injectCalendarFrontMatter('Body.', true);
    expect(result).toContain('rrule:');
    expect(result).toContain('freq: weekly');
    expect(result).toContain('until:');
  });

  it('omits rrule block when repeating=false', () => {
    const result = injectCalendarFrontMatter('Body.', false);
    expect(result).not.toContain('rrule:');
  });

  it('writes the due date with a 4-digit year (issue 015)', () => {
    const result = injectCalendarFrontMatter('Body.', false);
    expect(result).toMatch(/^due: \d{1,2}\/\d{1,2}\/\d{4}$/m);
  });

  it('writes the rrule until date with a 4-digit year (issue 015)', () => {
    const result = injectCalendarFrontMatter('Body.', true);
    expect(result).toMatch(/^ {2}until: 12\/31\/\d{4}$/m);
  });

  it('keeps an existing start/duration instead of duplicating the keys', () => {
    const content = `---\ntitle: Note\nstart: "2:00 PM"\nduration: 3\n---\nBody text.\n`;
    const result = injectCalendarFrontMatter(content, false);

    expect(result.match(/^start:/gm)).toHaveLength(1);
    expect(result.match(/^duration:/gm)).toHaveLength(1);
    expect(getStartProperty(result)).toBe('2:00 PM');
    expect(getDurationProperty(result)).toBe('3');
    expect(getDueProperty(result)).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
    // Must still be parseable — duplicate keys make js-yaml throw.
    expect(parseFrontMatter(result).yaml).toMatchObject({ title: 'Note', duration: 3 });
  });

  it('keeps an existing rrule block instead of duplicating the key', () => {
    const content = `---\nrrule:\n  freq: monthly\n  interval: 2\n---\nBody text.\n`;
    const result = injectCalendarFrontMatter(content, true);

    expect(result.match(/^rrule:/gm)).toHaveLength(1);
    expect(getRRuleProperty(result)).toMatchObject({ freq: 'monthly', interval: '2' });
    expect(parseFrontMatter(result).yaml).not.toBeNull();
  });

  it('does not treat rrule child keys as top-level duplicates', () => {
    // `until:` is indented under rrule — the top-level due/start/duration must still be added.
    const content = `---\nrrule:\n  freq: weekly\n  until: 12/31/2030\n---\nBody text.\n`;
    const result = injectCalendarFrontMatter(content, false);

    expect(getDueProperty(result)).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
    expect(getStartProperty(result)).toBeTruthy();
    expect(getDurationProperty(result)).toBe('1');
    expect(parseFrontMatter(result).yaml).not.toBeNull();
  });

  it('leaves content unchanged when every calendar field already exists', () => {
    const content = `---\ndue: 6/15/2026\nstart: "2:00 PM"\nduration: 1\n---\nBody text.\n`;
    expect(injectCalendarFrontMatter(content, false)).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// Unified front-matter parsing (issues 005 / 006): CRLF, fence anchoring,
// and read/write round-trip agreement between the util and the loader.
// ---------------------------------------------------------------------------

describe('front-matter parsing — CRLF line endings', () => {
  const CRLF = `---\r\ndue: 6/15/2026\r\nstart: "2:00 PM"\r\n---\r\nBody line.\r\n`;

  it('reads properties from a CRLF file (no stray carriage returns)', () => {
    expect(getDueProperty(CRLF)).toBe('6/15/2026');
    expect(getStartProperty(CRLF)).toBe('2:00 PM');
    expect(hasDueProperty(CRLF)).toBe(true);
  });

  it('the loader detects the same CRLF front matter as one event', async () => {
    write('crlf-event.md', CRLF);
    const results = await loadCalendarEntryForFile(f('crlf-event.md'));
    expect(results).toHaveLength(1);
    expect(results[0].start).toBe(new Date(2026, 5, 15, 14, 0, 0, 0).getTime());
  });
});

describe('front-matter parsing — fence anchoring', () => {
  it('does not treat a body --- thematic break as front matter', () => {
    const content = `Intro paragraph.\n\n---\n\nSection after a horizontal rule.\n`;
    expect(hasDueProperty(content)).toBe(false);
    expect(getDueProperty(content)).toBeNull();
  });

  it('the loader returns [] for a doc whose only --- is a body thematic break', async () => {
    write('hr-body.md', `Intro paragraph.\n\n---\n\nMore body text.\n`);
    const results = await loadCalendarEntryForFile(f('hr-body.md'));
    expect(results).toHaveLength(0);
  });

  it('does not treat a leading ---- thematic break as an opening fence', () => {
    const content = `----\ndue: 6/15/2026\n----\nBody.`;
    expect(hasDueProperty(content)).toBe(false);
  });
});

describe('front-matter parsing — write/read round-trip agreement', () => {
  it('a value written by the util reads back identically via the util and the loader', async () => {
    let content = setDueProperty(NO_FM, '6/15/2026');
    content = setStartProperty(content, '2:00 PM');
    content = setDurationProperty(content, '2');

    expect(getDueProperty(content)).toBe('6/15/2026');
    expect(getStartProperty(content)).toBe('2:00 PM');
    expect(getDurationProperty(content)).toBe('2');

    write('round-trip.md', content);
    const [ev] = await loadCalendarEntryForFile(f('round-trip.md'));
    expect(ev.start).toBe(new Date(2026, 5, 15, 14, 0, 0, 0).getTime());
    expect(ev.end).toBe(ev.start + 2 * 60 * 60 * 1000);
  });
});
