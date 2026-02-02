import { Decoration, DecorationSet, ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

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

// Theme for dates
export const dateTheme = EditorView.baseTheme({
  '.cm-date': {
    color: '#4ade80', // green-400
    fontWeight: '500',
    border: '1px solid #4ade80',
    borderRadius: '3px',
    padding: '1px 3px',
  },
});
