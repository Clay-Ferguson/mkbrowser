import { describe, it, expect } from 'vitest';
import { DATE_REGEX } from '../src/utils/regexPatterns';
import { extractTimestamp } from '../src/utils/timeUtil';

// Strings that the editor decoration is meant to highlight (valid date shapes).
const decoratorValid = [
  '05/26/2026',
  '05/26/26',
  '5/6/26',
  '12/31/1999',
  '01/01/2026 12:00 AM',
  '01/01/2026 12:00 PM',
  '05/26/2026 02:30 PM',
  '05/26/2026 02:30:45 PM',
  '05/26/2026 2:30 pm',
];

// Strings that look date-ish but are NOT valid date shapes.
const strictInvalid = [
  '13/45/2026', // month/day out of range
  '00/10/2026', // month 0
  '05/00/2026', // day 0
  '2026-05-26', // wrong separators
  '05/26', // missing year
  'hello world',
];

describe('DATE_REGEX (single source of truth)', () => {
  it('exposes the canonical capture-group order (month, day, year, hour, minute, seconds, ampm)', () => {
    const m = '05/26/2026 02:30:45 PM'.match(DATE_REGEX);
    expect(m).not.toBeNull();
    expect(m?.slice(1, 8)).toEqual(['05', '26', '2026', '02', '30', '45', 'PM']);
  });

  // The invariant Issue 004 asks us to guard: anything the decorator pattern
  // matches must also yield a non-error parse, since both now share one source.
  it.each(decoratorValid)('matches and parses %s', (s) => {
    expect(DATE_REGEX.test(s)).toBe(true);
    expect(extractTimestamp(s)).toBeGreaterThan(0);
  });

  it.each(strictInvalid)('rejects (no decorate, no parse) %s', (s) => {
    // A bare invalid token must neither match nor parse...
    expect(DATE_REGEX.test(s)).toBe(false);
    // ...but extractTimestamp scans within text, so it must not find a valid
    // date hiding inside these specific strings either.
    expect(extractTimestamp(s)).toBeNaN();
  });

  it('finds a valid date embedded in surrounding text', () => {
    expect(extractTimestamp('due by 05/26/2026 sharp')).toBe(
      new Date(2026, 4, 26, 0, 0, 0).getTime()
    );
  });
});
