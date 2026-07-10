import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { eachVisibleLine } from './editorViewportUtil';
import { frontMatterEndLine } from './editorFrontMatterUtil';

/**
 * FEATURE FLAG: when true, Markdown heading lines (`# `, `## `, ... `###### `)
 * render at a larger font size in the CodeMirror editor, scaled by heading level.
 * Set to false to disable the behavior entirely (headings render as plain lines).
 */
export const ENABLE_HEADING_SIZES = true;

// One reusable line decoration per heading level (1..6). Levels 5-6 share the
// smallest size bump via CSS below, but each still gets its own class for clarity.
const headingLineDecos = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ class: `cm-md-heading cm-md-heading-${level}` })
);

// ATX heading: 1-6 `#` chars at line start followed by a space (or tab). No leading
// whitespace allowed — indented `#` is code/quote content, not a heading. Precompiled
// and tested directly against line.text; this runs per visible line per keystroke.
const HEADING_RE = /^(#{1,6})[ \t]/;

function buildHeadingDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // Lines inside the YAML front-matter block are never headings (`#` is a YAML comment).
  const fmEnd = frontMatterEndLine(view.state.doc);
  // Only decorate the visible viewport; the plugin re-runs on viewportChanged.
  eachVisibleLine(view, (line) => {
    if (line.number <= fmEnd) return;
    const m = HEADING_RE.exec(line.text);
    const deco = m ? headingLineDecos[m[1]!.length - 1] : undefined;
    if (deco) {
      builder.add(line.from, line.from, deco);
    }
  });
  return builder.finish();
}

/**
 * CodeMirror `ViewPlugin` that applies per-level font sizing to Markdown ATX
 * heading lines via line decorations + CSS (no widgets, markers stay visible).
 * CodeMirror 6's height map fully supports the resulting variable line heights.
 */
export const headingSizePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildHeadingDecorations(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildHeadingDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

/**
 * Theme for heading line sizing. Uses `em` so sizes scale with the user's editor
 * font-size setting, and a unitless line-height so the line box grows with the
 * font — keeping the clickable box and the visible text coincident (accurate
 * click-to-place-cursor behavior).
 */
export const headingSizeTheme = EditorView.baseTheme({
  '.cm-md-heading': {
    fontWeight: 'bold',
    lineHeight: '1.4',
  },
  '.cm-md-heading-1': { fontSize: '1.6em' },
  '.cm-md-heading-2': { fontSize: '1.45em' },
  '.cm-md-heading-3': { fontSize: '1.3em' },
  '.cm-md-heading-4': { fontSize: '1.15em' },
  '.cm-md-heading-5': { fontSize: '1.05em' },
  '.cm-md-heading-6': { fontSize: '1.05em' },
});

/**
 * The complete heading-size extension bundle, gated by ENABLE_HEADING_SIZES.
 * Spread into the editor's extension list for Markdown documents.
 */
export const headingSizeExtensions = ENABLE_HEADING_SIZES
  ? [headingSizePlugin, headingSizeTheme]
  : [];
