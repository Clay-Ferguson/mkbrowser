/**
 * Opening the Calendar tab from elsewhere in the UI (currently the value half of a
 * `due` property pill — see PropsDisplay/MarkdownEntry).
 */

import { api } from './api';
import { toCalendarEvents } from '../shared/calendarUtil';
import { logger } from '../shared/logUtil';
import {
  useAS,
  showTab,
  setCurrentView,
  setCalendarSource,
  setCalendarLoading,
  setCalendarEvents,
  setCalendarViewTime,
} from '../store';

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

  setCalendarSource({ kind: 'folder', folder });
  setCalendarLoading(true);
  void api.loadCalendarEvents(folder)
    .then((results) => {
      setCalendarEvents(toCalendarEvents(results));
    })
    .catch((err: unknown) => {
      logger.error('Failed to load calendar:', err);
      setCalendarEvents([]);
    });
}
