import { useState } from 'react';
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar';
import type { View } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { api } from '../../services/api';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { useCalendarEvents, useCalendarLoading, useCalendarViewType, setCalendarViewType, useCalendarViewTime, setCalendarViewTime, setHighlightItem, navigateToBrowserPath, setPendingEditFile, requestDirectoryRefresh, useSettings, useActiveCalendarFolder } from '../../store';
import type { CalendarEvent, CalendarViewType } from '../../types/types';
import { logger } from '../../utils/logUtil';
import { getParentPath, joinPath } from '../../utils/pathUtil';
import NewCalendarFileDialog from '../dialogs/NewCalendarFileDialog';

function formatDueDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}

function formatStartTime(d: Date): string {
  const h24 = d.getHours();
  const h12 = h24 % 12 || 12;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  return `${h12}:${d.getMinutes().toString().padStart(2, '0')} ${ampm}`;
}

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales: { 'en-US': enUS },
});

const viewTypeToRbc: Record<string, View> = {
  month: Views.MONTH,
  week: Views.WEEK,
  work_week: Views.WORK_WEEK,
  day: Views.DAY,
  agenda: Views.AGENDA,
};

interface PendingSlot {
  content: string;
  defaultFileName: string;
}

export default function CalendarView() {
  const events = useCalendarEvents();
  const loading = useCalendarLoading();
  const calendarViewType = useCalendarViewType();
  const view = viewTypeToRbc[calendarViewType] ?? Views.MONTH;
  const date = useCalendarViewTime();
  const settings = useSettings();
  const activeCalendarFolder = useActiveCalendarFolder();
  const [pendingSlot, setPendingSlot] = useState<PendingSlot | null>(null);

  const handleViewChange = (v: View) => {
    const vt = v as CalendarViewType;
    setCalendarViewType(vt);
    void api.updateConfig({ calendarViewType: vt });
  };

  const handleSelectSlot = (slotInfo: { start: Date; end: Date }) => {
    const { start, end } = slotInfo;
    const isAllDay =
      start.getHours() === 0 && start.getMinutes() === 0 && start.getSeconds() === 0 &&
      (end.getTime() - start.getTime()) % (24 * 60 * 60 * 1000) === 0;

    const lines = ['---', `due: ${formatDueDate(start)}`];
    if (!isAllDay) {
      const durationHours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
      const durationStr = Number.isInteger(durationHours) ? String(durationHours) : String(durationHours);
      lines.push(`start: ${formatStartTime(start)}`);
      lines.push(`duration: ${durationStr}`);
    }
    lines.push('---', '');
    const content = lines.join('\n');

    setPendingSlot({ content, defaultFileName: '' });
  };

  const handleCreateCalendarFile = async (fileName: string) => {
    if (!pendingSlot) return;
    const { content } = pendingSlot;
    setPendingSlot(null);

    const folder = settings.calendarItemsFolder;
    if (!folder) {
      logger.error('Calendar items folder is not configured. Set it in Settings.');
      return;
    }
    const normalizedName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
    const filePath = joinPath(folder, normalizedName);
    try {
      const result = await api.createFile(filePath, content);
      if (!result.success) {
        logger.error('Failed to create calendar file:', result.error);
        return;
      }
      setHighlightItem(filePath);
      navigateToBrowserPath(folder, filePath);
      setPendingEditFile(filePath, undefined, 'browser');
      // Force BrowseView to re-read the directory so the new file is in entries
      // before the pending-edit handler fires — otherwise, if currentPath was
      // already the calendar folder, no reload would happen and the edit
      // request would silently target a path that isn't rendered.
      requestDirectoryRefresh();
    } catch (err) {
      logger.error('Failed to create calendar file:', err);
    }
  };

  const handleSelectEvent = (event: CalendarEvent) => {
    if (!event.filePath) return;
    const folderPath = getParentPath(event.filePath);
    setHighlightItem(event.filePath);
    navigateToBrowserPath(folderPath, event.filePath);
  };

  return (
    <>
    <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
      {activeCalendarFolder && (
        <div
          className="w-full px-4 py-2 bg-slate-800 border-b border-slate-700 text-slate-300 text-sm truncate cursor-pointer hover:bg-slate-700"
          onClick={() => navigateToBrowserPath(activeCalendarFolder)}
          title="Browse to this folder"
        >
          <span className="text-slate-500">Calendar folder:</span> {activeCalendarFolder}
        </div>
      )}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-slate-400 text-sm">Loading calendar...</span>
          </div>
        </div>
      )}
      {!loading && events && (
        <div className="flex-1 min-h-0 p-4" style={{ '--rbc-bg': '#1e293b' } as React.CSSProperties}>
          <style>{`
            .rbc-calendar { height: 100%; background: #1e293b; color: #e2e8f0; border-radius: 8px; }
            .rbc-header { background: #0f172a; border-color: #334155; padding: 8px; color: #94a3b8; }
            .rbc-month-view, .rbc-time-view, .rbc-agenda-view { border-color: #334155; }
            .rbc-day-bg { background: #1e293b; }
            .rbc-day-bg.rbc-off-range-bg { background: #0f172a; }
            .rbc-today { background: #1d3a5c !important; }
            .rbc-event { background: #3b82f6; border-color: #2563eb; border-radius: 4px; }
            .rbc-event:focus { outline: 2px solid #60a5fa; }
            .rbc-selected { background: #2563eb !important; }
            .rbc-toolbar button { color: #e2e8f0; border-color: #475569; background: #0f172a; }
            .rbc-toolbar button:hover { background: #1e3a5f; color: #fff; }
            .rbc-toolbar button.rbc-active { background: #3b82f6; color: #fff; border-color: #3b82f6; }
            .rbc-toolbar button.rbc-active:hover { background: #2563eb; }
            .rbc-month-row { border-color: #334155; }
            .rbc-date-cell { color: #94a3b8; }
            .rbc-date-cell.rbc-now { color: #60a5fa; font-weight: 700; }
            .rbc-time-slot { color: #64748b; }
            .rbc-time-header-content { border-color: #334155; }
            .rbc-time-content { border-color: #334155; }
            .rbc-timeslot-group { border-color: #1e3a5c; }
            .rbc-time-header.rbc-overflowing { border-color: #334155; }
            .rbc-agenda-view table { color: #e2e8f0; }
            .rbc-agenda-date-cell, .rbc-agenda-time-cell { color: #94a3b8; }
            .rbc-show-more { color: #60a5fa; background: transparent; }
          `}</style>
          <Calendar
            localizer={localizer}
            events={events}
            views={[Views.MONTH, Views.WEEK, Views.WORK_WEEK, Views.DAY, Views.AGENDA]}
            view={view}
            date={date}
            onView={handleViewChange}
            onNavigate={(d) => setCalendarViewTime(new Date(d))}
            onSelectEvent={handleSelectEvent}
            selectable
            onSelectSlot={handleSelectSlot}
            tooltipAccessor={(event: CalendarEvent) => {
              const pad = '  •  ';
              const divider = '________________________________';
              return event.snippet
                ? `${pad}${event.title}\n${divider}\n${event.snippet}`
                : `${pad}${event.title}`;
            }}
            style={{ height: '100%' }}
            popup
          />
        </div>
      )}
    </div>
    {pendingSlot && (
      <NewCalendarFileDialog
        initialFileName={pendingSlot.defaultFileName}
        onCreate={handleCreateCalendarFile}
        onCancel={() => setPendingSlot(null)}
      />
    )}
    </>
  );
}
