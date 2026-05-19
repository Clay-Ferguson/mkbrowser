import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar';
import type { View } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { useCalendarEvents, useCalendarLoading, useCalendarViewType, setCalendarViewType, useCalendarViewTime, setCalendarViewTime, setHighlightItem, navigateToBrowserPath } from '../../store';
import type { CalendarEvent } from '../../store/types';

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
  day: Views.DAY,
  agenda: Views.AGENDA,
};

export default function CalendarView() {
  const events = useCalendarEvents();
  const loading = useCalendarLoading();
  const calendarViewType = useCalendarViewType();
  const view = viewTypeToRbc[calendarViewType] ?? Views.MONTH;
  const date = useCalendarViewTime();

  const handleViewChange = (v: View) => {
    const vt = v as 'month' | 'week' | 'day' | 'agenda';
    setCalendarViewType(vt);
    window.electronAPI.getConfig().then(config => {
      window.electronAPI.saveConfig({ ...config, calendarViewType: vt });
    });
  };

  const handleSelectEvent = (event: CalendarEvent) => {
    if (!event.filePath) return;
    const lastSlash = event.filePath.lastIndexOf('/');
    const folderPath = event.filePath.substring(0, lastSlash);
    setHighlightItem(event.filePath);
    navigateToBrowserPath(folderPath, event.filePath);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
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
            views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
            view={view}
            date={date}
            onView={handleViewChange}
            onNavigate={(d) => setCalendarViewTime(new Date(d))}
            onSelectEvent={handleSelectEvent}
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
  );
}
