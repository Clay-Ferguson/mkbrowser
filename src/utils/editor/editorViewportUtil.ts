import { EditorView } from '@codemirror/view';
import { Line } from '@codemirror/state';

/**
 * Invoke `cb` for each document line that intersects the editor's visible viewport.
 *
 * Lines are visited in ascending document order (and `view.visibleRanges` are
 * themselves ordered), so callers that feed a `RangeSetBuilder` may `builder.add(...)`
 * directly from the callback without violating the builder's ascending-position contract.
 */
export function eachVisibleLine(view: EditorView, cb: (line: Line) => void): void {
  const doc = view.state.doc;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      cb(line);
    }
  }
}
