import { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { getDueProperty, setDueProperty } from '../../utils/calendarUtil';

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

function EditCalendarDialog({ content, onSave, onCancel }: EditCalendarDialogProps) {
  const existingDue = getDueProperty(content);
  const [selected, setSelected] = useState<Date | undefined>(
    existingDue ? parseDueStr(existingDue) : undefined
  );

  const handleSave = () => {
    if (!selected) return;
    const dueStr = formatDueDate(selected);
    onSave(setDueProperty(content, dueStr));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg border-2 border-slate-400 p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-100 mb-4">Calendar Info</h2>

        <p className="text-sm text-slate-400 mb-3">Select a due date for this file:</p>

        <div className="flex justify-center mb-4 rdp-slate">
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={setSelected}
            classNames={{
              root: 'text-slate-200',
              month_caption: 'text-slate-200 font-semibold',
              nav: 'text-slate-400',
              button_previous: 'text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded p-1',
              button_next: 'text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded p-1',
              weekdays: 'text-slate-500 text-xs',
              day: 'text-slate-300',
              day_button: 'w-9 h-9 rounded hover:bg-slate-600 transition-colors cursor-pointer',
              selected: 'bg-blue-600 text-white rounded',
              today: 'font-bold text-blue-400',
              outside: 'text-slate-600',
            }}
          />
        </div>

        {selected && (
          <p className="text-sm text-slate-300 text-center mb-4">
            Due: <span className="font-mono text-blue-300">{formatDueDate(selected)}</span>
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!selected}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed rounded transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default EditCalendarDialog;
