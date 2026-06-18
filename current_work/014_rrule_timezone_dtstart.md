# Task: Audit RRule date handling for the local-time vs UTC footgun

## Context
- File: `src/utils/calendar/calendarLoader.ts`
- Function: `expandRRule`

## Problem (medium confidence — needs verification with a test)
`expandRRule` builds the rule with a **local-time** `dtstart`:
```ts
dtstart: isAllDay ? dueDate : new Date(startMs),
```
where `dueDate = new Date(year, month - 1, day)` (local midnight). The `rrule` library is
well known for treating the date components of `dtstart`/`until` as **UTC** internally and
returning occurrence `Date`s whose **UTC** components carry the intended wall-clock values.

When the code then reads occurrences back with **local** accessors:
```ts
new Date(occurrenceDate.getFullYear(), occurrenceDate.getMonth(), occurrenceDate.getDate())
```
the mismatch between "RRule thinks in UTC" and "we constructed dtstart in local time and read it
back in local time" can cause **off-by-one-day** errors for users in non-UTC timezones,
especially around DST boundaries. The `until` value (also parsed as a local-midnight `Date`) is
likewise compared inside RRule's UTC world and may include/exclude the final occurrence
incorrectly.

## Why it matters
A recurring task that should land on, say, every Monday could appear on Sunday or Tuesday for
users west/east of UTC, or the series could start/end a day early/late. These are the classic,
hard-to-spot RRule timezone bugs.

## Proposed solution
1. Write tests that pin behavior across at least one negative-offset and one positive-offset
   timezone (set `TZ` env in the test, or use a fixed offset) for: all-day weekly, all-day with
   `until`, and a timed event.
2. If off-by-one is confirmed, adopt the documented RRule pattern: construct `dtstart`/`until`
   using `Date.UTC(...)` and read occurrences back via the UTC accessors (`getUTCFullYear`,
   `getUTCMonth`, `getUTCDate`, etc.), OR use rrule's recommended local-time handling helpers.
   Be consistent: whatever timezone basis is used to build the rule must be used to read it back.

## Verification
- Recurring all-day and timed events land on the same calendar day regardless of the machine's
  timezone (test with `TZ=America/Chicago` and `TZ=Asia/Tokyo`, etc.).
- `until` includes/excludes the boundary occurrence consistently.
