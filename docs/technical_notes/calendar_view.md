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

The calendar icon in the BrowseView toolbar (`data-testid="calendar-button"`, rendered by
`src/components/views/BrowseToolbar.tsx`) → `showFolderCalendar(currentPath)` in
`src/renderer/calendarNav.ts`. That calls the store's `showCalendarForFolder` action, which
in a single `set()` shows and selects the Calendar tab (so the spinner is visible at once),
records `{ kind: 'folder', folder }` as the source, sets `calendarLoading`, and clears
`calendarTargetDate`. It then calls `api.loadCalendarEvents(folder)` through `runOp`; a
failed scan is reported via `setAppError` and leaves an empty calendar. **Every click
re-scans** and re-arms the watcher.

The folder path is snapshotted at click time and tracked independently of `currentPath`,
so the calendar stays stable while the user browses elsewhere.

### Stale-scan guard

A scan can take a while on a big folder, and the user can start another load meanwhile
(the Calendar button on a different folder, a `due` pill, a search's calendar). Every
loader therefore installs its result through `setCalendarEventsIfCurrent(source, events)`
(`src/renderer/calendarNav.ts`), which only calls `setCalendarEvents` if `calendarSource`
is still the *same object* the load was started for. Otherwise a slower, older scan could
land last and fill the grid with events from a source the header no longer names. The
newer load clears the loading flag when it lands.

### Search source — snapshot

The **Calendar** button in the SearchResultsView header
(`data-testid="search-calendar-view-button"`), sitting beside the Graph button —
the two are parallel affordances offering alternate renderings of one result set (see
`folder_graph.md`). `handleShowCalendar()` in
`src/components/views/SearchResultsView.tsx` does nothing when there are no results;
otherwise it shows and selects the tab, records the `search` source (search folder, query,
saved-search name, and result count), clears `calendarTargetDate`, sets the loading flag,
and calls `api.loadCalendarEventsForFiles(searchResults.map(r => r.path))`, installing the
result through the stale-scan guard above.

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
`due` property. The raw value goes through `coerceDueDate` (`src/shared/calendarUtil.ts`),
which hands strings to `parseDueStr` — accepting `M/D/YYYY`, `M/D/YY`, and ISO
`YYYY-MM-DD`, all as local calendar dates — and also accepts a YAML-resolved `Date`
defensively. The event title is the file name without its `.md` extension. Two optional
properties control time-of-day display:

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
mistake. The optional fields degrade the same way: an unrecognized `start` logs a warning
and the entry becomes all-day, and an invalid `duration` (non-numeric, `.nan`, zero or
negative) logs a warning and falls back to one hour. An absent `start`/`duration` is
silent.

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
Expansion is windowed to `MAX_PAST_YEARS = 5` back and `MAX_FUTURE_YEARS = 2` ahead of
*now* (not of the rule's start, so an old daily rule still reaches the present) with a
`MAX_OCCURRENCES = 5000` backstop, so an unbounded rule cannot hang the scan. The rule is
driven in a UTC-encoded wall-clock frame and decoded back to local time per occurrence, so
`byday` doesn't land on the wrong weekday off-UTC and timed events don't drift across DST;
`until` is encoded as the end of its day so the final occurrence of a timed rule isn't
dropped. The `rrule:` block is normalized first (`normalizeRRule`), so stringly-typed or
invalid values fall back to defaults instead of throwing; an unrecognized `freq` yields no
events at all.

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
  are serialized. Its `ignored` predicate wraps the same `buildCalendarFilter` the crawl
  uses, except that the watch root itself is never ignored (so a hidden or
  pattern-matched calendar folder still live-updates), and an in-flight file load from a
  watcher that has since been stopped or replaced is discarded rather than delivered.
- **`stopCalendarWatcher()`** — tears the watcher down. Called on app quit, and by the
  search-results loader (see [Event Sources](#event-sources)).

`src/main.ts` wires the watcher callbacks to IPC messages (`calendar-file-changed`,
`calendar-file-deleted`, `calendar-watcher-error`). The renderer listeners live in
`src/App.tsx` — at App level rather than in `CalendarView`, so they stay active regardless
of which view is displayed — and call `updateCalendarEvent` /
`deleteCalendarEventsUnderPath` / `setCalendarWatcherWarning`. A deleted *file* is
applied as `updateCalendarEvent(path, [])`; a deleted *folder* as
`deleteCalendarEventsUnderPath(path)`.

Renames and moves made inside the app don't wait for the watcher: `renameItem` in
`src/store/items.ts` remaps `calendarEvents` alongside the other path-holding slices,
rewriting each moved event's `filePath` and rebuilding its `id` (which embeds the path) so
a new file landing on the old path can't produce duplicate ids.

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
| `calendarTargetDate` | `Date \| null` | The day the calendar was opened to show (a clicked date), drawn highlighted; `null` for none |
| `calendarWatcherWarning` | `string \| null` | One-time watcher warning banner text |

`calendarViewType` is the only one of these fields written to the config file on disk
(restored at startup by `src/renderer/config.ts`). The folder new calendar files are
created in is a regular setting, `settings.calendarItemsFolder`, edited in SettingsView's
"Calendar" section. `setCalendarEvents` also clears `calendarLoading`, so the two can't
disagree. `calendarTargetDate` is set only by `openCalendarAtDate`; the Calendar button
(`showCalendarForFolder`) and the search-results Calendar button both clear it.

`CalendarEvent` (`Date`-based) is the renderer-side shape; `toCalendarEvents()` in
`src/shared/calendarUtil.ts` converts the epoch-millisecond IPC wire form into it and is
used by every path that brings events into the store — both bulk loaders and the watcher's
incremental updates — so the conversion is defined once.

## CalendarView Component

`src/components/views/CalendarView.tsx` is a thin wrapper around `react-big-calendar`. It
reads the state fields above via `useAS` selectors, and:

- Renders a source-aware header banner (`data-testid="calendar-source-header"`) —
  `CalendarSourceHeader`, a module-level component with one branch per `CalendarSource`
  kind. Folder: just the folder path (amber, monospace), click navigates there. Search: the
  matched/total counts, the saved-search name (if any), the query, and the searched folder's
  name; click returns to the search results tab.
- Fires a synthetic window `resize` event whenever the tab becomes active
  (`useIsActiveView('calendar')`). Views never unmount, and react-big-calendar measures its
  layout on mount and on `resize`; measured while the tab was hidden (`display: none`) every
  height is 0 and the month view pushes every event into "+N more". The synthetic event
  makes the library re-measure through its own listeners.
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
  event's body snippet (first 5 lines, ≤400 chars) as a native tooltip. **That block is a
  template literal — a backtick anywhere in it (even inside a CSS comment) ends the string and
  silently produces a renderer that throws on first paint.**
- Marks the store's `highlightItem` file with the same purple border BrowseView draws
  (`ENTRY_HIGHLIGHTED`), via `eventPropGetter` — the library's own per-event styling hook, and
  the one mechanism that behaves identically in all five views, so nothing here depends on how
  any of them render. It returns the `mk-event-highlighted` class, whose rule needs
  `!important`: rbc styles events per view with more specific selectors of its own (e.g. the
  time grid's `.rbc-day-slot .rbc-event` sets a 1px border, which otherwise wins in
  week/work-week/day). Verified in month, week, day, and agenda — agenda is worth re-checking
  after any change here, since it puts the class on a table row rather than an event div.
- Marks `calendarTargetDate` (the day the user jumped to — see below) via `dayPropGetter`,
  which returns the `mk-day-target` class: an emerald tint plus inset ring, chosen so it
  doesn't blend with the blue events or the purple highlighted event, and `!important` so it
  wins over `.rbc-today`.
- Shows a dismissible amber banner for `calendarWatcherWarning`, and, for a search source
  with zero matches, an explicit "None of the search results are calendar items" hint.

Other calendar-authoring entry points outside this view, all on a MarkdownEntry, open
`EditCalendarDialog`: the calendar icon in the editor toolbar (edit mode only,
`data-testid="edit-calendar-info"`), and a click on any `due`/`start`/`duration`/`rrule`
property pill (`CALENDAR_PROPS` in `src/shared/calendarUtil.ts`), which works outside edit
mode too — in that case the dialog's save writes the front matter straight to disk.

The `due` pill is the one exception to "a pill click opens the dialog": `PropsDisplay` makes
the value half of every pill separately clickable (`onPropValueClick`, which falls back to
`onPropClick` for keys it doesn't special-case), and MarkdownEntry uses that so clicking the
*date* jumps here instead of opening the editor dialog. A date value on a typed object's
card (`GenericObject`'s `onDateClick`) does the same. Both set `highlightItem` to the entry
(so its purple border marks where the user came from) and call `openCalendarAtDate` in
`src/renderer/calendarNav.ts`, which sets `calendarViewTime` and `calendarTargetDate`,
shows/selects the calendar tab, and loads the entry's parent folder unless a folder-sourced
calendar for that same folder is already loaded (its watcher keeps it current, so
re-scanning would only flash the spinner).

## Testing

- `tests/calendar.test.ts` — front-matter parsing, `loadCalendarEntryForFile`,
  `loadCalendarEvents` (directory scan), `loadCalendarEventsForFiles` (explicit list),
  and the `calendarUtil` authoring helpers.
- `tests/calendarWatcher.test.ts` — watcher lifecycle with `chokidar` and `calendarLoader`
  mocked.
- `tests/e2e/calendar-view-demo.spec.ts` — Playwright walkthrough. Remember the e2e tests
  run the **packaged** build and do not detect stale bundles: run `npm run package` after
  touching any `src/` file. The demo points `calendarItemsFolder` at its own folder through
  `window.__testStore` (`src/renderer.tsx`), which is attached only when running unpackaged
  with test hooks enabled.

Useful selectors: `calendar-button` (BrowseView toolbar),
`search-calendar-view-button` / `search-graph-view-button` (SearchResultsView header),
`calendar-source-header`, `tab-button-calendar`, `view-calendar`.
