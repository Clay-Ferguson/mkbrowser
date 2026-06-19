import { describe, it, expect } from 'vitest';
import { parseDateString } from '../src/utils/timeUtil';

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
    expect(parseDateString('2026-05-26')).toBeNaN();
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
});
