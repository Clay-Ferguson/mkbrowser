# Task: Fix the incorrect doc comment on `CalendarEventResult.end`

## Context
- File: `src/utils/calendar/calendarLoader.ts`
- Interface: `CalendarEventResult`

## Problem
The `end` field is documented as:
```ts
/** Same as start — all calendar items are all-day events */
end: number;
```
This is **false**. The same file fully supports **timed** events: when a `start:` time and
`duration:` are present, `loadCalendarEntryForFile` computes
`durationMs = (duration ?? 1) * 60 * 60 * 1000` and `endMs = startMs + durationMs`, and
`expandRRule` sets `occEnd = occStart + durationMs` for non-all-day occurrences. So `end` is
frequently **not** equal to `start`.

The comment on `start` ("start of day") is likewise only true for the all-day case.

## Why it matters
A stale doc comment that directly contradicts the code is actively misleading — a future
maintainer (or your future self) may rely on the "all-day only" invariant and introduce a bug
(e.g. ignoring `end`, or assuming `start === end`).

## Proposed solution
Update the comments to reflect reality, e.g.:
```ts
/** Milliseconds since epoch for the event start. All-day items use local start-of-day. */
start: number;
/** Milliseconds since epoch for the event end. Equals `start` for all-day items;
 *  otherwise `start + duration`. */
end: number;
```

## Verification
- Comments match the behavior in `loadCalendarEntryForFile` and `expandRRule`.
