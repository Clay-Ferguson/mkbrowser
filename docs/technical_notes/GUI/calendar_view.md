# Calendar View — Technical Notes

## Overview

The Calendar View is a top-level application tab that scans a folder for Markdown files containing Front Matter YAML calendar metadata and renders them using the `react-big-calendar` library. Users navigate to it via the Tools menu ("Show Calendar"). It supports month, week, day, and agenda display modes, live file-system monitoring, and click-to-navigate integration with BrowseView.

## Activating the Calendar

When the user clicks "Show Calendar" in the Tools menu, the main process scans the folder currently being browsed in BrowseView. Only that initial click (or a subsequent re-open when no calendar data is loaded) triggers a scan. The folder path at scan time is stored in global state as `calendarFolder`. Re-opening the calendar tab when data is already loaded does **not** re-scan; the user must use the menu item again to refresh.

## Calendar Entry Format

A Markdown file becomes a calendar entry if its Front Matter YAML contains a `due` property formatted as `MM/DD/YYYY`. Two optional properties control time-of-day display:

```yaml
---
due: 05/20/2026
start: 2:00 PM      # optional — 12-hour clock, no seconds
duration: 1.5        # optional — hours (decimal allowed)
---
```

If `start` is absent the entry appears as an all-day event. If `duration` is absent but `start` is present, a one-hour default is assumed.

## File Scanning — `calendarLoader.ts`

All file-system scanning logic lives in `src/calendarLoader.ts`. The two exported functions are:

- **`loadCalendarEvents(folderPath, ignoredPaths)`** — walks the folder recursively, reads Front Matter from every `.md` file (reusing the shared `parseFrontMatter` utility), and returns an array of `CalendarEventResult` objects containing the event title, start/end `Date` values, and the full file path.
- **`loadCalendarEntryForFile(filePath)`** — loads a single file and returns its `CalendarEventResult` (or `null` if no valid `due` property is found). Used by the watcher on individual file-change events.

## File-System Monitoring — `calendarWatcher.ts`

Live monitoring is handled by `src/calendarWatcher.ts` using the `chokidar` package. Three exports manage the watcher lifecycle:

- **`startCalendarWatcher(folderPath, onChange, onDelete)`** — starts (or restarts if the folder changed) a `chokidar` watcher on `folderPath`. Only one watcher instance is kept alive at a time; starting a new one on a different folder automatically stops the old one.
- **`stopCalendarWatcher()`** — tears down the active watcher; called when the app quits.
- **`getCalendarWatcherFolder()`** — returns the folder currently being monitored.

The main process (`src/main.ts`) wires the watcher callbacks to IPC messages (`calendar-file-changed` and `calendar-file-deleted`) that the renderer listens for and uses to surgically update or remove entries in global state.

## Global State

Calendar-related state is managed in `src/store/store.ts` / `src/store/types.ts`:

| Field | Type | Purpose |
|---|---|---|
| `calendarEntries` | `CalendarEventResult[]` | The current set of calendar events rendered by the component |
| `calendarFolder` | `string \| null` | Folder that was scanned; also what `chokidar` monitors |
| `calendarViewType` | `'month' \| 'week' \| 'day' \| 'agenda'` | Persisted to `AppConfig` (config YAML) so it survives restarts |
| `calendarViewTime` | `Date` | The date/time currently in view; in-memory only, resets to today on restart |

`calendarViewType` is the only calendar field written to the app config file on disk. It is read back and applied during startup in `src/config.ts`.

## CalendarView Component

`src/components/views/CalendarView.tsx` is a thin React wrapper around `react-big-calendar`. It reads the four state fields above via hooks (`useCalendarEntries`, `useCalendarViewType`, `useCalendarViewTime`), passes them as props to the `<Calendar>` component, and writes back to state (and config) whenever the user changes the view type or navigates to a different date range. Clicking an event calls the same "jump to file in BrowseView" helper used by SearchResultsView.
