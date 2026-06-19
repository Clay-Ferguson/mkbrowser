import { Decoration, DecorationSet, ViewPlugin, ViewUpdate, EditorView, hoverTooltip } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { extractTimestamp, getDaysFromToday, formatDaysDisplay } from '../timeUtil';
import { DATE_REGEX } from '../dateRegex';
import { MONO_FONT_STACK } from '../styles';
import { EDITOR_COLORS } from './editorColors';
import { eachVisibleLine } from './editorViewportUtil';

// Decoration for date patterns
export const dateMark = Decoration.mark({ class: 'cm-date' });

// Extract date patterns from text with their positions
// Matches: MM/DD/YYYY, MM/DD/YY, and optionally with HH:MM AM/PM or HH:MM:SS AM/PM
export function extractDates(text: string): { from: number; to: number }[] {
  const dates: { from: number; to: number }[] = [];
  // Build a fresh global instance from the shared source so scanning gets its
  // own stateful lastIndex (see dateRegex.ts for the accepted date shape).
  const regex = new RegExp(DATE_REGEX.source, 'g');
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

  // Only decorate the visible viewport; the plugin re-runs on viewportChanged.
  eachVisibleLine(view, (line) => {
    const dates = extractDates(line.text);
    for (const { from, to } of dates) {
      builder.add(line.from + from, line.from + to, dateMark);
    }
  });

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
    if (lineOffset >= from && lineOffset < to) {
      const dateText = line.text.slice(from, to);
      const timestamp = extractTimestamp(dateText);
      if (!Number.isNaN(timestamp)) {
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
    color: EDITOR_COLORS.green400,
    fontWeight: '500',
    border: `1px solid ${EDITOR_COLORS.green400}`,
    borderRadius: '3px',
    padding: '1px 3px',
  },
  '.cm-tooltip.cm-tooltip-hover .cm-date-tooltip': {
    backgroundColor: EDITOR_COLORS.tooltipBg,
    color: EDITOR_COLORS.tooltipFg,
    border: `1px solid ${EDITOR_COLORS.tooltipBorder}`,
    borderRadius: '4px',
    padding: '6px 8px',
    marginBottom: '4px',
    fontSize: '16px',
    fontFamily: MONO_FONT_STACK,
  },
});
