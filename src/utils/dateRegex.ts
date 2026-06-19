/**
 * Shared date regex — single source of truth for the date pattern.
 *
 * Defines the one accepted date shape used across the app, so the editor's
 * green date decoration and the timestamp parsers cannot drift apart. Mirrors
 * the convention established by `hashtagRegex.ts`.
 *
 * Accepted shape (validated, not just "digits and slashes"):
 *   - MM/DD/YYYY or MM/DD/YY, with month 01–12 and day 01–31 (leading zero
 *     optional), and a 2- or 4-digit year.
 *   - Optionally followed by a time: HH:MM AM/PM or HH:MM:SS AM/PM (seconds
 *     optional, hour 01–12). AM/PM is matched case-insensitively via the
 *     character class, so no `i` flag is needed.
 *   - Anchored with `\b` so it matches whole date tokens in free text rather
 *     than fragments embedded in larger words.
 *
 * Capture groups (consumed by the parsers in `timeUtil.ts`):
 *   1 = month, 2 = day, 3 = year, 4 = hour, 5 = minute, 6 = seconds, 7 = AM/PM
 *
 * This module is process-neutral (no Node.js or browser APIs) so it can be
 * imported from both main and renderer code.
 *
 * ⚠️  This exported instance is intentionally NOT global. Callers that need to
 * scan for every match (e.g. the editor decoration) must build their own
 * `g`-flagged instance from the source — `new RegExp(DATE_REGEX.source, 'g')` —
 * and, because the `g` flag makes `.exec()` stateful, must reset `lastIndex = 0`
 * before reusing a shared global instance in a loop.
 */
export const DATE_REGEX =
  /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(\d{4}|\d{2})(?:\s+(0?[1-9]|1[0-2]):([0-5]\d)(?::([0-5]\d))?\s*([AaPp][Mm]))?\b/;
