# Task: Use one consistent on-disk date format (`M/D/YYYY` vs `M/D/YY`)

## Context
- File: `src/utils/calendar/calendarUtil.ts`
- Functions: `getCurrentDateStr`, `getUntilDateStr` (write 2-digit year), `formatDueDate`
  (writes 4-digit year)

## Problem
The module writes due/until dates to disk in **two different year formats**:
- `getCurrentDateStr()` → `${month}/${day}/${YY}` (2-digit year, e.g. `6/18/26`).
- `getUntilDateStr()` → `12/31/${YY}` (2-digit year).
- `formatDueDate(date)` → `${m}/${d}/${YYYY}` (4-digit year, e.g. `6/18/2026`).

So the *initial* injected block uses 2-digit years, but when a date is later edited/formatted via
`formatDueDate` it becomes a 4-digit year. The reader (`parseDueStr`/`parseDueDate`) tolerates
both (`year < 100 ? += 2000`), so nothing breaks functionally — but the same file can end up with
mixed formats, and the on-disk representation is inconsistent and surprising to users who read the
raw markdown.

## Why it matters
Inconsistent serialized formats are a smell: they look like a bug to anyone reading the file, make
diffs noisier, and the 2-digit year is genuinely ambiguous/lossy. Picking one format removes a
class of "why does this date look different now?" confusion.

## Proposed solution
Standardize on **4-digit years** everywhere written to disk (recommended — unambiguous and
matches `formatDueDate`):
- Change `getCurrentDateStr` to emit `now.getFullYear()` (full year).
- Change `getUntilDateStr` to emit the full `year` (it already computes `getFullYear() + 2`; drop
  the `.slice(-2)`).
- Keep the reader's `year < 100` handling for backward compatibility with already-written files.

## Verification
- Newly injected calendar blocks and edited dates all use 4-digit years.
- Existing files with 2-digit years still parse correctly.
