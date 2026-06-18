# Task: Reject out-of-range dates in `parseDueDate` / `parseDueStr` (silent rollover bug)

## Context
- File: `src/utils/calendar/calendarLoader.ts` — `parseDueDate`
- File: `src/utils/calendar/calendarUtil.ts` — `parseDueStr`

## Problem
Both date parsers split an `M/D/YYYY` string, convert the parts to numbers, and construct
`new Date(year, month - 1, day)`. They only reject the result if `Number.isNaN(d.getTime())`.

The JavaScript `Date` constructor **does not reject** out-of-range components — it silently
**rolls them over**:
- `new Date(2024, 1, 30)` (i.e. `"2/30/2024"`) → **March 1, 2024**.
- `new Date(2024, 12, 1)` (i.e. `"13/1/2024"`) → **January 1, 2025**.
- `"2/31/2025"` → March 3, 2025.

`d.getTime()` is a perfectly valid number in all these cases, so the guard never trips. A
user who typos a due date gets a **silently wrong** calendar entry on a different day, with no
error and no indication anything went wrong.

Additionally, `parseDueDate` uses `parts.map(Number)` and then `isNaN(...)`. `Number('')` is
`0` (not `NaN`), so an empty component like `"/5/2025"` yields month `0` rather than being
rejected.

## Why it matters
The whole point of a calendar is that items land on the correct day. Silent date rollover
turns a small typo into a wrong-day event the user may never notice. This is a correctness
bug, and it is duplicated in two places.

## Proposed solution
After parsing, validate the components round-trip:
```ts
if (month < 1 || month > 12 || day < 1 || day > 31) return null;
const d = new Date(year, month - 1, day);
if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
```
This rejects any input the Date constructor would have rolled over. Apply the same fix to both
functions (ideally via the shared parser proposed in `004_*`). Replace `isNaN` checks with
explicit `Number.isNaN` on individually-parsed integers, and reject empty/`NaN` parts.

## Verification
- `"2/30/2024"`, `"13/1/2024"`, `"0/5/2025"`, `"/5/2025"`, `"1/0/2025"` all return `null`/`undefined`.
- Valid dates (`"6/18/2026"`, `"12/31/26"`) still parse correctly.
