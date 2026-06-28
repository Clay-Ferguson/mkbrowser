import type { CalendarEvent, CalendarViewType } from '../types/types';
import { ensureTrailingSep } from '../renderer/pathUtil';
import { getState, setState, useStoreValue } from './core';

// ============================================================================
// Calendar - events, loading state, view configuration
// ============================================================================

/**
 * Set the folder the calendar should load events from.
 */
export function setCalendarFolder(folder: string | null): void {
  setState({ calendarFolder: folder });
}

/**
 * Hook to subscribe to the calendar's configured folder.
 */
export function useCalendarFolder(): string | null {
  return useStoreValue(s => s.calendarFolder);
}

/**
 * Set the folder whose events are currently loaded into the calendar.
 */
export function setActiveCalendarFolder(folder: string | null): void {
  setState({ activeCalendarFolder: folder });
}

/**
 * Hook to subscribe to the folder whose events are currently loaded.
 */
export function useActiveCalendarFolder(): string | null {
  return useStoreValue(s => s.activeCalendarFolder);
}

/**
 * Remove all calendar events whose `filePath` equals or lives under `deletedPath`.
 */
export function deleteCalendarEventsUnderPath(deletedPath: string): void {
  const calendarEvents = getState().calendarEvents;
  if (!calendarEvents) return;
  const normalizedDir = ensureTrailingSep(deletedPath);
  const remaining = calendarEvents.filter(
    e => e.filePath !== deletedPath && !(e.filePath?.startsWith(normalizedDir) ?? false),
  );
  if (remaining.length !== calendarEvents.length) {
    setState({ calendarEvents: remaining });
  }
}

/**
 * Replace the events for a single file (upsert by filePath).
 */
export function updateCalendarEvent(filePath: string, updated: CalendarEvent[]): void {
  const calendarEvents = getState().calendarEvents;
  if (!calendarEvents) return;
  const existing = calendarEvents.filter(e => e.filePath !== filePath);
  setState({ calendarEvents: [...existing, ...updated] });
}

/**
 * Replace all calendar events and mark loading as complete.
 */
export function setCalendarEvents(events: CalendarEvent[]): void {
  setState({ calendarEvents: events, calendarLoading: false });
}

/**
 * Set the calendar loading flag.
 */
export function setCalendarLoading(loading: boolean): void {
  setState({ calendarLoading: loading });
}

/**
 * Hook to subscribe to the loaded calendar events.
 */
export function useCalendarEvents(): CalendarEvent[] | null {
  return useStoreValue(s => s.calendarEvents);
}

/**
 * Hook to subscribe to the calendar loading flag.
 */
export function useCalendarLoading(): boolean {
  return useStoreValue(s => s.calendarLoading);
}

/**
 * Hook to subscribe to the active calendar view type (month/week/day).
 */
export function useCalendarViewType(): CalendarViewType {
  return useStoreValue(s => s.calendarViewType);
}

/**
 * Set the active calendar view type (month/week/day).
 */
export function setCalendarViewType(viewType: CalendarViewType): void {
  setState({ calendarViewType: viewType });
}

/**
 * Hook to subscribe to the date the calendar is currently centered on.
 */
export function useCalendarViewTime(): Date {
  return useStoreValue(s => s.calendarViewTime);
}

/**
 * Set the date the calendar is centered on.
 */
export function setCalendarViewTime(date: Date): void {
  setState({ calendarViewTime: date });
}
