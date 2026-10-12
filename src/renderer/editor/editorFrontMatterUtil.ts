import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, RangeSet, Prec, StateField, EditorState, EditorSelection, Text } from '@codemirror/state';
import { color } from '@codemirror/theme-one-dark';
import { EDITOR_COLORS } from './editorColors';
import { eachVisibleLine } from './editorViewportUtil';

const frontMatterKeyMark = Decoration.mark({ class: 'cm-front-matter-key' });
const frontMatterValueMark = Decoration.mark({ class: 'cm-front-matter-value' });
const frontMatterDelimMark = Decoration.mark({ class: 'cm-front-matter-delim' });
const frontMatterIdMark = Decoration.mark({ class: 'cm-front-matter-id' });
const hrLineDeco = Decoration.line({ class: 'cm-hr-line' });

// A line that is only `---` or `|||` (allowing surrounding whitespace). Precompiled and
// tested directly against line.text so we avoid the two `.trim()` string allocations per
// line — this runs for every visible line on every keystroke.
const HR_DELIM_RE = /^\s*(?:---|\|\|\|)\s*$/;

// A YAML `key:` at the start of a front-matter line: optional indentation and an optional
// `- ` list-item prefix (group 1), then the key up to its first `:`, which must be followed by
// whitespace or end of line (group 2, colon included). The key can't contain a `:`, so in
// `url: http://x:80` it stops at `url:`. Lines with no match (`  - item`, comments, block-scalar
// continuation) are all value.
const FM_KEY_RE = /^(\s*(?:-\s+)?)([^\s:#][^:]*?:)(?=\s|$)/;

export interface FrontMatterRange {
  /** 1-based line number of the opening `---` (always 1 when present). */
  openLine: number;
  /** 1-based line number of the closing `---`, or 0 if there is no closing delimiter. */
  closeLine: number;
}

// Upper bound on how far past the opening `---` we look for the closing one. Real YAML
// front matter is a handful of lines; without a cap, a document that merely *starts* with
// an `---` horizontal rule (no front matter at all) would scan to EOF on every keystroke.
const MAX_FRONT_MATTER_LINES = 200;

// Memo of the last result, keyed on the doc. CodeMirror's `Text` is immutable, so identity
// is a sound cache key: each keystroke produces a new `Text`, and the several callers below
// (the two plugins, the hide field, the cursor guard) all run against that same instance,
// so they share one scan instead of repeating it.
let cachedDoc: Text | null = null;
let cachedRange: FrontMatterRange | null = null;

// Single source of truth for "does this document start with `---`, and where is the
// matching closing `---`?". Front matter is always top-anchored, so the scan starts at
// line 2 and gives up after MAX_FRONT_MATTER_LINES. Returns null when line 1 is not `---`;
// returns closeLine 0 when there is an opening delimiter but no closing one within the cap
// (common while the user is typing front matter, and for a leading `---` horizontal rule).
export function findFrontMatterRange(doc: Text): FrontMatterRange | null {
  if (doc === cachedDoc) return cachedRange;
  cachedDoc = doc;
  cachedRange = scanFrontMatterRange(doc);
  return cachedRange;
}

function scanFrontMatterRange(doc: Text): FrontMatterRange | null {
  if (doc.line(1).text.trim() !== '---') return null;
  const lastLine = Math.min(doc.lines, MAX_FRONT_MATTER_LINES);
  for (let i = 2; i <= lastLine; i++) {
    if (doc.line(i).text.trim() === '---') return { openLine: 1, closeLine: i };
  }
  return { openLine: 1, closeLine: 0 };
}

/**
 * Builds decorations for the YAML front-matter region at the top of the document.
 * The opening/closing `---` delimiters receive `cm-front-matter-delim` and the `id:`
 * line receives `cm-front-matter-id`. Every other content line is split into its
 * `key:` (`cm-front-matter-key`) and the rest of the line (`cm-front-matter-value`);
 * a line with no key is all value. Returns an empty set when no front matter is present.
 */
export function createFrontMatterDecorations(view: EditorView): DecorationSet {
  return buildFrontMatterDecorations(view.state.doc);
}

/** {@link createFrontMatterDecorations} over a bare doc, so it can be tested without a view. */
export function buildFrontMatterDecorations(doc: Text): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

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
      if (/^\s*id:\s/.test(line.text)) {
        builder.add(line.from, line.to, frontMatterIdMark);
        continue;
      }
      const m = FM_KEY_RE.exec(line.text);
      let valueFrom = line.from;
      if (m) {
        const keyFrom = line.from + m[1]!.length;
        valueFrom = keyFrom + m[2]!.length;
        builder.add(keyFrom, valueFrom, frontMatterKeyMark);
      }
      if (valueFrom < line.to) builder.add(valueFrom, line.to, frontMatterValueMark);
    }
  }

  return builder.finish();
}

function buildHrLineDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // Only decorate the visible viewport; the plugin re-runs on viewportChanged.
  // Line 1 is skipped so the opening front-matter delimiter is not drawn as an <hr>.
  eachVisibleLine(view, (line) => {
    if (line.number > 1 && HR_DELIM_RE.test(line.text)) {
      builder.add(line.from, line.from, hrLineDeco);
    }
  });
  return builder.finish();
}

/**
 * CodeMirror `ViewPlugin` that draws a visual horizontal rule beneath any `---`
 * line outside the front-matter region (line number > 1). Runs at `Prec.highest`
 * so the line decoration renders above other plugins.
 */
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

/**
 * CodeMirror `ViewPlugin` that applies syntax-highlight decorations to the YAML
 * front-matter block at the top of the document. Runs at `Prec.highest` so
 * front-matter styling takes precedence over other plugins.
 */
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

/**
 * `StateField` that collapses the front-matter block to zero height using a
 * `Decoration.replace` block decoration, hiding it from the editor viewport.
 *
 * Block decorations must originate from a `StateField`, not a `ViewPlugin`,
 * because CodeMirror only permits block decorations from state fields.
 */
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
  let changed: boolean = false;
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

// Refuses user edits that would touch the hidden front matter. The atomic range stops at
// the closing line's end, so the newline joining it to the first visible line is outside
// it: Backspace at the top of the visible text would delete that newline, merging `---`
// into the first line and un-hiding the whole block (likewise Ctrl-Backspace, delete-line,
// and Alt-Up line moves). Any typing/deleting/moving change that starts before the first
// visible line is dropped entirely (`false` cancels all of the transaction's changes; the
// cursor guard then clamps the selection back). Only user events are checked, so
// programmatic rewrites of the front matter (external content sync, etc.) still apply.
export const frontMatterEditGuard = EditorState.changeFilter.of((tr) => {
  if (!tr.docChanged) return true;
  if (!tr.isUserEvent('input') && !tr.isUserEvent('delete') && !tr.isUserEvent('move')) return true;
  const end = frontMatterHiddenEnd(tr.startState.doc);
  if (end <= 0) return true;

  let touchesHidden = false;
  tr.changes.iterChangedRanges((fromA) => {
    if (fromA < end) touchesHidden = true;
  });
  return !touchesHidden;
});

/**
 * CodeMirror base theme for front-matter syntax highlighting and `---` HR lines.
 *
 * The Markdown parser reads `key: value` lines above the closing `---` as a setext heading,
 * so the whole block inherits heading color and bold. The front-matter marks run at
 * `Prec.highest`, which makes them the innermost spans, so their own color/weight win:
 * keys show green (keeping the inherited bold) and values reset to the editor's normal text.
 */
export const frontMatterTheme = EditorView.baseTheme({
  '.cm-front-matter-key': {
    color: EDITOR_COLORS.green400,
  },
  '.cm-front-matter-value': {
    color: color.ivory,
    fontWeight: 'normal',
  },
  '.cm-front-matter-delim': {
    color: EDITOR_COLORS.gray400,
    fontWeight: 'normal !important',
  },
  '.cm-front-matter-id': {
    color: EDITOR_COLORS.gray400,
  },
  '.cm-hr-line': {
    borderBottom: '1px solid currentColor',
  },
});
