/**
 * Opening the Calendar tab from elsewhere in the UI: the value half of a `due`
 * property pill (see PropsDisplay/MarkdownEntry), and BrowseView's Calendar button.
 */

import { api } from './api';
import { toCalendarEvents } from '../shared/calendarUtil';
import { logger } from '../shared/logUtil';
import { runOp } from './runOp';
import {
  useAS,
  showTab,
  setCurrentView,
  setCalendarSource,
  setCalendarLoading,
  setCalendarEvents,
  setCalendarViewTime,
  showCalendarForFolder,
  setAppError,
} from '../store';
import type { CalendarEvent, CalendarSource } from '../shared/types';

/**
 * Installs a finished calendar scan, but only if `source` is still the calendar's source.
 * Scans can take a while on a big folder, and the user can start another one meanwhile (the
 * Calendar button on a different folder, a `due` pill, a search's calendar): without this the
 * slower, older scan lands last and fills the grid with events from a source the header no
 * longer names. The newer load clears the loading flag when it lands.
 */
export function setCalendarEventsIfCurrent(source: CalendarSource | null, events: CalendarEvent[]): void {
  if (useAS.getState().calendarSource === source) setCalendarEvents(events);
}

/**
 * Switches to the Calendar tab centered on `date`, showing the calendar items found in
 * `folder`.
 *
 * The events are (re)scanned from `folder` unless the calendar is already sourced from that
 * same folder: a folder-sourced calendar is kept current by the main-process watcher, so a
 * re-scan would only blank the grid behind a spinner for no gain. Any other source (a search
 * snapshot, or a different folder) is replaced, matching what the Calendar button in
 * BrowseView does.
 */
export function openCalendarAtDate(folder: string, date: Date): void {
  setCalendarViewTime(date);
  showTab('calendar');
  setCurrentView('calendar');

  const { calendarSource, calendarEvents } = useAS.getState();
  if (calendarEvents && calendarSource?.kind === 'folder' && calendarSource.folder === folder) return;

  const source: CalendarSource = { kind: 'folder', folder };
  setCalendarSource(source);
  setCalendarLoading(true);
  void api.loadCalendarEvents(folder)
    .then((results) => {
      setCalendarEventsIfCurrent(source, toCalendarEvents(results));
    })
    .catch((err: unknown) => {
      logger.error('Failed to load calendar:', err);
      setCalendarEventsIfCurrent(source, []);
    });
}

/**
 * Switches to the Calendar tab showing the calendar items found in `folder` —
 * the Calendar button in BrowseView. Unlike {@link openCalendarAtDate} this
 * always re-scans: it is the explicit "show me this folder's calendar" action.
 * Fire-and-forget: a failed scan is reported and leaves an empty calendar.
 */
export function showFolderCalendar(folder: string): void {
  showCalendarForFolder(folder);
  const source = useAS.getState().calendarSource;
  runOp(async () => {
    const results = await api.loadCalendarEvents(folder);
    setCalendarEventsIfCurrent(source, toCalendarEvents(results));
  }, 'Failed to load calendar: ', (msg) => {
    setAppError(msg);
    setCalendarEventsIfCurrent(source, []);
  });
}
