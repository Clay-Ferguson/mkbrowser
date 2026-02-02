import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

// Decorations for hashtags
const hashtagP1Mark = Decoration.mark({ class: 'cm-hashtag-p1' });
const hashtagP2Mark = Decoration.mark({ class: 'cm-hashtag-p2' });
const hashtagRegularMark = Decoration.mark({ class: 'cm-hashtag-regular' });

// Extract hashtags from text with their positions
export function extractHashtags(text: string): { tag: string; from: number; to: number }[] {
  const hashtags: { tag: string; from: number; to: number }[] = [];
  // Match hashtags: # followed by word characters (letters, numbers, underscores)
  const regex = /#[a-zA-Z0-9_]+/g;
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

// Create hashtag decorations for a view
export function createHashtagDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
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
  }

  return builder.finish();
}

// ViewPlugin for hashtag highlighting
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

// Theme for hashtags
export const hashtagTheme = EditorView.baseTheme({
  '.cm-hashtag-p1': {
    color: '#fb923c', // orange-400
    fontWeight: '600',
    border: '1px solid #fb923c',
    borderRadius: '3px',
    padding: '1px 3px',
  },
  '.cm-hashtag-p2': {
    color: '#facc15', // yellow-400
    fontWeight: '600',
    border: '1px solid #facc15',
    borderRadius: '3px',
    padding: '1px 3px',
  },
  '.cm-hashtag-regular': {
    color: '#38bdf8', // sky-400 (cyan-blue)
    fontWeight: '500',
    border: '1px solid #38bdf8',
    borderRadius: '3px',
    padding: '1px 3px',
  },
});
