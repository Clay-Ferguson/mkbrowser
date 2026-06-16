import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadCalendarEntryForFile, loadCalendarEvents } from '../src/utils/calendar/calendarLoader';
import {
  isMarkdownFile,
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
} from '../src/utils/calendar/calendarUtil';

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

describe('loadCalendarEntryForFile — two-digit year', () => {
  it('treats 2-digit year as 2000+YY', async () => {
    const [ev] = await loadCalendarEntryForFile(f('two-digit-year.md'));
    expect(ev.start).toBe(new Date(2027, 2, 10).getTime());
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
// isMarkdownFile
// ---------------------------------------------------------------------------

describe('isMarkdownFile', () => {
  it('returns true for .md files', () => {
    expect(isMarkdownFile('note.md')).toBe(true);
  });

  it('returns true for .markdown files', () => {
    expect(isMarkdownFile('note.markdown')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isMarkdownFile('NOTE.MD')).toBe(true);
    expect(isMarkdownFile('NOTE.Markdown')).toBe(true);
  });

  it('returns false for other extensions', () => {
    expect(isMarkdownFile('note.txt')).toBe(false);
    expect(isMarkdownFile('note.html')).toBe(false);
    expect(isMarkdownFile('note')).toBe(false);
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
});
