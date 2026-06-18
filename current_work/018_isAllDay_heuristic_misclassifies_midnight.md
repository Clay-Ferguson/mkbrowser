# Task: Make all-day vs timed detection explicit instead of inferring from midnight

## Context
- File: `src/utils/calendar/calendarLoader.ts`
- Functions: `loadCalendarEntryForFile`, `expandRRule`

## Problem
Whether an event is "all-day" is **inferred** rather than stated:
```ts
const isAllDay = startMs === dueDate.getTime() && endMs === dueDate.getTime();
```
`startMs`/`endMs` only diverge from `dueDate.getTime()` when a `start:` time successfully parses.
So an event whose `start:` is exactly midnight — e.g. `start: "12:00 AM"` — produces
`time = { hours: 0, minutes: 0 }`, `startDate.setHours(0,0,0,0)` equals `dueDate`, and the event
is **misclassified as all-day**. Its `duration` is then ignored (because the all-day branch sets
`occEnd = occStart`), so a genuine midnight-to-1am timed event silently loses its time/duration.

The same heuristic is recomputed implicitly inside `expandRRule`.

## Why it matters
A legitimate timed event at midnight is silently downgraded to all-day, dropping its duration.
It's an edge case, but it's a real correctness bug driven entirely by inferring intent from a
coincidental value instead of tracking it explicitly.

## Proposed solution
Track all-day-ness explicitly as a boolean derived from **whether a valid `start:` time was
present**, not from comparing milliseconds:
```ts
let isAllDay = true;
if (startTimeStr) {
  const time = parseStartTime(startTimeStr);
  if (time) {
    isAllDay = false;
    // ...compute startMs/endMs/durationMs...
  }
}
```
Pass this `isAllDay` flag into `expandRRule` instead of having it re-derive the value from the
millisecond comparison. This removes the midnight ambiguity entirely.

## Verification
- An event with `start: "12:00 AM"` and `duration: 1` is treated as a timed 1-hour event
  (00:00–01:00), not all-day.
- Events with no `start:` remain all-day.
