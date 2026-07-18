import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  parseDateString,
  extractTimestamp,
  past,
  future,
  today,
  formatDate,
  getDaysFromToday,
  formatDaysDisplay,
  generateTimestampFolderName,
  generateTimestampFileName,
  formatTimestamp,
  TIMESTAMP_FILENAME_RE,
  NO_TIMESTAMP,
} from '../src/shared/timeUtil';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('parseDateString', () => {
  it('returns NaN for empty string', () => {
    expect(parseDateString('')).toBeNaN();
  });

  it('returns NaN for non-date strings', () => {
    expect(parseDateString('hello world')).toBeNaN();
    expect(parseDateString('not a date')).toBeNaN();
  });

  it('returns NaN for partial/invalid date formats', () => {
    expect(parseDateString('05/26')).toBeNaN();
    expect(parseDateString('2026-05')).toBeNaN();
    expect(parseDateString('2026-5-26')).toBeNaN(); // ISO requires zero-padded month/day
  });

  it('returns NaN for impossible calendar dates (rollover rejected)', () => {
    expect(parseDateString('02/31/2025')).toBeNaN();
    expect(parseDateString('04/31/2025')).toBeNaN();
    expect(parseDateString('02/30/2024')).toBeNaN(); // 2024 is a leap year, but Feb 30 still invalid
  });

  it('accepts Feb 29 in a leap year', () => {
    expect(parseDateString('02/29/2024')).toBe(new Date(2024, 1, 29, 0, 0, 0).getTime());
  });

  it('parses a valid pre-1970 date to its (negative) timestamp, not NaN', () => {
    const result = parseDateString('12/31/1969');
    expect(result).toBe(new Date(1969, 11, 31, 0, 0, 0).getTime());
    expect(result).not.toBeNaN();
  });

  it('parses MM/DD/YYYY format', () => {
    const result = parseDateString('05/26/2026');
    expect(result).toBe(new Date(2026, 4, 26, 0, 0, 0).getTime());
  });

  it('parses MM/DD/YY format (2-digit year treated as 2000+YY)', () => {
    const result = parseDateString('05/26/26');
    expect(result).toBe(new Date(2026, 4, 26, 0, 0, 0).getTime());
  });

  it('parses date with HH:MM AM/PM time', () => {
    const result = parseDateString('05/26/2026 02:30 PM');
    expect(result).toBe(new Date(2026, 4, 26, 14, 30, 0).getTime());
  });

  it('parses date with HH:MM:SS AM/PM time', () => {
    const result = parseDateString('05/26/2026 02:30:45 PM');
    expect(result).toBe(new Date(2026, 4, 26, 14, 30, 45).getTime());
  });

  it('handles 12:xx AM as midnight', () => {
    const result = parseDateString('01/01/2026 12:00 AM');
    expect(result).toBe(new Date(2026, 0, 1, 0, 0, 0).getTime());
  });

  it('handles 12:xx PM as noon', () => {
    const result = parseDateString('01/01/2026 12:00 PM');
    expect(result).toBe(new Date(2026, 0, 1, 12, 0, 0).getTime());
  });

  it('is case-insensitive for AM/PM', () => {
    const lower = parseDateString('05/26/2026 02:30 pm');
    const upper = parseDateString('05/26/2026 02:30 PM');
    expect(lower).toBe(upper);
  });

  it('trims surrounding whitespace', () => {
    const result = parseDateString('  05/26/2026  ');
    expect(result).toBe(new Date(2026, 4, 26, 0, 0, 0).getTime());
  });

  it('returns NaN for strings with extra content beyond the date', () => {
    expect(parseDateString('05/26/2026 some extra text')).toBeNaN();
  });

  it('returns NaN for an out-of-range month or day', () => {
    expect(parseDateString('13/01/2026')).toBeNaN(); // month > 12
    expect(parseDateString('00/01/2026')).toBeNaN(); // month 00
    expect(parseDateString('05/00/2026')).toBeNaN(); // day 00
    expect(parseDateString('05/32/2026')).toBeNaN(); // day > 31
  });

  it('accepts the maximum valid day for a 31-day month', () => {
    expect(parseDateString('01/31/2026')).toBe(new Date(2026, 0, 31, 0, 0, 0).getTime());
  });

  it('rejects day 31 in a 30-day month', () => {
    expect(parseDateString('11/31/2026')).toBeNaN(); // November has 30 days
  });

  // ISO 8601 (YYYY-MM-DD) — the idiomatic YAML front-matter date form,
  // reaching parseDateString via the advanced-search prop(path, 'ts') helper.
  it('parses an ISO date (YYYY-MM-DD) as local midnight', () => {
    expect(parseDateString('2026-05-26')).toBe(new Date(2026, 4, 26, 0, 0, 0).getTime());
  });

  it('parses an ISO date-time with T or space separator (24-hour clock)', () => {
    const expected = new Date(2026, 4, 26, 14, 30, 0).getTime();
    expect(parseDateString('2026-05-26T14:30')).toBe(expected);
    expect(parseDateString('2026-05-26 14:30')).toBe(expected);
    expect(parseDateString('2026-05-26T14:30:45')).toBe(new Date(2026, 4, 26, 14, 30, 45).getTime());
  });

  it('trims surrounding whitespace around an ISO date', () => {
    expect(parseDateString('  2026-05-26  ')).toBe(new Date(2026, 4, 26, 0, 0, 0).getTime());
  });

  it('rejects impossible or out-of-range ISO dates', () => {
    expect(parseDateString('2025-02-31')).toBeNaN(); // Feb 31 does not exist
    expect(parseDateString('2026-13-01')).toBeNaN(); // month > 12
    expect(parseDateString('2026-00-10')).toBeNaN(); // month 00
    expect(parseDateString('2026-05-00')).toBeNaN(); // day 00
    expect(parseDateString('2026-05-32')).toBeNaN(); // day > 31
  });

  // new Date(y, ...) treats a year in 0–99 as 1900+y. The parsers must
  // compensate, otherwise explicit 4-digit years like 0099 silently become
  // 20th-century dates.
  it('parses a 4-digit ISO year below 100 literally, not as 19xx', () => {
    const expected = new Date(2000, 11, 31, 0, 0, 0); // leap-safe scaffold year
    expected.setFullYear(99);
    expect(parseDateString('0099-12-31')).toBe(expected.getTime());
  });

  it('parses a 4-digit slash-date year below 100 literally, not as 2-digit', () => {
    // "0026" is four explicit digits: the 2-digit "YY → 2000+YY" convention
    // must not apply, and the Date constructor's 1900+y mapping must not leak.
    const expected = new Date(2000, 6, 18, 0, 0, 0);
    expected.setFullYear(26);
    expect(parseDateString('07/18/0026')).toBe(expected.getTime());
  });

  it('rejects ISO date-times with out-of-range time components or timezone suffixes', () => {
    expect(parseDateString('2026-05-26T24:00')).toBeNaN(); // hour > 23
    expect(parseDateString('2026-05-26T14:60')).toBeNaN(); // minute > 59
    expect(parseDateString('2026-05-26T14:30:00Z')).toBeNaN(); // timezone suffixes not supported
    expect(parseDateString('2026-05-26T14:30:00+02:00')).toBeNaN();
  });
});

describe('NO_TIMESTAMP', () => {
  it('is NaN so it cannot collide with any real getTime() result', () => {
    expect(NO_TIMESTAMP).toBeNaN();
    expect(Number.isNaN(NO_TIMESTAMP)).toBe(true);
  });
});

describe('extractTimestamp', () => {
  it('returns NO_TIMESTAMP when no date is present', () => {
    expect(extractTimestamp('just some text with no date')).toBeNaN();
    expect(extractTimestamp('')).toBeNaN();
  });

  it('extracts a date embedded in free text', () => {
    const result = extractTimestamp('Meeting scheduled for 05/26/2026 in the morning');
    expect(result).toBe(new Date(2026, 4, 26, 0, 0, 0).getTime());
  });

  it('extracts a date with a time component embedded in text', () => {
    const result = extractTimestamp('Due 05/26/2026 02:30 PM sharp');
    expect(result).toBe(new Date(2026, 4, 26, 14, 30, 0).getTime());
  });

  it('returns the first date when multiple are present', () => {
    const result = extractTimestamp('From 01/01/2026 to 12/31/2026');
    expect(result).toBe(new Date(2026, 0, 1, 0, 0, 0).getTime());
  });

  it('returns NO_TIMESTAMP when the only match is an impossible date', () => {
    expect(extractTimestamp('the date 02/31/2025 is fake')).toBeNaN();
  });

  it('parses a 2-digit year embedded in text as 2000+YY', () => {
    const result = extractTimestamp('see note from 05/26/26 here');
    expect(result).toBe(new Date(2026, 4, 26, 0, 0, 0).getTime());
  });
});

describe('past', () => {
  const now = new Date(2026, 5, 15, 12, 0, 0).getTime();

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false for NO_TIMESTAMP / NaN', () => {
    expect(past(NO_TIMESTAMP)).toBe(false);
    expect(past(Number.NaN)).toBe(false);
  });

  it('returns true for a timestamp before now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(past(now - 1000)).toBe(true);
  });

  it('returns false for a timestamp after now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(past(now + 1000)).toBe(false);
  });

  it('respects lookbackDays: within the window is true', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(past(now - 2 * MS_PER_DAY, 5)).toBe(true);
  });

  it('respects lookbackDays: beyond the window is false', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(past(now - 10 * MS_PER_DAY, 5)).toBe(false);
  });

  it('a future timestamp is not "past" even with lookbackDays', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(past(now + MS_PER_DAY, 5)).toBe(false);
  });
});

describe('future', () => {
  const now = new Date(2026, 5, 15, 12, 0, 0).getTime();

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false for NO_TIMESTAMP / NaN', () => {
    expect(future(NO_TIMESTAMP)).toBe(false);
    expect(future(Number.NaN)).toBe(false);
  });

  it('returns true for a timestamp after now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(future(now + 1000)).toBe(true);
  });

  it('returns false for a timestamp before now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(future(now - 1000)).toBe(false);
  });

  it('respects lookaheadDays: within the window is true', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(future(now + 2 * MS_PER_DAY, 5)).toBe(true);
  });

  it('respects lookaheadDays: beyond the window is false', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(future(now + 10 * MS_PER_DAY, 5)).toBe(false);
  });

  it('a past timestamp is not "future" even with lookaheadDays', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(future(now - MS_PER_DAY, 5)).toBe(false);
  });
});

describe('today', () => {
  const noon = new Date(2026, 5, 15, 12, 0, 0).getTime();

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false for NO_TIMESTAMP / NaN', () => {
    expect(today(NO_TIMESTAMP)).toBe(false);
  });

  it('returns true for a timestamp on the same calendar day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(noon);
    expect(today(new Date(2026, 5, 15, 0, 0, 0).getTime())).toBe(true);
    expect(today(new Date(2026, 5, 15, 23, 59, 59).getTime())).toBe(true);
  });

  it('returns false for yesterday and tomorrow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(noon);
    expect(today(new Date(2026, 5, 14, 23, 59, 59).getTime())).toBe(false);
    expect(today(new Date(2026, 5, 16, 0, 0, 1).getTime())).toBe(false);
  });

  it('returns false for the same day/month in a different year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(noon);
    expect(today(new Date(2025, 5, 15, 12, 0, 0).getTime())).toBe(false);
  });
});

describe('formatDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats the current date as MM/DD/YY with zero padding', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 5, 9, 0, 0)); // March 5, 2026
    expect(formatDate()).toBe('03/05/26');
  });
});

describe('getDaysFromToday', () => {
  const noon = new Date(2026, 5, 15, 12, 0, 0);

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 for any time today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(noon);
    expect(getDaysFromToday(new Date(2026, 5, 15, 0, 0, 0).getTime())).toBe(0);
    expect(getDaysFromToday(new Date(2026, 5, 15, 23, 59, 0).getTime())).toBe(0);
  });

  it('returns a negative count for past dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(noon);
    expect(getDaysFromToday(new Date(2026, 5, 12, 8, 0, 0).getTime())).toBe(-3);
  });

  it('returns a positive count for future dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(noon);
    expect(getDaysFromToday(new Date(2026, 5, 20, 22, 0, 0).getTime())).toBe(5);
  });

  it('ignores the time of day on both ends (rounds to whole days)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 23, 0, 0));
    // Target is early next morning — only ~2 hours later but a different day.
    expect(getDaysFromToday(new Date(2026, 5, 16, 1, 0, 0).getTime())).toBe(1);
  });
});

describe('formatDaysDisplay', () => {
  it('returns "(today)" for 0', () => {
    expect(formatDaysDisplay(0)).toBe('(today)');
  });

  it('formats a single day with singular noun', () => {
    expect(formatDaysDisplay(1)).toBe('+(1 day)');
    expect(formatDaysDisplay(-1)).toBe('-(1 day)');
  });

  it('formats small day counts with plural noun and sign', () => {
    expect(formatDaysDisplay(5)).toBe('+(5 days)');
    expect(formatDaysDisplay(-3)).toBe('-(3 days)');
    expect(formatDaysDisplay(30)).toBe('+(30 days)');
  });

  it('breaks values >= 31 days into years/months/days', () => {
    // 365 + 60 + 5 = 430 days -> 1y 2m 5d
    expect(formatDaysDisplay(430)).toBe('+(1y 2m 5d)');
    expect(formatDaysDisplay(-430)).toBe('-(1y 2m 5d)');
  });

  it('omits zero-valued components', () => {
    expect(formatDaysDisplay(365)).toBe('+(1y)'); // exactly one year
    expect(formatDaysDisplay(60)).toBe('+(2m)'); // exactly two 30-day months
    expect(formatDaysDisplay(31)).toBe('+(1m 1d)');
  });
});

describe('generateTimestampFolderName / generateTimestampFileName', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats the folder name as YYYY-MM-DD--HH-MM-SS-AM/PM (12-hour clock)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 5, 14, 7, 9)); // 2:07:09 PM
    expect(generateTimestampFolderName()).toBe('2026-03-05--02-07-09-PM');
  });

  it('renders midnight as 12 AM and noon as 12 PM', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0)); // midnight
    expect(generateTimestampFolderName()).toBe('2026-01-01--12-00-00-AM');
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0)); // noon
    expect(generateTimestampFolderName()).toBe('2026-01-01--12-00-00-PM');
  });

  it('appends .md for the file name variant', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 5, 14, 7, 9));
    expect(generateTimestampFileName()).toBe('2026-03-05--02-07-09-PM.md');
  });

  it('produces a file name that matches TIMESTAMP_FILENAME_RE', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 5, 14, 7, 9));
    expect(TIMESTAMP_FILENAME_RE.test(generateTimestampFileName())).toBe(true);
  });
});

describe('TIMESTAMP_FILENAME_RE', () => {
  it('matches well-formed timestamp file names', () => {
    expect(TIMESTAMP_FILENAME_RE.test('2026-03-05--02-07-09-PM.md')).toBe(true);
    expect(TIMESTAMP_FILENAME_RE.test('1999-12-31--11-59-59-AM.md')).toBe(true);
  });

  it('rejects names with the wrong shape, suffix, or AM/PM token', () => {
    expect(TIMESTAMP_FILENAME_RE.test('2026-03-05--02-07-09-PM.txt')).toBe(false);
    expect(TIMESTAMP_FILENAME_RE.test('2026-03-05--02-07-09.md')).toBe(false);
    expect(TIMESTAMP_FILENAME_RE.test('2026-3-5--2-7-9-PM.md')).toBe(false);
    expect(TIMESTAMP_FILENAME_RE.test('prefix-2026-03-05--02-07-09-PM.md')).toBe(false);
  });
});

describe('formatTimestamp', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats current date/time as MM/DD/YY HH:MM AM/PM', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 5, 14, 7, 0)); // 2:07 PM
    expect(formatTimestamp()).toBe('03/05/26 02:07 PM');
  });

  it('renders midnight as 12:00 AM and noon as 12:00 PM', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
    expect(formatTimestamp()).toBe('01/01/26 12:00 AM');
    vi.setSystemTime(new Date(2026, 0, 1, 12, 30, 0));
    expect(formatTimestamp()).toBe('01/01/26 12:30 PM');
  });

  it('round-trips through parseDateString to the same minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 5, 14, 7, 0));
    const formatted = formatTimestamp();
    vi.useRealTimers();
    expect(parseDateString(formatted)).toBe(new Date(2026, 2, 5, 14, 7, 0).getTime());
  });
});
