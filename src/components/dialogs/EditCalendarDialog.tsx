import { useState } from 'react';
import DlgHeader from './common/DlgHeader';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_OVERLAY_CLASS } from '../../utils/styles';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { getDueProperty, setDueProperty, getStartProperty, getDurationProperty, setStartProperty, setDurationProperty, getRRuleProperty, setRRuleProperty, RRuleProps } from '../../utils/calendarUtil';

interface EditCalendarDialogProps {
  content: string;
  onSave: (newContent: string) => void;
  onCancel: () => void;
}

function parseDueStr(dueStr: string): Date | undefined {
  const parts = dueStr.split('/');
  if (parts.length !== 3) return undefined;
  const month = parseInt(parts[0], 10) - 1;
  const day = parseInt(parts[1], 10);
  let year = parseInt(parts[2], 10);
  if (year < 100) year += 2000;
  const d = new Date(year, month, day);
  return isNaN(d.getTime()) ? undefined : d;
}

function formatDueDate(date: Date): string {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const y = date.getFullYear();
  return `${m}/${d}/${y}`;
}

const FREQ_OPTIONS = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const;
const FREQ_LABELS: Record<string, string> = { none: 'No repeat', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
const FREQ_UNITS: Record<string, string> = { daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' };
const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const END_OPTIONS = ['never', 'until', 'count'] as const;
const END_LABELS: Record<string, string> = { never: 'Never', until: 'On date', count: 'After N' };

function EditCalendarDialog({ content, onSave, onCancel }: EditCalendarDialogProps) {
  const existingDue = getDueProperty(content);
  const [selected, setSelected] = useState<Date | undefined>(
    existingDue ? parseDueStr(existingDue) : undefined
  );
  const [startTime, setStartTime] = useState<string>(getStartProperty(content) ?? '');
  const [duration, setDuration] = useState<string>(getDurationProperty(content) ?? '');

  const existingRRule = getRRuleProperty(content);
  const [freq, setFreq] = useState<string>(existingRRule?.freq ?? 'none');
  const [interval, setInterval] = useState<string>(existingRRule?.interval ?? '1');
  const [byday, setByday] = useState<string[]>(
    existingRRule?.byday ? existingRRule.byday.split(',').map(d => d.trim()) : []
  );
  const [endType, setEndType] = useState<string>(
    existingRRule?.until ? 'until' : existingRRule?.count ? 'count' : 'never'
  );
  const [untilStr, setUntilStr] = useState<string>(existingRRule?.until ?? '');
  const [count, setCount] = useState<string>(existingRRule?.count ?? '');

  const toggleDay = (day: string) => {
    setByday(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  const handleSave = () => {
    if (!selected) return;
    const dueStr = formatDueDate(selected);
    let newContent = setDueProperty(content, dueStr);
    if (startTime.trim()) {
      newContent = setStartProperty(newContent, startTime.trim());
    }
    if (duration.trim()) {
      newContent = setDurationProperty(newContent, duration.trim());
    }
    if (freq && freq !== 'none') {
      const rrule: RRuleProps = { freq };
      const iv = interval.trim();
      if (iv && iv !== '1') rrule.interval = iv;
      if (freq === 'weekly' && byday.length > 0) rrule.byday = byday.join(',');
      if (endType === 'until' && untilStr.trim()) rrule.until = untilStr.trim();
      if (endType === 'count' && count.trim()) rrule.count = count.trim();
      newContent = setRRuleProperty(newContent, rrule);
    } else {
      newContent = setRRuleProperty(newContent, null);
    }
    onSave(newContent);
  };

  return (
    <div className={DLG_OVERLAY_CLASS}>
      <div className="bg-slate-800 rounded-lg border-2 border-slate-400 shadow-xl overflow-hidden">
        <DlgHeader title={selected ? `Calendar — ${formatDueDate(selected)}` : 'Calendar'} onClose={onCancel} />
        <div className="p-6">
        <div className="flex justify-center mb-4 rdp-slate">
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={setSelected}
            classNames={{
              root: 'text-slate-200',
              month_caption: 'text-slate-200 font-semibold',
              nav: 'text-slate-200',
              button_previous: 'text-slate-200 hover:text-white hover:bg-slate-700 rounded p-1 [&_svg]:stroke-slate-200 [&_svg]:fill-slate-200',
              button_next: 'text-slate-200 hover:text-white hover:bg-slate-700 rounded p-1 [&_svg]:stroke-slate-200 [&_svg]:fill-slate-200',
              weekdays: 'text-slate-500 text-xs',
              day: 'text-slate-300',
              day_button: 'w-9 h-9 rounded hover:bg-slate-600 transition-colors cursor-pointer',
              selected: 'bg-blue-600 text-white rounded',
              today: 'font-bold text-blue-400',
              outside: 'text-slate-600',
            }}
          />
        </div>


        <div className="flex flex-col gap-2 mb-4">
          <div className="flex gap-3 items-end">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Start Time</label>
              <input
                type="text"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="e.g. 2:00 PM"
                className="bg-slate-700 text-slate-100 border border-slate-500 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400 w-28"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Duration</label>
              <input
                type="text"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="hrs"
                className="bg-slate-700 text-slate-100 border border-slate-500 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400 w-16"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Repeat</label>
              <select
                value={freq}
                onChange={(e) => { setFreq(e.target.value); setByday([]); setEndType('never'); }}
                className="bg-slate-700 text-slate-100 border border-slate-500 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
              >
                {FREQ_OPTIONS.map(f => (
                  <option key={f} value={f}>{FREQ_LABELS[f]}</option>
                ))}
              </select>
            </div>
            {freq !== 'none' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">Every</label>
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    maxLength={4}
                    value={interval}
                    onChange={(e) => setInterval(e.target.value.replace(/\D/g, ''))}
                    className="bg-slate-700 text-slate-100 border border-slate-500 rounded px-2 py-1 text-sm w-12 focus:outline-none focus:border-blue-400"
                  />
                  <span className="text-xs text-slate-400">{FREQ_UNITS[freq]}</span>
                </div>
              </div>
            )}
          </div>

          {freq !== 'none' && (
            <div className="flex gap-3 items-end">
              {freq === 'weekly' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Days</label>
                  <div className="flex gap-1">
                    {DAY_CODES.map(day => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(day)}
                        className={`w-8 h-7 text-xs rounded transition-colors ${
                          byday.includes(day)
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Ends</label>
                <select
                  value={endType}
                  onChange={(e) => setEndType(e.target.value)}
                  className="bg-slate-700 text-slate-100 border border-slate-500 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-400"
                >
                  {END_OPTIONS.map(o => (
                    <option key={o} value={o}>{END_LABELS[o]}</option>
                  ))}
                </select>
              </div>
              {endType === 'until' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Until date</label>
                  <input
                    type="text"
                    value={untilStr}
                    onChange={(e) => setUntilStr(e.target.value)}
                    placeholder="MM/DD/YYYY"
                    className="bg-slate-700 text-slate-100 border border-slate-500 rounded px-2 py-1 text-sm w-28 focus:outline-none focus:border-blue-400"
                  />
                </div>
              )}
              {endType === 'count' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Count</label>
                  <input
                    type="text"
                    maxLength={4}
                    value={count}
                    onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))}
                    placeholder="N"
                    className="bg-slate-700 text-slate-100 border border-slate-500 rounded px-2 py-1 text-sm w-12 focus:outline-none focus:border-blue-400"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4 mt-2 border-t border-slate-600">
          <button
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!selected}
            className={BUTTON_CLASS_DLG_BLUE}
          >
            Save
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

export default EditCalendarDialog;
