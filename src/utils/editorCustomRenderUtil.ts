import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const hrLineDeco = Decoration.line({ class: 'cm-hr-line' });

function buildHrDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.text === '---') {
      builder.add(line.from, line.from, hrLineDeco);
    }
  }
  return builder.finish();
}

export const customRenderPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildHrDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildHrDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

export const customRenderTheme = EditorView.baseTheme({
  '.cm-hr-line': {
    borderBottom: '1px dotted currentColor',
    display: 'block',
  },
});
