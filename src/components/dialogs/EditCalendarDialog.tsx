import { useState } from 'react';
import { clsx } from 'clsx';
import { DayPicker } from 'react-day-picker';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_INPUT_CLASS_ALT_COMPACT } from '../../utils/styles';
// eslint-disable-next-line import/no-unresolved -- resolved via package "exports" map (src/style.css); resolver can't follow it
import 'react-day-picker/style.css';
import { getDueProperty, setDueProperty, getStartProperty, getDurationProperty, setStartProperty, setDurationProperty, getRRuleProperty, setRRuleProperty, parseDueStr, formatDueDate, RRuleProps } from '../../utils/calendar/calendarUtil';

interface EditCalendarDialogProps {
  content: string;
  onSave: (newContent: string) => void;
  onCancel: () => void;
}

const FREQ_OPTIONS = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const;
type Freq = typeof FREQ_OPTIONS[number];
const FREQ_LABELS: Record<Freq, string> = { none: 'No repeat', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
const FREQ_UNITS: Record<Exclude<Freq, 'none'>, string> = { daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' };
const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
type DayCode = typeof DAY_CODES[number];
const END_OPTIONS = ['never', 'until', 'count'] as const;
type EndType = typeof END_OPTIONS[number];
const END_LABELS: Record<EndType, string> = { never: 'Never', until: 'On date', count: 'After N' };

// Narrow free-form strings parsed from front matter back into their finite domains.
const asFreq = (value: string | undefined): Freq =>
  (FREQ_OPTIONS as readonly string[]).includes(value ?? '') ? (value as Freq) : 'none';
const isDayCode = (value: string): value is DayCode => (DAY_CODES as readonly string[]).includes(value);
const asEndType = (value: string): EndType =>
  (END_OPTIONS as readonly string[]).includes(value) ? (value as EndType) : 'never';

function EditCalendarDialog({ content, onSave, onCancel }: EditCalendarDialogProps) {
  const existingDue = getDueProperty(content);
  const [selected, setSelected] = useState<Date | undefined>(
    existingDue ? parseDueStr(existingDue) : new Date()
  );
  const [startTime, setStartTime] = useState<string>(getStartProperty(content) ?? '');
  const [duration, setDuration] = useState<string>(getDurationProperty(content) ?? '');

  const existingRRule = getRRuleProperty(content);
  const [freq, setFreq] = useState<Freq>(asFreq(existingRRule?.freq));
  const [repeatInterval, setRepeatInterval] = useState<string>(existingRRule?.interval ?? '1');
  const [byday, setByday] = useState<DayCode[]>(
    existingRRule?.byday ? existingRRule.byday.split(',').map(d => d.trim()).filter(isDayCode) : []
  );
  const [endType, setEndType] = useState<EndType>(
    existingRRule?.until ? 'until' : existingRRule?.count ? 'count' : 'never'
  );
  const [untilStr, setUntilStr] = useState<string>(existingRRule?.until ?? '');
  const [count, setCount] = useState<string>(existingRRule?.count ?? '');

  const toggleDay = (day: DayCode) => {
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
      const iv = repeatInterval.trim();
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
    <Dialog title={selected ? `Calendar — ${formatDueDate(selected)}` : 'Calendar'} onClose={onCancel}>
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
                className={clsx(DLG_INPUT_CLASS_ALT_COMPACT, 'w-28')}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Duration</label>
              <input
                type="text"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="hrs"
                className={clsx(DLG_INPUT_CLASS_ALT_COMPACT, 'w-16')}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Repeat</label>
              <select
                data-testid="calendar-frequency-type-option"
                value={freq}
                onChange={(e) => { setFreq(asFreq(e.target.value)); setByday([]); setEndType('never'); }}
                className={DLG_INPUT_CLASS_ALT_COMPACT}
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
                    data-testid="calendar-frequency-repeat-option"
                    type="text"
                    maxLength={4}
                    value={repeatInterval}
                    onChange={(e) => setRepeatInterval(e.target.value.replace(/\D/g, ''))}
                    className={clsx(DLG_INPUT_CLASS_ALT_COMPACT, 'w-12')}
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
                        className={clsx(
                          'w-8 h-7 text-xs rounded transition-colors',
                          byday.includes(day)
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600',
                        )}
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
                  onChange={(e) => setEndType(asEndType(e.target.value))}
                  className={DLG_INPUT_CLASS_ALT_COMPACT}
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
                    className={clsx(DLG_INPUT_CLASS_ALT_COMPACT, 'w-28')}
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
                    className={clsx(DLG_INPUT_CLASS_ALT_COMPACT, 'w-12')}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4 mt-2 border-t border-slate-600">
          <button
            type="button"
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="calendar-info-save"
            onClick={handleSave}
            disabled={!selected}
            className={BUTTON_CLASS_DLG_BLUE}
          >
            Save
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export default EditCalendarDialog;
