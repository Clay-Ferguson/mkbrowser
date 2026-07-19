import { DATE_REGEX } from '../shared/regexPatterns';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Whole-string variant of the shared date pattern, for parsing a string that is
// entirely a date/date-time value. Built once from the single source of truth.
const DATE_REGEX_ANCHORED = new RegExp(`^\\s*${DATE_REGEX.source}\\s*$`);

// Whole-string ISO 8601 date form: YYYY-MM-DD, optionally followed by a
// 24-hour HH:MM[:SS] time separated by 'T' or a space. Accepted only by
// parseDateString (front-matter values), NOT by the free-text DATE_REGEX
// convention: YAML front matter like `date: 2026-07-15` is the idiomatic
// place ISO dates appear, and js-yaml delivers them to us as plain strings.
// Timezone suffixes (Z / ±HH:MM) are not accepted — like every other date in
// the app, the value is interpreted as local time.
// Capture groups: 1=year, 2=month, 3=day, 4=hour, 5=minute, 6=seconds.
const ISO_DATE_REGEX_ANCHORED =
  /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?)?\s*$/;

/**
 * Sentinel returned by the date parsers when no valid date is found. NaN cannot
 * collide with any real `Date.getTime()` result (including 0 = 1970-01-01 UTC
 * and the negative values of pre-1970 dates), so callers must test for "found"
 * with `Number.isNaN(...)` rather than a `> 0` / `=== 0` comparison.
 */
export const NO_TIMESTAMP = Number.NaN;

/**
 * Builds a timestamp from calendar components (month is 1-based), validating
 * that the calendar date actually exists.
 *
 * The regexes cap day at 31 but are not month-aware, so impossible dates like
 * `02/31/2025` match. `new Date(...)` silently rolls those over (Feb 31 → Mar 3),
 * which would produce a confident but wrong result. After constructing the Date
 * we verify the month and day survived round-trip; if not, the date is impossible
 * and we return NO_TIMESTAMP.
 *
 * ⚠️ Legacy Date-constructor pitfall: `new Date(y, ...)` maps a year in 0–99 to
 * 1900+y instead of the literal year. Years that small can reach us from ISO
 * strings like `0099-12-31` (the ISO regex accepts any \d{4} year), so after
 * construction we restore the real year with setFullYear — otherwise we'd
 * silently return a 19xx timestamp while the month/day round-trip check passes
 * (only the year is wrong, and the check doesn't look at the year).
 * setFullYear is applied *after* the constructor may have rolled an impossible
 * month/day forward, which is safe: rolling changes month/day, so the round-trip
 * check below still rejects those inputs.
 */
function validatedTimestamp(
  year: number, month: number, day: number,
  hours: number, minutes: number, seconds: number,
): number {
  const date = new Date(year, month - 1, day, hours, minutes, seconds);
  if (year >= 0 && year < 100) {
    date.setFullYear(year);
  }
  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    return NO_TIMESTAMP;
  }
  return date.getTime();
}

/**
 * Converts a DATE_REGEX match into a timestamp via validatedTimestamp.
 *
 * Capture groups (see dateRegex.ts): 1=month, 2=day, 3=year, 4=hour, 5=minute,
 * 6=seconds, 7=AM/PM. Two-digit years are interpreted as 2000+YY.
 */
function timestampFromMatch(match: RegExpMatchArray): number {
  const month = parseInt(match[1] ?? '', 10);
  const day = parseInt(match[2] ?? '', 10);
  let year = parseInt(match[3] ?? '', 10);

  // Convert 2-digit year to 4-digit (assumes 2000s). This must key off the
  // *digit count*, not the numeric value: DATE_REGEX's year group is
  // (\d{4}|\d{2}), so a 4-digit year like "0026" also parses to a value < 100,
  // but it names the literal year 26 and must not be bumped to 2026 (a value
  // check would turn "07/18/0026" into 2026). Years below 100 that survive
  // un-bumped are handled by validatedTimestamp's setFullYear correction for
  // the Date constructor's 1900+y mapping.
  if ((match[3] ?? '').length === 2) {
    year += 2000;
  }

  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (match[4]) {
    // Time part exists
    hours = parseInt(match[4], 10);
    minutes = parseInt(match[5] ?? '', 10);
    seconds = match[6] ? parseInt(match[6], 10) : 0; // Default to 0 if seconds not provided
    const ampm = match[7]?.toUpperCase();

    // Convert to 24-hour format
    if (ampm === 'PM' && hours !== 12) {
      hours += 12;
    } else if (ampm === 'AM' && hours === 12) {
      hours = 0;
    }
  }

  return validatedTimestamp(year, month, day, hours, minutes, seconds);
}

/**
 * Detects timestamps in MM/DD/YYYY, MM/DD/YY, or with HH:MM:SS AM/PM or HH:MM AM/PM format
 * Two-digit years are interpreted as 2000+YY (e.g., "26" becomes "2026")
 * Returns the timestamp in milliseconds, or NO_TIMESTAMP (NaN) if not found
 *
 * @param content - The text content to search for timestamps
 * @returns Timestamp in milliseconds since epoch, or NO_TIMESTAMP if not found
 */
export function extractTimestamp(content: string): number {
  // Find the first date in the content using the shared pattern (see dateRegex.ts).
  // DATE_REGEX is non-global, so .match() returns the first match with groups.
  const match = content.match(DATE_REGEX);
  if (!match) return NO_TIMESTAMP;
  return timestampFromMatch(match);
}

/**
 * Checks if a timestamp (in milliseconds) represents a time in the past
 * 
 * @param timestamp - The timestamp in milliseconds since epoch (NO_TIMESTAMP/NaN is treated as invalid)
 * @param lookbackDays - Optional number of days to look back from now
 * @returns True if the timestamp is in the past (and within lookbackDays, if provided), false otherwise
 */
export function past(timestamp: number, lookbackDays?: number): boolean {
  // NaN means "no date found" (see NO_TIMESTAMP)
  if (Number.isNaN(timestamp)) {
    return false;
  }
  
  const now = Date.now();
  if (lookbackDays === undefined) {
    return timestamp < now;
  }

  const maxLookbackMs = lookbackDays * MS_PER_DAY;
  const cutoff = now - maxLookbackMs;
  return timestamp < now && timestamp >= cutoff;
}

/**
 * Checks if a timestamp (in milliseconds) represents a time in the future
 * 
 * @param timestamp - The timestamp in milliseconds since epoch (NO_TIMESTAMP/NaN is treated as invalid)
 * @param lookaheadDays - Optional number of days to look ahead from now
 * @returns True if the timestamp is in the future (and within lookaheadDays, if provided), false otherwise
 */
export function future(timestamp: number, lookaheadDays?: number): boolean {
  // NaN means "no date found" (see NO_TIMESTAMP)
  if (Number.isNaN(timestamp)) {
    return false;
  }
  
  const now = Date.now();
  if (lookaheadDays === undefined) {
    return timestamp > now;
  }

  const maxLookaheadMs = lookaheadDays * MS_PER_DAY;
  const cutoff = now + maxLookaheadMs;
  return timestamp > now && timestamp <= cutoff;
}

/**
 * Checks if a timestamp (in milliseconds) represents today's date
 * 
 * @param timestamp - The timestamp in milliseconds since epoch (NO_TIMESTAMP/NaN is treated as invalid)
 * @returns True if the timestamp's date matches today's date, false otherwise
 */
export function today(timestamp: number): boolean {
  // NaN means "no date found" (see NO_TIMESTAMP)
  if (Number.isNaN(timestamp)) {
    return false;
  }
  
  const now = new Date();
  const checkDate = new Date(timestamp);
  
  return (
    now.getFullYear() === checkDate.getFullYear() &&
    now.getMonth() === checkDate.getMonth() &&
    now.getDate() === checkDate.getDate()
  );
}

/**
 * Parses a string that is entirely a date or date-time value.
 * Accepts the app's MM/DD/YYYY or MM/DD/YY convention (optional HH:MM[:SS]
 * AM/PM), and additionally the ISO 8601 form YYYY-MM-DD (optional 24-hour
 * HH:MM[:SS], separated by 'T' or a space) since that is the idiomatic way to
 * write dates in YAML front matter — the main consumer of this function via
 * the advanced-search `prop(path, 'ts')` helper. All values are interpreted
 * as local time. Returns milliseconds since epoch, or NO_TIMESTAMP (NaN) if
 * the string cannot be parsed or names an impossible calendar date.
 */
export function parseDateString(value: string): number {
  const match = value.match(DATE_REGEX_ANCHORED);
  if (match) return timestampFromMatch(match);

  const iso = value.match(ISO_DATE_REGEX_ANCHORED);
  if (!iso) return NO_TIMESTAMP;
  return validatedTimestamp(
    parseInt(iso[1] ?? '', 10), parseInt(iso[2] ?? '', 10), parseInt(iso[3] ?? '', 10),
    iso[4] ? parseInt(iso[4], 10) : 0,
    iso[5] ? parseInt(iso[5], 10) : 0,
    iso[6] ? parseInt(iso[6], 10) : 0,
  );
}

/** Returns today's date formatted as `MM/DD/YY` (two-digit year). */
export function formatDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

/**
 * Calculate the number of days between a timestamp and today.
 * Negative = past, positive = future, 0 = today.
 */
export function getDaysFromToday(timestamp: number): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(timestamp);
  targetDate.setHours(0, 0, 0, 0);
  const diffMs = targetDate.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Format a days-from-today value as a human-readable string.
 * Examples: "(today)", "-(3 days)", "+(1y 2m 5d)".
 */
export function formatDaysDisplay(days: number): string {
  if (days === 0) return '(today)';

  const absDays = Math.abs(days);
  const sign = days < 0 ? '-' : '+';

  // For small values (< 31 days), just show days
  if (absDays < 31) {
    return `${sign}(${absDays} day${absDays !== 1 ? 's' : ''})`;
  }

  // Calculate years, months, and remaining days
  const years = Math.floor(absDays / 365);
  const remainingAfterYears = absDays % 365;
  const months = Math.floor(remainingAfterYears / 30);
  const remainingDays = remainingAfterYears % 30;

  // Build the display string, omitting zero values
  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (months > 0) parts.push(`${months}m`);
  if (remainingDays > 0) parts.push(`${remainingDays}d`);

  return `${sign}(${parts.join(' ')})`;
}

/** Generates a folder name from the current date/time in `YYYY-MM-DD--HH-MM-SS-AM/PM` format. */
export function generateTimestampFolderName(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const hours24 = now.getHours();
  const hours12 = hours24 % 12 || 12;
  const ampm = hours24 < 12 ? 'AM' : 'PM';
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}--${pad(hours12)}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${ampm}`;
}

/** Generates a markdown filename from the current date/time in `YYYY-MM-DD--HH-MM-SS-AM/PM.md` format. */
export function generateTimestampFileName(): string {
  return `${generateTimestampFolderName()}.md`;
}

// Matches filenames produced by generateTimestampFileName() (the
// YYYY-MM-DD--HH-MM-SS-AM/PM.md convention). Kept next to the generator so the
// two stay in sync.
export const TIMESTAMP_FILENAME_RE = /^\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2}-(AM|PM)\.md$/;

/** Returns the current date/time formatted as `MM/DD/YY HH:MM AM/PM`. */
export function formatTimestamp(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  let hours = now.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hoursStr = String(hours).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${month}/${day}/${year} ${hoursStr}:${minutes} ${ampm}`;
}

