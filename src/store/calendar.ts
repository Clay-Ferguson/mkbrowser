import type { CalendarEvent, CalendarViewType } from '../shared/types';
import { ensureTrailingSep } from '../renderer/pathUtil';
import { getState } from './core';
import type { StoreSet, StoreGet } from './core';

// ============================================================================
// Calendar - events, loading state, view configuration
// ============================================================================

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts`.
 */
export interface CalendarSlice {
  setCalendarFolder: (folder: string | null) => void;
  setActiveCalendarFolder: (folder: string | null) => void;
  deleteCalendarEventsUnderPath: (deletedPath: string) => void;
  updateCalendarEvent: (filePath: string, updated: CalendarEvent[]) => void;
  setCalendarEvents: (events: CalendarEvent[]) => void;
  setCalendarLoading: (loading: boolean) => void;
  setCalendarViewType: (viewType: CalendarViewType) => void;
  setCalendarViewTime: (date: Date) => void;
  setCalendarWatcherWarning: (message: string | null) => void;
}

/**
 * Slice creator called by `core.ts` inside `create()`. A function declaration
 * (not a `const`) so it is hoisted and safe under the core ↔ slice import
 * cycle regardless of module load order.
 */
export function createCalendarSlice(set: StoreSet, get: StoreGet): CalendarSlice {
  return {
    /** Set the folder the calendar should load events from. */
    setCalendarFolder: (folder) => set({ calendarFolder: folder }),

    /** Set the folder whose events are currently loaded into the calendar. */
    setActiveCalendarFolder: (folder) => set({ activeCalendarFolder: folder }),

    /** Remove all calendar events whose `filePath` equals or lives under `deletedPath`. */
    deleteCalendarEventsUnderPath: (deletedPath) => {
      const calendarEvents = get().calendarEvents;
      if (!calendarEvents) return;
      const normalizedDir = ensureTrailingSep(deletedPath);
      const remaining = calendarEvents.filter(
        e => e.filePath !== deletedPath && !(e.filePath?.startsWith(normalizedDir) ?? false),
      );
      if (remaining.length !== calendarEvents.length) {
        set({ calendarEvents: remaining });
      }
    },

    /** Replace the events for a single file (upsert by filePath). */
    updateCalendarEvent: (filePath, updated) => {
      const calendarEvents = get().calendarEvents;
      if (!calendarEvents) return;
      const existing = calendarEvents.filter(e => e.filePath !== filePath);
      set({ calendarEvents: [...existing, ...updated] });
    },

    /** Replace all calendar events and mark loading as complete. */
    setCalendarEvents: (events) => set({ calendarEvents: events, calendarLoading: false }),

    /** Set the calendar loading flag. */
    setCalendarLoading: (loading) => set({ calendarLoading: loading }),

    /** Set the active calendar view type (month/week/day). */
    setCalendarViewType: (viewType) => set({ calendarViewType: viewType }),

    /** Set the date the calendar is centered on. */
    setCalendarViewTime: (date) => set({ calendarViewTime: date }),

    /** Set (or clear, with null) the one-time file-watcher warning banner. */
    setCalendarWatcherWarning: (message) => set({ calendarWatcherWarning: message }),
  };
}

// Thin non-hook wrappers so the barrel API (and every caller) is unchanged;
// they delegate to the actions living inside the store.

export function setCalendarFolder(folder: string | null): void {
  getState().setCalendarFolder(folder);
}

export function setActiveCalendarFolder(folder: string | null): void {
  getState().setActiveCalendarFolder(folder);
}

export function deleteCalendarEventsUnderPath(deletedPath: string): void {
  getState().deleteCalendarEventsUnderPath(deletedPath);
}

export function updateCalendarEvent(filePath: string, updated: CalendarEvent[]): void {
  getState().updateCalendarEvent(filePath, updated);
}

export function setCalendarEvents(events: CalendarEvent[]): void {
  getState().setCalendarEvents(events);
}

export function setCalendarLoading(loading: boolean): void {
  getState().setCalendarLoading(loading);
}

export function setCalendarViewType(viewType: CalendarViewType): void {
  getState().setCalendarViewType(viewType);
}

export function setCalendarViewTime(date: Date): void {
  getState().setCalendarViewTime(date);
}

export function setCalendarWatcherWarning(message: string | null): void {
  getState().setCalendarWatcherWarning(message);
}
