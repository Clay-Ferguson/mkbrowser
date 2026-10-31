import type { CalendarEvent, CalendarSource, CalendarViewType } from '../shared/types';
import { ensureTrailingSep } from '../renderer/pathUtil';
import { getState } from './core';
import type { StoreSet, StoreGet } from './core';

// ============================================================================
// Calendar - events, loading state, view configuration
// See: (docs/technical_notes/calendar_view.md#global-state)
// ============================================================================

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts`.
 *
 * See: (USER_GUIDE.md#calendar)
 */
export interface CalendarSlice {
  setCalendarSource: (source: CalendarSource | null) => void;
  // Show Calendar: scans a folder (and watches it for changes). See: (USER_GUIDE.md#opening-the-calendar)
  showCalendarForFolder: (folder: string) => void;
  deleteCalendarEventsUnderPath: (deletedPath: string) => void;
  updateCalendarEvent: (filePath: string, updated: CalendarEvent[]) => void;
  setCalendarEvents: (events: CalendarEvent[]) => void;
  setCalendarLoading: (loading: boolean) => void;
  // Month / Week / Day / Agenda, and the date being viewed; both are remembered. See: (USER_GUIDE.md#navigating-the-calendar)
  setCalendarViewType: (viewType: CalendarViewType) => void;
  setCalendarViewTime: (date: Date) => void;
  setCalendarTargetDate: (date: Date | null) => void;
  setCalendarWatcherWarning: (message: string | null) => void;
}

/**
 * Slice creator called by `core.ts` inside `create()`. A function declaration
 * (not a `const`) so it is hoisted and safe under the core ↔ slice import
 * cycle regardless of module load order.
 */
export function createCalendarSlice(set: StoreSet, get: StoreGet): CalendarSlice {
  return {
    /**
     * Record where the currently loaded calendar events came from.
     *
     * See: (docs/technical_notes/calendar_view.md#event-sources)
     */
    setCalendarSource: (source) => set({ calendarSource: source }),

    /**
     * Switch to the calendar tab for `folder`'s events, in a single state
     * update: the tab is shown and selected, the source recorded, and loading
     * started. The caller then loads the events and calls setCalendarEvents.
     *
     * See: (docs/technical_notes/application_tabs.md#switching-views-from-code)
     * See: (docs/technical_notes/calendar_view.md#folder-source--live)
     */
    showCalendarForFolder: (folder) => {
      const { visibleTabs } = get();
      set({
        ...(visibleTabs.has('calendar') ? {} : { visibleTabs: new Set(visibleTabs).add('calendar') }),
        currentView: 'calendar',
        calendarSource: { kind: 'folder', folder },
        calendarLoading: true,
        calendarTargetDate: null,
      });
    },

    /**
     * Remove all calendar events whose `filePath` equals or lives under `deletedPath`.
     *
     * See: (docs/technical_notes/calendar_view.md#file-system-monitoring--srcmaincalendarwatcherts)
     */
    deleteCalendarEventsUnderPath: (deletedPath) => {
      const { calendarEvents, calendarSource } = get();
      // Watcher-driven — only a folder-sourced calendar is live. A search-sourced
      // one is a snapshot of a specific result set (the watcher is stopped when it
      // loads), so a late in-flight event must not be allowed to edit it.
      // See: (docs/technical_notes/calendar_view.md#search-source--snapshot)
      if (!calendarEvents || calendarSource?.kind !== 'folder') return;
      const normalizedDir = ensureTrailingSep(deletedPath);
      const remaining = calendarEvents.filter(
        e => e.filePath !== deletedPath && !(e.filePath?.startsWith(normalizedDir) ?? false),
      );
      if (remaining.length !== calendarEvents.length) {
        set({ calendarEvents: remaining });
      }
    },

    /**
     * Replace the events for a single file (upsert by filePath). Driven by the watcher.
     *
     * See: (docs/technical_notes/calendar_view.md#file-system-monitoring--srcmaincalendarwatcherts)
     */
    updateCalendarEvent: (filePath, updated) => {
      const { calendarEvents, calendarSource } = get();
      // Folder-sourced only — see deleteCalendarEventsUnderPath above.
      if (!calendarEvents || calendarSource?.kind !== 'folder') return;
      const existing = calendarEvents.filter(e => e.filePath !== filePath);
      set({ calendarEvents: [...existing, ...updated] });
    },

    /**
     * Replace all calendar events and mark loading as complete.
     *
     * See: (docs/technical_notes/calendar_view.md#global-state)
     */
    setCalendarEvents: (events) => set({ calendarEvents: events, calendarLoading: false }),

    /** Set the calendar loading flag. */
    setCalendarLoading: (loading) => {
      if (get().calendarLoading === loading) return;
      set({ calendarLoading: loading });
    },

    /**
     * Set the active calendar view type (month/week/work_week/day/agenda).
     *
     * See: (docs/technical_notes/calendar_view.md#global-state)
     */
    setCalendarViewType: (viewType) => {
      if (get().calendarViewType === viewType) return;
      set({ calendarViewType: viewType });
    },

    /** Set the date the calendar is centered on. */
    setCalendarViewTime: (date) => set({ calendarViewTime: date }),

    /**
     * Set (or clear, with null) the day drawn highlighted in the calendar.
     *
     * See: (docs/technical_notes/calendar_view.md#calendarview-component)
     */
    setCalendarTargetDate: (date) => set({ calendarTargetDate: date }),

    /**
     * Set (or clear, with null) the one-time file-watcher warning banner.
     *
     * See: (docs/technical_notes/calendar_view.md#file-system-monitoring--srcmaincalendarwatcherts)
     */
    setCalendarWatcherWarning: (message) => set({ calendarWatcherWarning: message }),
  };
}

// Thin non-hook wrappers so the barrel API (and every caller) is unchanged;
// they delegate to the actions living inside the store.

export function setCalendarSource(source: CalendarSource | null): void {
  getState().setCalendarSource(source);
}

export function showCalendarForFolder(folder: string): void {
  getState().showCalendarForFolder(folder);
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

export function setCalendarTargetDate(date: Date | null): void {
  getState().setCalendarTargetDate(date);
}

export function setCalendarWatcherWarning(message: string | null): void {
  getState().setCalendarWatcherWarning(message);
}
