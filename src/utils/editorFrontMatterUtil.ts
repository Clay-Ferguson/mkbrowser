import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, Prec, StateField, EditorState } from '@codemirror/state';

const frontMatterMark = Decoration.mark({ class: 'cm-front-matter' });
const frontMatterDelimMark = Decoration.mark({ class: 'cm-front-matter-delim' });
const frontMatterIdMark = Decoration.mark({ class: 'cm-front-matter-id' });
const frontMatterClosingLine = Decoration.line({ class: 'cm-front-matter-closing' });

export function createFrontMatterDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  const firstLine = doc.line(1);
  if (firstLine.text !== '---') return builder.finish();

  let closingLine: typeof firstLine | null = null;
  for (let i = 2; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.text === '---') {
      closingLine = line;
      break;
    }
  }

  if (!closingLine) return builder.finish();

  // Decorate line by line so ID lines get a different style
  builder.add(firstLine.from, firstLine.to, frontMatterDelimMark);
  for (let i = 2; i < closingLine.number; i++) {
    const line = doc.line(i);
    // Match lines like "id: ..." or "  id: ..." — show ID field in gray to de-emphasize it
    const mark = /^\s*id:\s/.test(line.text) ? frontMatterIdMark : frontMatterMark;
    builder.add(line.from, line.to, mark);
  }
  // line decoration must be added at the line's `from` position
  builder.add(closingLine.from, closingLine.from, frontMatterClosingLine);
  builder.add(closingLine.from, closingLine.to, frontMatterDelimMark);

  return builder.finish();
}

export const frontMatterPlugin = Prec.highest(ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = createFrontMatterDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = createFrontMatterDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
));

function buildFrontMatterHideDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  const firstLine = doc.line(1);
  if (firstLine.text !== '---') return builder.finish();

  let closingLine: ReturnType<typeof doc.line> | null = null;
  for (let i = 2; i <= doc.lines; i++) {
    if (doc.line(i).text === '---') { closingLine = doc.line(i); break; }
  }
  if (!closingLine) return builder.finish();

  // Include the trailing newline so the closing --- doesn't leave a blank line
  const endPos = closingLine.number < doc.lines ? closingLine.to + 1 : closingLine.to;
  builder.add(firstLine.from, endPos, Decoration.replace({ block: true }));
  return builder.finish();
}

// Block decorations must come from a StateField, not a ViewPlugin
export const frontMatterHideField = StateField.define<DecorationSet>({
  create(state) { return buildFrontMatterHideDecorations(state); },
  update(deco, tr) {
    return tr.docChanged ? buildFrontMatterHideDecorations(tr.state) : deco.map(tr.changes);
  },
  provide(field) { return EditorView.decorations.from(field); },
});

export const frontMatterTheme = EditorView.baseTheme({
  '.cm-front-matter': {
    color: '#4ade80', // green-400
  },
  '.cm-front-matter-delim': {
    color: '#9ca3af', // gray-400
    fontWeight: 'normal !important',
  },
  '.cm-front-matter-id': {
    color: '#9ca3af', // gray-400
  },
  '.cm-front-matter-closing': {
    borderBottom: '1px dotted #4ade80', // green-400
  },
});
