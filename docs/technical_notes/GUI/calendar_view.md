# Calendar View — Technical Notes

## Overview

The Calendar View is a top-level application tab that renders Markdown files carrying
Front Matter YAML calendar metadata using the `react-big-calendar` library. It supports
month, week, work-week, day, and agenda display modes, and click-to-navigate integration
with BrowseView.

There are **two ways to populate it** (see [Event Sources](#event-sources)): a recursive
scan of the folder being browsed, or the calendar-file subset of the current search
results. Both fill the same `calendarEvents` list — `CalendarView.tsx` is a pure renderer
of store state and does not know or care which source ran.

## Event Sources

The store records provenance in a single discriminated union, `CalendarSource`
(`src/shared/types.ts`):

```ts
export type CalendarSource =
  | { kind: 'folder'; folder: string }
  | { kind: 'search'; folder: string; query: string; name: string; totalResults: number };
```

There is one Calendar tab; opening either source replaces whatever it was showing.

### Folder source — live

The calendar icon in the BrowseView toolbar (`data-testid="calendar-button"`) →
`handleShowCalendar()` in `src/components/views/BrowseView.tsx`. It switches to the tab
immediately (so the spinner is visible), records
`setCalendarSource({ kind: 'folder', folder: currentPath })`, and calls
`api.loadCalendarEvents(currentPath)`. **Every click re-scans** and re-arms the watcher.

The folder path is snapshotted at click time and tracked independently of `currentPath`,
so the calendar stays stable while the user browses elsewhere.

### Search source — snapshot

The **Calendar** button in the SearchResultsView header
(`data-testid="search-calendar-view-button"`), sitting beside the Graph button —
the two are parallel affordances offering alternate renderings of one result set (see
`folder_graph.md`). `handleShowCalendar()` in
`src/components/views/SearchResultsView.tsx` records the `search` source and calls
`api.loadCalendarEventsForFiles(searchResults.map(r => r.path))`.

Search results are an arbitrary set of absolute paths spanning many folders, so there is
no folder to crawl and nothing coherent to watch. Consequently:

- The IPC handler **stops the chokidar watcher** before loading. Without this, the watcher
  would remain armed on whatever folder was scanned last and stream changes for files that
  are not in the search results into a list that is supposed to *be* the search results.
- `updateCalendarEvent` and `deleteCalendarEventsUnderPath` (`src/store/calendar.ts`)
  additionally **early-return unless `calendarSource.kind === 'folder'`**, so a watcher
  event already in flight when the source switched cannot edit a search-sourced calendar.
- The result is a snapshot. To refresh it, press the button again.

Results that are not calendar files are silently dropped, so the count usually differs
from the search's result count; the header states both (*"12 of 340 results are calendar
items"*), and a zero count renders an explicit hint rather than a bare empty month grid.

## Calendar Entry Format

A Markdown file becomes a calendar entry if its Front Matter YAML contains a parseable
`due` property. `parseDueStr` accepts `M/D/YYYY`, `M/D/YY`, and ISO `YYYY-MM-DD`. Two
optional properties control time-of-day display:

```yaml
---
due: 05/20/2026
start: 2:00 PM      # optional — 12-hour ("1:30 PM") or 24-hour ("13:30"), no seconds
duration: 1.5       # optional — hours (decimal allowed)
---
```

If `start` is absent the entry is an all-day event (`start === end === local midnight of
due`). If `duration` is absent but `start` is present, one hour is assumed. A missing or
explicitly empty `due:` means "not a calendar file" and is skipped **quietly**; a `due`
that is present but unparseable is logged as a warning, since that is a likely user
mistake.

### "Is this a calendar file?" — one rule, two callers

`isCalendarFrontMatter(parsed)` in `src/shared/calendarUtil.ts` is the boolean form of
the admission rule above (`due` present, non-null, and accepted by `coerceDueDate`). It
exists for callers that need the yes/no answer without the parsing, warning, and
recurrence expansion `loadCalendarEntryForFile` does.

Its one caller today is the Search dialog's **Calendar Items** checkbox
(`src/main/search.ts`): when checked, the crawl admits only `.md` files and a pre-pass
(`filterCalendarFiles`) drops everything the predicate rejects before the query, the
`searchImageExif` widening, and the Recent Files trim are applied. The pre-pass runs
*before* the trim deliberately — the other order would return the calendar subset of the
500 newest files, which is usually empty in a large tree. It reads each `.md` once,
caching the parsed front matter in the search's `YamlCache` (so an advanced query's
`prop()` doesn't re-parse) and its stat times (so matched files aren't stat'd twice).
The option is content-search only; `searchFolder` ignores it in `filenames` mode and the
dialog disables the checkbox there. Both the flag and its persisted
`SearchDefinition.calendarItemsOnly` counterpart default to `false` when absent.

Because both paths bottom out in `coerceDueDate`, a file that the Calendar view shows can
never be one the calendar-only search skips. `tests/calendar.test.ts` asserts that
agreement case by case.

### Recurring Events

Add an `rrule:` block to make an entry repeat. The property names mirror the iCal
RFC 5545 `RRULE` field names:

```yaml
---
due: 05/20/2026        # first occurrence / recurrence start
start: 10:00 AM        # optional — applies to every occurrence
duration: 1            # optional hours
rrule:
  freq: weekly         # daily | weekly | monthly | yearly
  interval: 2          # every N freq-units (default: 1)
  byday: MO,WE,FR      # iCal day codes — MO TU WE TH FR SA SU (weekly only)
  until: 12/31/2026    # recurrence end date (inclusive; exclusive with count)
  count: 10            # max number of occurrences (exclusive with until)
---
```

Each occurrence is expanded into a separate calendar entry before being handed to
`react-big-calendar` (which has no built-in recurring-event support), via the `rrule` npm
package. All occurrences share the same source file path but get distinct ids
(`${filePath}::${i}`), so clicking any occurrence navigates to the same Markdown file.
Expansion is windowed to `MAX_PAST_YEARS = 5` back and `MAX_FUTURE_YEARS = 2` ahead with a
`MAX_OCCURRENCES = 5000` backstop, so an unbounded rule cannot hang the scan.

## File Scanning — `src/main/calendarLoader.ts`

Three exports, all producing `CalendarEventResult` (epoch-millisecond `start`/`end`, so it
survives IPC structured cloning):

- **`loadCalendarEntryForFile(filePath)`** — the single authority on "is this a calendar
  file". Returns that file's entries (more than one for a recurring event) or `[]`. The
  watcher and both bulk loaders all route through it, so the initial load and live updates
  can never disagree.
- **`loadCalendarEvents(folderPath, ignoredPaths)`** — recursive `fdir` crawl using the
  same `buildCalendarFilter` predicate the watcher uses (hidden files, user-configured
  ignore patterns, and non-`.md` files excluded), reading at most
  `CALENDAR_READ_CONCURRENCY = 50` files at a time to avoid `EMFILE` on large vaults.
- **`loadCalendarEventsForFiles(filePaths)`** — the search-results counterpart. Drops
  non-`.md` paths, then runs the same per-file loader at the same concurrency. No ignore
  patterns are applied: the search that produced the list already honored them.

## File-System Monitoring — `src/main/calendarWatcher.ts`

Live monitoring uses `chokidar`, for the folder source only. Two exports:

- **`startCalendarWatcher(folderPath, onChange, onDelete, ignoredPaths, onError)`** —
  the single authority on whether a restart is needed: it no-ops when the folder *and*
  ignore list are unchanged and restarts when either differs, so an edited `ignoredPaths`
  setting propagates to live updates. Only one watcher exists at a time; start/stop calls
  are serialized.
- **`stopCalendarWatcher()`** — tears the watcher down. Called on app quit, and by the
  search-results loader (see [Event Sources](#event-sources)).

`src/main.ts` wires the watcher callbacks to IPC messages (`calendar-file-changed`,
`calendar-file-deleted`, `calendar-watcher-error`). The renderer listeners live in
`src/App.tsx` — at App level rather than in `CalendarView`, so they stay active regardless
of which view is displayed — and call `updateCalendarEvent` /
`deleteCalendarEventsUnderPath` / `setCalendarWatcherWarning`.

The first watcher error per session (e.g. inotify exhaustion) is mapped through
`describeWatcherError` and shown as a dismissible amber banner in the calendar, so the
user knows live updates degraded rather than silently getting a stale view.

## IPC Surface

| Channel | Handler | Purpose |
|---|---|---|
| `load-calendar-events` | `main.ts` | Folder crawl, then start/refresh the watcher |
| `load-calendar-events-for-files` | `main.ts` | Explicit path list; **stops** the watcher first |
| `calendar-file-changed` | → renderer | Upsert one file's events |
| `calendar-file-deleted` | → renderer | Remove one file's, or a whole folder's, events |
| `calendar-watcher-error` | → renderer | One-time degraded-live-updates warning |

## Global State

Declared in `AppState` (`src/shared/types.ts`), initial values in `src/store/core.ts`,
actions in `src/store/calendar.ts` (each also exported as a thin non-hook wrapper).
Components read with direct selectors — `useAS(s => s.calendarEvents)`.

| Field | Type | Purpose |
|---|---|---|
| `calendarSource` | `CalendarSource \| null` | Where the loaded events came from (`null` = never loaded) |
| `calendarEvents` | `CalendarEvent[] \| null` | The events rendered by the component (`null` = never loaded) |
| `calendarLoading` | `boolean` | True while a load is in flight; drives the spinner |
| `calendarViewType` | `'month' \| 'week' \| 'work_week' \| 'day' \| 'agenda'` | Persisted to `AppConfig` so it survives restarts |
| `calendarViewTime` | `Date` | The navigated-to date; in-memory only, resets to today on restart |
| `calendarWatcherWarning` | `string \| null` | One-time watcher warning banner text |

`calendarViewType` is the only calendar field written to the config file on disk.
`setCalendarEvents` also clears `calendarLoading`, so the two can't disagree.

`CalendarEvent` (`Date`-based) is the renderer-side shape; `toCalendarEvents()` in
`src/shared/calendarUtil.ts` converts the epoch-millisecond IPC wire form into it and is
used by every path that brings events into the store — both bulk loaders and the watcher's
incremental updates — so the conversion is defined once.

## CalendarView Component

`src/components/views/CalendarView.tsx` is a thin wrapper around `react-big-calendar`. It
reads the state fields above via `useAS` selectors, and:

- Renders a source-aware header banner (`data-testid="calendar-source-header"`) —
  `CalendarSourceHeader`, a module-level component with one branch per `CalendarSource`
  kind. Folder: *"Calendar folder: /path"*, click navigates there. Search: the matched/total
  counts plus the query, click returns to the search results tab.
- Writes back to state (and, for the view type, to config) when the user changes the view
  type or navigates to a different date range.
- **Clicking an event** → `setHighlightItem` + `navigateToBrowserPath(parent, filePath)`,
  the same "jump to file in BrowseView" behavior SearchResultsView uses.
- **Clicking or drag-selecting an empty slot** → builds a front-matter block (`due:`, plus
  `start:`/`duration:` when the slot isn't a whole-day multiple starting at midnight) and
  opens `NewCalendarFileDialog`. The new file is created in `settings.calendarItemsFolder`
  (an error is logged if that setting is empty), then the browser navigates to it and opens
  it for editing. A `requestDirectoryRefresh()` is required here: if `currentPath` was
  already the calendar folder no reload would otherwise happen, and the pending-edit
  request would silently target a path that isn't rendered.
- Applies a dark theme to react-big-calendar via an inline `<style>` block, and shows each
  event's body snippet (first 5 lines, ≤400 chars) as a native tooltip.

Other calendar-authoring entry points outside this view: the editor context menu's "Make
Calendar Item" / "Make Repeating Calendar Item" (`injectCalendarFrontMatter`), and the
calendar icon / clickable `due`,`start`,`duration`,`rrule` properties on a MarkdownEntry,
which open `EditCalendarDialog`.

## Testing

- `tests/calendar.test.ts` — front-matter parsing, `loadCalendarEntryForFile`,
  `loadCalendarEvents` (directory scan), `loadCalendarEventsForFiles` (explicit list),
  and the `calendarUtil` authoring helpers.
- `tests/calendarWatcher.test.ts` — watcher lifecycle with `chokidar` and `calendarLoader`
  mocked.
- `tests/e2e/calendar-view-demo.spec.ts` — Playwright walkthrough. Remember the e2e tests
  run the **packaged** build and do not detect stale bundles: run `npm run package` after
  touching any `src/` file.

Useful selectors: `calendar-button` (BrowseView toolbar),
`search-calendar-view-button` / `search-graph-view-button` (SearchResultsView header),
`calendar-source-header`, `tab-button-calendar`, `view-calendar`.
