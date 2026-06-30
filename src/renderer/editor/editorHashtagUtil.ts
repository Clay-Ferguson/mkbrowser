import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { HASHTAG_REGEX } from '../../shared/regexPatterns';
import { EDITOR_COLORS } from './editorColors';
import { eachVisibleLine } from './editorViewportUtil';

// Decorations for hashtags
const hashtagP1Mark = Decoration.mark({ class: 'cm-hashtag-p1' });
const hashtagP2Mark = Decoration.mark({ class: 'cm-hashtag-p2' });
const hashtagRegularMark = Decoration.mark({ class: 'cm-hashtag-regular' });

/**
 * Scans `text` for hashtag tokens and returns the tag string along with its
 * start/end character offsets within the line. A fresh `RegExp` instance is
 * created each call so the stateful `lastIndex` does not leak between calls.
 */
export function extractHashtags(text: string): { tag: string; from: number; to: number }[] {
  const hashtags: { tag: string; from: number; to: number }[] = [];
  const regex = new RegExp(HASHTAG_REGEX.source, 'g');
  let match;
  while ((match = regex.exec(text)) !== null) {
    hashtags.push({
      tag: match[0],
      from: match.index,
      to: match.index + match[0].length,
    });
  }
  return hashtags;
}

/**
 * Builds a `DecorationSet` that marks every hashtag token in the editor's
 * visible viewport. `#p1` receives a priority-1 mark, `#p2` receives a
 * priority-2 mark, and all other tags receive the regular hashtag mark.
 * Only the visible range is scanned; the plugin re-runs on `viewportChanged`.
 */
export function createHashtagDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  // Only decorate the visible viewport; the plugin re-runs on viewportChanged.
  eachVisibleLine(view, (line) => {
    const hashtags = extractHashtags(line.text);
    for (const { tag, from, to } of hashtags) {
      const lowerTag = tag.toLowerCase();
      let mark: Decoration;

      if (lowerTag === '#p1') {
        mark = hashtagP1Mark;
      } else if (lowerTag === '#p2') {
        mark = hashtagP2Mark;
      } else {
        mark = hashtagRegularMark;
      }

      builder.add(line.from + from, line.from + to, mark);
    }
  });

  return builder.finish();
}

/**
 * CodeMirror `ViewPlugin` that applies hashtag highlight decorations.
 * Rebuilds decorations whenever the document or viewport changes.
 */
export const hashtagPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = createHashtagDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = createHashtagDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

/**
 * CodeMirror base theme that styles `.cm-hashtag-p1` (#p1, orange),
 * `.cm-hashtag-p2` (#p2, yellow), and `.cm-hashtag-regular` (all other tags, sky-blue).
 */
export const hashtagTheme = EditorView.baseTheme({
  '.cm-hashtag-p1': {
    color: EDITOR_COLORS.orange400,
    fontWeight: '600',
    border: `1px solid ${EDITOR_COLORS.orange400}`,
    borderRadius: '3px',
    padding: '1px 3px',
  },
  '.cm-hashtag-p2': {
    color: EDITOR_COLORS.yellow400,
    fontWeight: '600',
    border: `1px solid ${EDITOR_COLORS.yellow400}`,
    borderRadius: '3px',
    padding: '1px 3px',
  },
  '.cm-hashtag-regular': {
    color: EDITOR_COLORS.sky400,
    fontWeight: '500',
    border: `1px solid ${EDITOR_COLORS.sky400}`,
    borderRadius: '3px',
    padding: '1px 3px',
  },
});
