import { describe, it, expect } from 'vitest';
import { parseDateString } from '../src/utils/timeUtil';

describe('parseDateString', () => {
  it('returns 0 for empty string', () => {
    expect(parseDateString('')).toBe(0);
  });

  it('returns 0 for non-date strings', () => {
    expect(parseDateString('hello world')).toBe(0);
    expect(parseDateString('not a date')).toBe(0);
  });

  it('returns 0 for partial/invalid date formats', () => {
    expect(parseDateString('05/26')).toBe(0);
    expect(parseDateString('2026-05-26')).toBe(0);
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

  it('returns 0 for strings with extra content beyond the date', () => {
    expect(parseDateString('05/26/2026 some extra text')).toBe(0);
  });
});
