import type { CalendarEvent } from '../types/types';
import { ensureTrailingSep } from '../utils/pathUtil';
import { getState, setState, useStoreValue } from './core';

// ============================================================================
// Calendar - events, loading state, view configuration
// ============================================================================

export function setCalendarFolder(folder: string | null): void {
  setState({ calendarFolder: folder });
}

export function useCalendarFolder(): string | null {
  return useStoreValue(s => s.calendarFolder);
}

export function setActiveCalendarFolder(folder: string | null): void {
  setState({ activeCalendarFolder: folder });
}

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

export function setCalendarEvents(events: CalendarEvent[]): void {
  setState({ calendarEvents: events, calendarLoading: false });
}

export function setCalendarLoading(loading: boolean): void {
  setState({ calendarLoading: loading });
}

export function useCalendarEvents(): CalendarEvent[] | null {
  return useStoreValue(s => s.calendarEvents);
}

export function useCalendarLoading(): boolean {
  return useStoreValue(s => s.calendarLoading);
}

export function useCalendarViewType(): 'month' | 'week' | 'work_week' | 'day' | 'agenda' {
  return useStoreValue(s => s.calendarViewType);
}

export function setCalendarViewType(viewType: 'month' | 'week' | 'work_week' | 'day' | 'agenda'): void {
  setState({ calendarViewType: viewType });
}

export function useCalendarViewTime(): Date {
  return useStoreValue(s => s.calendarViewTime);
}

export function setCalendarViewTime(date: Date): void {
  setState({ calendarViewTime: date });
}
