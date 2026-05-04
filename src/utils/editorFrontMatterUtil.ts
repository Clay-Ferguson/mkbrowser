import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, Prec } from '@codemirror/state';

const frontMatterMark = Decoration.mark({ class: 'cm-front-matter' });
const frontMatterIdMark = Decoration.mark({ class: 'cm-front-matter-id' });

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
  builder.add(firstLine.from, firstLine.to, frontMatterMark);
  for (let i = 2; i < closingLine.number; i++) {
    const line = doc.line(i);
    // Match lines like "id: ..." or "  id: ..." — show ID field in gray to de-emphasize it
    const mark = /^\s*id:\s/.test(line.text) ? frontMatterIdMark : frontMatterMark;
    builder.add(line.from, line.to, mark);
  }
  builder.add(closingLine.from, closingLine.to, frontMatterMark);

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

export const frontMatterTheme = EditorView.baseTheme({
  '.cm-front-matter': {
    color: '#4ade80', // green-400
  },
  '.cm-front-matter-id': {
    color: '#9ca3af', // gray-400
  },
});
