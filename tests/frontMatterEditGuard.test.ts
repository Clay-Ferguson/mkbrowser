/**
 * The hidden-front-matter edit guard: with Properties hidden, user edits at the top of the
 * visible text must not reach into the hidden block (e.g. Backspace eating the newline after
 * the closing `---`, which would merge it into the first line and un-hide the front matter).
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TransactionSpec } from '@codemirror/state';
import { frontMatterCursorGuard, frontMatterEditGuard, frontMatterHiddenEnd } from '../src/renderer/editor/editorFrontMatterUtil';

const DOC = '---\nid: abc\ntags: [x]\n---\nFirst line\nSecond line\n';
const END = frontMatterHiddenEnd(EditorState.create({ doc: DOC }).doc); // start of "First line"

function hiddenState(doc = DOC): EditorState {
  return EditorState.create({ doc, extensions: [frontMatterCursorGuard, frontMatterEditGuard] });
}

function apply(state: EditorState, spec: TransactionSpec): EditorState {
  return state.update(spec).state;
}

describe('frontMatterEditGuard', () => {
  it('ignores Backspace at the start of the first visible line', () => {
    const state = hiddenState();
    const next = apply(state, { changes: { from: END - 1, to: END }, selection: { anchor: END - 1 }, userEvent: 'delete.backward' });
    expect(next.doc.toString()).toBe(DOC);
    expect(next.selection.main.head).toBe(END);
  });

  it('ignores a line move that would swap the first visible line with the closing `---`', () => {
    const state = hiddenState();
    const closeFrom = state.doc.line(4).from;
    const next = apply(state, {
      changes: { from: closeFrom, to: state.doc.line(5).to, insert: 'First line\n---' },
      userEvent: 'move.line',
    });
    expect(next.doc.toString()).toBe(DOC);
  });

  it('still allows typing and deleting in the visible text', () => {
    const state = hiddenState();
    const typed = apply(state, { changes: { from: END, insert: 'X' }, userEvent: 'input.type' });
    expect(typed.doc.toString()).toBe(DOC.replace('First', 'XFirst'));
    const deleted = apply(typed, { changes: { from: END, to: END + 1 }, userEvent: 'delete.forward' });
    expect(deleted.doc.toString()).toBe(DOC);
  });

  it('lets programmatic (non-user) edits rewrite the hidden front matter', () => {
    const state = hiddenState();
    const next = apply(state, { changes: { from: 0, to: END, insert: '---\nid: abc\n---\n' } });
    expect(next.doc.toString()).toBe('---\nid: abc\n---\nFirst line\nSecond line\n');
  });

  it('does nothing when the document has no front matter', () => {
    const state = hiddenState('First line\nSecond line\n');
    const next = apply(state, { changes: { from: 10, to: 11 }, userEvent: 'delete.backward' });
    expect(next.doc.toString()).toBe('First lineSecond line\n');
  });
});
