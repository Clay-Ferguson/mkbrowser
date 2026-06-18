import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, RangeSet, Prec, StateField, EditorState, EditorSelection, Text } from '@codemirror/state';
import { eachVisibleLine } from './editorViewportUtil';

const frontMatterMark = Decoration.mark({ class: 'cm-front-matter' });
const frontMatterDelimMark = Decoration.mark({ class: 'cm-front-matter-delim' });
const frontMatterIdMark = Decoration.mark({ class: 'cm-front-matter-id' });
const hrLineDeco = Decoration.line({ class: 'cm-hr-line' });

export interface FrontMatterRange {
  /** 1-based line number of the opening `---` (always 1 when present). */
  openLine: number;
  /** 1-based line number of the closing `---`, or 0 if there is no closing delimiter. */
  closeLine: number;
}

// Single source of truth for "does this document start with `---`, and where is the
// matching closing `---`?". Front matter is always top-anchored, so the scan starts at
// line 2. Returns null when line 1 is not `---`; returns closeLine 0 when there is an
// opening delimiter but no closing one (common while the user is typing front matter).
export function findFrontMatterRange(doc: Text): FrontMatterRange | null {
  if (doc.line(1).text.trim() !== '---') return null;
  for (let i = 2; i <= doc.lines; i++) {
    if (doc.line(i).text.trim() === '---') return { openLine: 1, closeLine: i };
  }
  return { openLine: 1, closeLine: 0 };
}

export function createFrontMatterDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  const range = findFrontMatterRange(doc);
  if (!range) return builder.finish();

  const closingLineNumber = range.closeLine;

  // Front matter is always top-anchored, so only scan the front-matter region
  // rather than the whole document. Without a closing delimiter only the opening
  // line 1 is decorated. Apply in document order (required by RangeSetBuilder).
  const lastLine = closingLineNumber > 0 ? closingLineNumber : 1;
  for (let i = 1; i <= lastLine; i++) {
    const line = doc.line(i);
    if (line.text.trim() === '---') {
      if (i === 1 || i === closingLineNumber) {
        builder.add(line.from, line.to, frontMatterDelimMark);
      }
    } else if (closingLineNumber > 0 && i > 1 && i < closingLineNumber) {
      // Decorate front matter content lines
      const mark = /^\s*id:\s/.test(line.text) ? frontMatterIdMark : frontMatterMark;
      builder.add(line.from, line.to, mark);
    }
  }

  return builder.finish();
}

function buildHrLineDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // Only decorate the visible viewport; the plugin re-runs on viewportChanged.
  // Line 1 is skipped so the opening front-matter delimiter is not drawn as an <hr>.
  eachVisibleLine(view, (line) => {
    if (line.number > 1 && line.text.trim() === '---') {
      builder.add(line.from, line.from, hrLineDeco);
    }
  });
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
  const range = findFrontMatterRange(doc);
  if (!range || range.closeLine === 0) return builder.finish();

  const firstLine = doc.line(range.openLine);
  const closingLine = doc.line(range.closeLine);

  // End the block at the closing line's END (line.to), NOT at the start of the next line
  // (closingLine.to + 1). A block-replace must span line-start..line-end; ending it at the
  // next line's start makes block.to coincide with the first visible line's start, and that
  // shared boundary is what breaks active-line highlighting and lets the cursor slip into
  // the hidden region. Ending at closingLine.to keeps block.to strictly before the first
  // visible line, so CodeMirror's stock cursor/active-line logic resolves correctly.
  builder.add(firstLine.from, closingLine.to, Decoration.replace({ block: true }));
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

// Line number (1-based) of the closing `---` front-matter delimiter, or 0 when the
// document has no front matter (no opening delimiter, or no matching closing one).
// Lines 1..N inclusive make up the front-matter region.
export function frontMatterEndLine(doc: Text): number {
  return findFrontMatterRange(doc)?.closeLine ?? 0;
}

// Returns the document position at the start of the first visible line (just past the
// hidden front matter's trailing newline), or -1 if there is no front matter to hide.
// This is the cursor floor: one position past the hide block's end (which stops at the
// closing line's end, closingLine.to), i.e. the start of the first visible line.
export function frontMatterHiddenEnd(doc: Text): number {
  const range = findFrontMatterRange(doc);
  if (!range || range.closeLine === 0) return -1;
  const line = doc.line(range.closeLine);
  return line.number < doc.lines ? line.to + 1 : line.to;
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

  // `sequential: true` makes this appended spec resolve its selection against the
  // document *after* tr's changes (tr.newDoc) rather than the start document. Without
  // it, a selection position computed from tr.newDoc (e.g. just past freshly-inserted
  // front matter) is validated against the original — often empty — document and throws
  // "Position N is out of range for changeset of length 0", which unmounts the editor.
  return [tr, { selection: EditorSelection.create(ranges, sel.mainIndex), sequential: true }];
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
