import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, Prec } from '@codemirror/state';

const frontMatterMark = Decoration.mark({ class: 'cm-front-matter' });

export function createFrontMatterDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  const firstLine = doc.line(1);
  if (firstLine.text !== '---') return builder.finish();

  for (let i = 2; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.text === '---') {
      builder.add(firstLine.from, line.to, frontMatterMark);
      break;
    }
  }

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
});
