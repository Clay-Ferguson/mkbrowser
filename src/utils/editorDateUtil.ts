import { Decoration, DecorationSet, ViewPlugin, ViewUpdate, EditorView, hoverTooltip } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { extractTimestamp, getDaysFromToday, formatDaysDisplay } from './timeUtil';

// Decoration for date patterns
export const dateMark = Decoration.mark({ class: 'cm-date' });

// Extract date patterns from text with their positions
// Matches: MM/DD/YYYY, MM/DD/YY, and optionally with HH:MM AM/PM or HH:MM:SS AM/PM
export function extractDates(text: string): { from: number; to: number }[] {
  const dates: { from: number; to: number }[] = [];
  // Regex matches:
  // - MM/DD/YYYY or MM/DD/YY (required)
  // - Optionally followed by space and HH:MM AM/PM or HH:MM:SS AM/PM (seconds optional)
  const regex = /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(\d{4}|\d{2})(\s+(0?[1-9]|1[0-2]):[0-5]\d(:[0-5]\d)?\s*[AaPp][Mm])?\b/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    dates.push({
      from: match.index,
      to: match.index + match[0].length,
    });
  }
  return dates;
}

// Create date decorations for a view
export function createDateDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const dates = extractDates(line.text);

    for (const { from, to } of dates) {
      builder.add(line.from + from, line.from + to, dateMark);
    }
  }

  return builder.finish();
}

// ViewPlugin for date highlighting
export const datePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = createDateDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = createDateDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// Hover tooltip extension for dates — shows days-from-today on mouseover
export const dateTooltipExtension = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const lineOffset = pos - line.from;
  const dates = extractDates(line.text);

  for (const { from, to } of dates) {
    if (lineOffset >= from && lineOffset <= to) {
      const dateText = line.text.slice(from, to);
      const timestamp = extractTimestamp(dateText);
      if (timestamp > 0) {
        const days = getDaysFromToday(timestamp);
        const display = formatDaysDisplay(days);
        return {
          pos: line.from + from,
          end: line.from + to,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'cm-date-tooltip';
            dom.textContent = display;
            return { dom };
          },
        };
      }
    }
  }
  return null;
});

// Theme for dates
export const dateTheme = EditorView.baseTheme({
  '.cm-date': {
    color: '#4ade80', // green-400
    fontWeight: '500',
    border: '1px solid #4ade80',
    borderRadius: '3px',
    padding: '1px 3px',
  },
  '.cm-tooltip.cm-tooltip-hover .cm-date-tooltip': {
    backgroundColor: '#166534',
    color: '#f0fdf4',
    border: '1px solid #22c55e',
    borderRadius: '4px',
    padding: '6px 8px',
    marginBottom: '4px',
    fontSize: '16px',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  },
});
