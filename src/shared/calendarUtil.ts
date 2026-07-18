/**
 * Utilities for turning a markdown file into a calendar item via front matter injection.
 */

import { dump } from 'js-yaml';
import { splitFrontMatter, setFrontMatterProperty, assembleFrontMatter } from '../shared/frontMatterUtil';
import { loadYaml } from '../shared/yamlUtil';

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
 * True if the raw front matter YAML declares `key` at the top level (not nested/indented).
 *
 * Parses the YAML rather than pattern-matching the text, so non-block spellings the regex
 * missed — a quoted key (`"due": …`) or a flow-style mapping — are still detected. Missing
 * a real top-level key here is what let {@link injectCalendarFrontMatter} prepend a second
 * copy and poison the file with a duplicate mapping key. Only genuinely unparseable YAML
 * (or a non-mapping top level) falls back to the textual check, preserving prior behavior.
 */
function hasTopLevelKey(yamlStr: string, key: string): boolean {
  try {
    const parsed = loadYaml(yamlStr);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.prototype.hasOwnProperty.call(parsed, key);
    }
  } catch {
    // Malformed YAML — fall back to a textual check so behavior is unchanged.
  }
  return new RegExp(`^${key}[ \\t]*:`, 'm').test(yamlStr);
}

/**
 * Checks whether the given markdown content already has a 'due' property in front matter.
 */
export function hasDueProperty(content: string): boolean {
  const parsed = splitFrontMatter(content);
  return !!parsed && hasTopLevelKey(parsed.yamlStr, 'due');
}

/**
 * Builds the calendar lines to prepend, omitting any key already present in `existingYaml`.
 * Prepending a key that already exists would produce a duplicate mapping key, which js-yaml
 * rejects — permanently breaking every front matter read for that file. Existing values win.
 */
function buildCalendarBlock(repeating: boolean, existingYaml = ''): string {
  const lines: string[] = [];
  if (!hasTopLevelKey(existingYaml, 'due')) lines.push(`due: ${getCurrentDateStr()}`);
  if (!hasTopLevelKey(existingYaml, 'start')) lines.push(`start: "${getCurrentTimeStr()}"`);
  if (!hasTopLevelKey(existingYaml, 'duration')) lines.push(`duration: 1`);
  if (repeating && !hasTopLevelKey(existingYaml, 'rrule')) {
    lines.push(`rrule:`, `  freq: weekly`, `  interval: 1`, `  until: ${getUntilDateStr()}`);
  }
  return lines.join('\n');
}

/**
 * Extracts a simple scalar property value from front matter, or null if not present.
 *
 * The YAML is parsed for real (same approach as {@link hasTopLevelKey}) rather than
 * regex-scanned. The old `^key\s*:\s*(.+)$` pattern had two provable failure modes:
 *  1. `\s` matches newlines, so an explicitly empty key (`due:` — a legal YAML null)
 *     let `\s*` cross the line break and capture the entire NEXT line as the value
 *     (getDueProperty returned `start: "9:00 AM"`).
 *  2. YAML quoting leaked into the value: `due: "3/5/2026"` came back with the quote
 *     characters, which parseDueStr then rejected — silently dropping a due date that
 *     the calendar loader (which parses YAML properly) accepts fine. Trailing same-line
 *     comments leaked the same way.
 * The regex survives only as a fallback for malformed YAML, and uses `[ \t]*` — never
 * `\s*`, which is how failure (1) got in — so it cannot cross a line boundary.
 * `stripQuotes` applies only to that fallback; the parsed path never sees quotes.
 */
function getScalarProperty(content: string, key: string, stripQuotes = false): string | null {
  const parsed = splitFrontMatter(content);
  if (!parsed) return null;
  try {
    const obj = loadYaml(parsed.yamlStr);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      // Nullish, non-scalar, and empty values all read as "not present".
      return scalarFieldToString((obj as Record<string, unknown>)[key]) || null;
    }
  } catch {
    // Malformed YAML — fall back to the textual scan so behavior is unchanged.
  }
  const pattern = stripQuotes ? `^${key}[ \\t]*:[ \\t]*"?(.+?)"?[ \\t]*$` : `^${key}[ \\t]*:[ \\t]*(.+)$`;
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

/**
 * Build a local-midnight Date from calendar parts, or null if they don't form a real
 * date — i.e. the Date constructor would have silently rolled them over (e.g.
 * "2/30/2024" -> Mar 1, "13/1/2024" -> next Jan).
 */
function buildLocalDate(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/**
 * Parse a due-date string into a local Date, or null if invalid. Accepts the app's
 * canonical `M/D/YYYY` (or `M/D/YY`) form and the ISO `YYYY-MM-DD` form that js-yaml
 * and many other tools emit for a bare `due: 2025-03-05` — interpreted as a local
 * calendar date, not UTC. Without ISO support such an event was dropped silently.
 */
export function parseDueStr(dueStr: string): Date | null {
  const trimmed = dueStr.trim();

  // ISO calendar date (YYYY-MM-DD) — the most common front-matter spelling.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) return buildLocalDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const parts = trimmed.split('/');
  if (parts.length !== 3) return null;
  // Strict digits-only per part — also rejects empty parts like "/5/2025".
  if (!parts.every(p => /^\d+$/.test(p))) return null;
  const month = Number(parts[0]);
  const day = Number(parts[1]);
  let year = Number(parts[2]);
  if (year < 100) year += 2000;
  return buildLocalDate(year, month, day);
}

/**
 * Coerce a raw front-matter `due` value into a local Date, or null if missing/unusable.
 *
 * The value arrives from the YAML parser typed as `unknown`. Normally it is a string
 * (js-yaml 5 dropped the timestamp tag, so even `due: 2025-03-05` stays a string,
 * handled by parseDueStr). A Date instance is accepted defensively for any parser or
 * caller that does resolve a YAML timestamp: its UTC calendar parts — the frame the
 * YAML date spec uses — are read so the result lands on the day the user wrote,
 * without a timezone-offset shift.
 */
export function coerceDueDate(due: unknown): Date | null {
  if (due instanceof Date) {
    if (Number.isNaN(due.getTime())) return null;
    return buildLocalDate(due.getUTCFullYear(), due.getUTCMonth() + 1, due.getUTCDate());
  }
  if (typeof due === 'string') return parseDueStr(due);
  return null;
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

/**
 * Render a parsed YAML scalar back to the string form the UI/editor expects.
 * Shared by the rrule getter and {@link getScalarProperty} so a value reads back
 * identically whether it lives at the top level or nested under `rrule:`.
 * Non-scalars (mappings/sequences) and nullish values render as undefined.
 */
function scalarFieldToString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    // A YAML timestamp (e.g. `until: 2027-12-31`) resolves to UTC midnight; render it in
    // the app's M/D/YYYY form from its UTC parts so the day the user wrote is preserved.
    return `${value.getUTCMonth() + 1}/${value.getUTCDate()}/${value.getUTCFullYear()}`;
  }
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** Parses the `rrule:` block from front matter and returns its fields, or null if absent. */
export function getRRuleProperty(content: string): RRuleProps | null {
  const parsed = splitFrontMatter(content);
  if (!parsed) return null;
  let obj: unknown;
  try {
    obj = loadYaml(parsed.yamlStr);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const rrule = (obj as Record<string, unknown>).rrule;
  if (!rrule || typeof rrule !== 'object' || Array.isArray(rrule)) return null;
  const r = rrule as Record<string, unknown>;
  return {
    freq: scalarFieldToString(r.freq),
    interval: scalarFieldToString(r.interval),
    byday: scalarFieldToString(r.byday),
    until: scalarFieldToString(r.until),
    count: scalarFieldToString(r.count),
  };
}

/** Coerce a numeric-looking string to a YAML number, else leave it a string. */
function numericOrString(value: string): number | string {
  const n = Number(value);
  return value.trim() !== '' && Number.isFinite(n) ? n : value;
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
 * Build the nested mapping written under `rrule:`. Interval/count are stored as YAML numbers
 * (matching the injected `interval: 1` style) so the getter reads them back without quotes.
 */
function buildRRuleObject(rrule: RRuleProps): Record<string, unknown> {
  const obj: Record<string, unknown> = { freq: rrule.freq };
  if (rrule.interval && rrule.interval !== '1') obj.interval = numericOrString(rrule.interval);
  if (rrule.byday) obj.byday = rrule.byday;
  if (rrule.until) obj.until = rrule.until;
  if (rrule.count) obj.count = numericOrString(rrule.count);
  return obj;
}

/**
 * Replaces or removes the `rrule:` block in front matter. Pass `null` (or an
 * object with no `freq`) to remove the block entirely. Creates front matter if
 * none exists and an rrule is being set.
 *
 * Edits go through a real YAML parse/dump (like {@link setFrontMatterProperty}) rather than
 * a text strip-and-append: a flow-style `rrule: {…}` the old strip regex couldn't see used
 * to survive and get a second `rrule:` appended below it, producing a duplicate mapping key
 * that makes every subsequent front-matter parse throw. Unparseable existing YAML is left
 * untouched rather than risking further corruption.
 */
export function setRRuleProperty(content: string, rrule: RRuleProps | null): string {
  const parsed = splitFrontMatter(content);
  if (!parsed) {
    if (!rrule?.freq) return content;
    return `---\n${buildRRuleBlock(rrule)}\n---\n${content}`;
  }
  let obj: unknown;
  try {
    obj = loadYaml(parsed.yamlStr) ?? {};
  } catch {
    return content;
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return content;
  const yaml = obj as Record<string, unknown>;
  if (!rrule?.freq) {
    // Nothing to remove — return the content untouched (and unreformatted).
    if (!Object.prototype.hasOwnProperty.call(yaml, 'rrule')) return content;
    delete yaml.rrule;
  } else {
    yaml.rrule = buildRRuleObject(rrule);
  }
  // An empty mapping (rrule was the only key, now removed) yields '' so assembleFrontMatter
  // drops the fences entirely rather than leaving `---\n{}\n---` behind.
  const dumped = Object.keys(yaml).length ? dump(yaml, { lineWidth: -1 }) : '';
  return assembleFrontMatter(dumped, parsed.body);
}

/**
 * Injects calendar front matter into the given markdown content.
 * Pass repeating=true to include the rrule block.
 * If there is already a front matter block, merges the calendar fields at the top,
 * keeping any of `due`/`start`/`duration`/`rrule` the file already defines rather than
 * duplicating the key. If there is no front matter block, prepends one.
 * Returns the modified content — unchanged if every calendar field is already present,
 * or if the existing front matter is malformed or non-mapping YAML that cannot be
 * merged into without corrupting it (see the validation notes in the body).
 */
export function injectCalendarFrontMatter(content: string, repeating: boolean): string {
  const parsed = splitFrontMatter(content);

  if (!parsed) {
    return `---\n${buildCalendarBlock(repeating)}\n---\n${content}`;
  }

  const calendarBlock = buildCalendarBlock(repeating, parsed.yamlStr);
  if (!calendarBlock) return content;

  // The merge works by text-prepending block-mapping lines above the existing YAML,
  // which preserves the user's formatting — but it is only valid YAML if the existing
  // top level is itself a block mapping (or empty). Against a flow-style mapping
  // (`{title: Hello}`), a sequence, or a scalar, the concatenation does not parse, and
  // writing it would poison every subsequent front matter read of the file. So the
  // merged text is validated with a real parse before it is returned — never trust a
  // textual YAML edit without re-parsing the result.
  const existing = parsed.yamlStr.trim();
  const merged = existing ? `${calendarBlock}\n${existing}` : calendarBlock;
  try {
    loadYaml(merged);
    return `---\n${merged}\n---\n${parsed.body}`;
  } catch {
    // Fall through to the re-dump path below.
  }

  // The concatenation didn't parse. If the existing YAML alone is a valid mapping
  // (e.g. flow style), re-serialize it in block form — losing hand formatting, which
  // is accepted app-wide for YAML edits — and prepend to that instead. Otherwise
  // (malformed YAML, or a top-level sequence/scalar we can't merge into) return the
  // content untouched rather than risk corrupting it further, matching the refusal
  // behavior of setFrontMatterProperty and setRRuleProperty.
  try {
    const obj = loadYaml(parsed.yamlStr);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const redumped = dump(obj, { lineWidth: -1 }).trim();
      return `---\n${calendarBlock}\n${redumped}\n---\n${parsed.body}`;
    }
  } catch {
    // Existing YAML is malformed — nothing safe to merge into.
  }
  return content;
}
