/**
 * Utilities for turning a markdown file into a calendar item via front matter injection.
 */

import { splitFrontMatter, setFrontMatterProperty } from '../shared/frontMatterUtil';

function getCurrentDateStr(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear();
  return `${month}/${day}/${year}`;
}

function getCurrentTimeStr(): string {
  const now = new Date();
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

function getUntilDateStr(): string {
  const year = new Date().getFullYear() + 2;
  return `12/31/${year}`;
}

/**
 * Checks whether the given markdown content already has a 'due' property in front matter.
 */
export function hasDueProperty(content: string): boolean {
  const parsed = splitFrontMatter(content);
  return !!parsed && /^due\s*:/m.test(parsed.yamlStr);
}

function buildCalendarBlock(repeating: boolean): string {
  const due = getCurrentDateStr();
  const start = getCurrentTimeStr();
  const lines = [
    `due: ${due}`,
    `start: "${start}"`,
    `duration: 1`,
  ];
  if (repeating) {
    lines.push(`rrule:`, `  freq: weekly`, `  interval: 1`, `  until: ${getUntilDateStr()}`);
  }
  return lines.join('\n');
}

/**
 * Extracts a simple scalar property value from front matter, or null if not present.
 * When stripQuotes is true, surrounding double quotes are removed (used for 'start').
 */
function getScalarProperty(content: string, key: string, stripQuotes = false): string | null {
  const parsed = splitFrontMatter(content);
  if (!parsed) return null;
  const pattern = stripQuotes ? `^${key}\\s*:\\s*"?(.+?)"?\\s*$` : `^${key}\\s*:\\s*(.+)$`;
  const match = parsed.yamlStr.match(new RegExp(pattern, 'm'));
  return match?.[1]?.trim() ?? null;
}

/** Extracts the 'due' property value from front matter, or null if not present. */
export function getDueProperty(content: string): string | null {
  return getScalarProperty(content, 'due');
}

/** Extracts the 'start' property value from front matter, or null if not present. */
export function getStartProperty(content: string): string | null {
  return getScalarProperty(content, 'start', true);
}

/** Extracts the 'duration' property value from front matter, or null if not present. */
export function getDurationProperty(content: string): string | null {
  return getScalarProperty(content, 'duration');
}

/** Sets or updates the `start` property in front matter. */
export function setStartProperty(content: string, startValue: string): string {
  return setFrontMatterProperty(content, 'start', startValue);
}

/**
 * Sets or updates the `duration` property in front matter. Numeric values are
 * stored as YAML numbers (matching the injected `duration: 1`) — dump() would
 * quote a numeric-looking string, and the regex-based getter would then return
 * the quote characters as part of the value.
 */
export function setDurationProperty(content: string, durationValue: string): string {
  const n = Number(durationValue);
  const value = durationValue.trim() !== '' && Number.isFinite(n) ? n : durationValue;
  return setFrontMatterProperty(content, 'duration', value);
}

/**
 * Sets or updates the 'due' property in front matter.
 * If no front matter exists, one is created. If 'due' already exists, it is replaced.
 * (The `M/D/YYYY` due format is never mistaken for a YAML date, so it stays a plain string.)
 */
export function setDueProperty(content: string, dueValue: string): string {
  return setFrontMatterProperty(content, 'due', dueValue);
}

/** Parse a `M/D/YYYY` (or `M/D/YY`) due string into a local Date, or null if invalid. */
export function parseDueStr(dueStr: string): Date | null {
  const parts = dueStr.trim().split('/');
  if (parts.length !== 3) return null;
  // Strict digits-only per part — also rejects empty parts like "/5/2025".
  if (!parts.every(p => /^\d+$/.test(p))) return null;
  const month = Number(parts[0]);
  const day = Number(parts[1]);
  let year = Number(parts[2]);
  if (year < 100) year += 2000;
  const d = new Date(year, month - 1, day);
  // Reject anything the Date constructor would have silently rolled over
  // (e.g. "2/30/2024" -> Mar 1, "13/1/2024" -> next Jan).
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/** Format a Date as `M/D/YYYY` (the on-disk due string format). */
export function formatDueDate(date: Date): string {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const y = date.getFullYear();
  return `${m}/${d}/${y}`;
}

export interface RRuleProps {
  freq?: string;
  interval?: string;
  byday?: string;
  until?: string;
  count?: string;
}

/** Parses the `rrule:` block from front matter and returns its fields, or null if absent. */
export function getRRuleProperty(content: string): RRuleProps | null {
  const parsed = splitFrontMatter(content);
  if (!parsed) return null;
  const match = parsed.yamlStr.match(/^rrule:\n((?:[ \t]+.+\n?)*)/m);
  if (!match) return null;
  const block = match[1] ?? '';
  const extract = (key: string) => {
    const m = block.match(new RegExp(`^[ \\t]+${key}\\s*:\\s*(.+)$`, 'm'));
    return m?.[1]?.trim();
  };
  return {
    freq: extract('freq'),
    interval: extract('interval'),
    byday: extract('byday'),
    until: extract('until'),
    count: extract('count'),
  };
}

function buildRRuleBlock(rrule: RRuleProps): string {
  const lines = ['rrule:'];
  if (rrule.freq) lines.push(`  freq: ${rrule.freq}`);
  if (rrule.interval && rrule.interval !== '1') lines.push(`  interval: ${rrule.interval}`);
  if (rrule.byday) lines.push(`  byday: ${rrule.byday}`);
  if (rrule.until) lines.push(`  until: ${rrule.until}`);
  if (rrule.count) lines.push(`  count: ${rrule.count}`);
  return lines.join('\n');
}

/**
 * Replaces or removes the `rrule:` block in front matter. Pass `null` (or an
 * object with no `freq`) to remove the block entirely. Creates front matter if
 * none exists and an rrule is being set.
 */
export function setRRuleProperty(content: string, rrule: RRuleProps | null): string {
  const parsed = splitFrontMatter(content);
  if (!parsed) {
    if (!rrule?.freq) return content;
    return `---\n${buildRRuleBlock(rrule)}\n---\n${content}`;
  }
  // Strip any existing rrule block (the `rrule:` line plus its indented children), then
  // drop trailing blank lines it left behind.
  const yaml = parsed.yamlStr.replace(/^rrule:\n(?:[ \t]+.+\n?)*/m, '').replace(/\n+$/, '');
  if (!rrule?.freq) {
    return `---\n${yaml}\n---\n${parsed.body}`;
  }
  const merged = yaml ? `${yaml}\n${buildRRuleBlock(rrule)}` : buildRRuleBlock(rrule);
  return `---\n${merged}\n---\n${parsed.body}`;
}

/**
 * Injects calendar front matter into the given markdown content.
 * Pass repeating=true to include the rrule block.
 * If there is already a front matter block, merges the calendar fields at the top.
 * If there is no front matter block, prepends one.
 * Returns the modified content.
 */
export function injectCalendarFrontMatter(content: string, repeating: boolean): string {
  const calendarBlock = buildCalendarBlock(repeating);
  const parsed = splitFrontMatter(content);

  if (parsed) {
    return `---\n${calendarBlock}\n${parsed.yamlStr}\n---\n${parsed.body}`;
  }

  return `---\n${calendarBlock}\n---\n${content}`;
}
