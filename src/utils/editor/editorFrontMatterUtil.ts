import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, RangeSet, Prec, StateField, EditorState, EditorSelection, Text } from '@codemirror/state';

const frontMatterMark = Decoration.mark({ class: 'cm-front-matter' });
const frontMatterDelimMark = Decoration.mark({ class: 'cm-front-matter-delim' });
const frontMatterIdMark = Decoration.mark({ class: 'cm-front-matter-id' });
const hrLineDeco = Decoration.line({ class: 'cm-hr-line' });

export function createFrontMatterDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  const firstLine = doc.line(1);
  const hasFrontMatter = firstLine.text.trim() === '---';

  let closingLineNumber = -1;
  if (hasFrontMatter) {
    for (let i = 2; i <= doc.lines; i++) {
      if (doc.line(i).text.trim() === '---') { closingLineNumber = i; break; }
    }
  }

  // Apply decorations in document order (required by RangeSetBuilder)
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.text.trim() === '---') {
      if (hasFrontMatter && (i === 1 || i === closingLineNumber)) {
        builder.add(line.from, line.to, frontMatterDelimMark);
      }
    } else if (hasFrontMatter && closingLineNumber > 0 && i > 1 && i < closingLineNumber) {
      // Decorate front matter content lines
      const mark = /^\s*id:\s/.test(line.text) ? frontMatterIdMark : frontMatterMark;
      builder.add(line.from, line.to, mark);
    }
  }

  return builder.finish();
}

function buildHrLineDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  for (let i = 2; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.text.trim() === '---') builder.add(line.from, line.from, hrLineDeco);
  }
  return builder.finish();
}

export const hrLinePlugin = Prec.highest(ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildHrLineDecorations(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildHrLineDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
));

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
  if (firstLine.text.trim() !== '---') return builder.finish();

  let closingLine: ReturnType<typeof doc.line> | null = null;
  for (let i = 2; i <= doc.lines; i++) {
    if (doc.line(i).text.trim() === '---') { closingLine = doc.line(i); break; }
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

// Returns the document position just past the hidden front matter (the start of the
// first visible line), or -1 if there is no front matter to hide. Mirrors the range
// computed in buildFrontMatterHideDecorations so the cursor guard can never drift from
// what is actually hidden.
export function frontMatterHiddenEnd(doc: Text): number {
  const firstLine = doc.line(1);
  if (firstLine.text.trim() !== '---') return -1;
  for (let i = 2; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.text.trim() === '---') {
      return line.number < doc.lines ? line.to + 1 : line.to;
    }
  }
  return -1;
}

// Treat the hidden front-matter region as a single atomic unit so arrow-key motion,
// backspace, and delete skip over it instead of dropping the cursor into hidden text.
// Reuses the exact range set produced by frontMatterHideField.
export const frontMatterAtomicRanges = EditorView.atomicRanges.of(
  (view) => view.state.field(frontMatterHideField, false) ?? RangeSet.empty
);

// Safety net for selections that are set directly rather than via cursor motion
// (Ctrl-Home, a click in the collapsed gap, Ctrl-A): clamp every selection endpoint so
// it can never land before the first visible line.
export const frontMatterCursorGuard = EditorState.transactionFilter.of((tr) => {
  const end = frontMatterHiddenEnd(tr.newDoc);
  if (end <= 0) return tr;

  const sel = tr.newSelection;
  let changed = false;
  const ranges = sel.ranges.map((r) => {
    if (r.anchor < end || r.head < end) {
      changed = true;
      return EditorSelection.range(Math.max(r.anchor, end), Math.max(r.head, end));
    }
    return r;
  });
  if (!changed) return tr;

  return [tr, { selection: EditorSelection.create(ranges, sel.mainIndex) }];
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
  '.cm-hr-line': {
    borderBottom: '1px solid currentColor',
  },
});
