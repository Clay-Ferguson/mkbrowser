import { useEffect, useState } from 'react';
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar';
import type { View } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { useCalendarEvents, useCalendarLoading, setCalendarEvents, setCalendarLoading } from '../../store';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales: { 'en-US': enUS },
});

const TEST_EVENTS = [
  {
    id: '1',
    title: 'Team Meeting',
    start: new Date(2026, 4, 19, 10, 0),
    end: new Date(2026, 4, 19, 11, 0),
  },
  {
    id: '2',
    title: 'Project Review',
    start: new Date(2026, 4, 21, 14, 0),
    end: new Date(2026, 4, 21, 15, 30),
  },
  {
    id: '3',
    title: 'All-day Conference',
    start: new Date(2026, 4, 22),
    end: new Date(2026, 4, 23),
    allDay: true,
  },
  {
    id: '4',
    title: 'Sprint Planning',
    start: new Date(2026, 4, 26, 9, 0),
    end: new Date(2026, 4, 26, 10, 30),
  },
];

export default function CalendarView() {
  const events = useCalendarEvents();
  const loading = useCalendarLoading();
  const [view, setView] = useState<View>(Views.MONTH);
  const [date, setDate] = useState(new Date());

  useEffect(() => {
    if (events !== null) return;

    setCalendarLoading(true);
    const timer = setTimeout(() => {
      setCalendarEvents(TEST_EVENTS);
    }, 2000);
    return () => clearTimeout(timer);
  }, [events]);

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
            onView={(v) => setView(v)}
            onNavigate={(d) => setDate(new Date(d))}
            style={{ height: '100%' }}
            popup
          />
        </div>
      )}
    </div>
  );
}
