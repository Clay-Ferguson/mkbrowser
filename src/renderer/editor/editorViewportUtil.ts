import { EditorView } from '@codemirror/view';
import { Line } from '@codemirror/state';

/**
 * Invoke `cb` for each document line that intersects the editor's visible viewport.
 *
 * Each line is visited exactly once, in ascending document order (adjacent visible
 * ranges can both land inside a single line, e.g. around an inline collapsed region;
 * `lastLine` suppresses the repeat). Callers that feed a `RangeSetBuilder` may therefore
 * `builder.add(...)` directly from the callback without violating the builder's
 * ascending-position contract.
 */
export function eachVisibleLine(view: EditorView, cb: (line: Line) => void): void {
  const doc = view.state.doc;
  let lastLine = 0;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number > lastLine) {
        lastLine = line.number;
        cb(line);
      }
    }
  }
}
