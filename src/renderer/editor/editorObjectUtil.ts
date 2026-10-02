import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { ObjectTemplate } from '../../shared/objects/objectBlock';

/**
 * Builds the change that inserts an object block (see DEVELOPER_GUIDE § "Typed Object Blocks")
 * at the cursor, replacing the selection if there is one.
 *
 * A fenced block has to start on a line of its own, so the block is padded with as many line
 * breaks as it takes to stand apart from the text around it: a blank line before and after,
 * except where the document already supplies one (or begins/ends there). Inserting in the
 * middle of a line therefore splits that line around the block.
 *
 * The cursor is left where the first field's value goes, so the user can start typing.
 */
export function objectInsertion(state: EditorState, template: ObjectTemplate): TransactionSpec {
  const { from, to } = state.selection.main;
  const { doc } = state;
  const startLine = doc.lineAt(from);
  const endLine = doc.lineAt(to);

  const textBefore = doc.sliceString(startLine.from, from);
  const textAfter = doc.sliceString(to, endLine.to);
  const prevLineHasText = startLine.number > 1 && doc.line(startLine.number - 1).text.trim() !== '';
  const nextLineHasText = endLine.number < doc.lines && doc.line(endLine.number + 1).text.trim() !== '';

  // Mid-line: end the current line and leave a blank one. At a line start: a blank line is
  // only missing when the line above has text.
  const before = textBefore.trim() !== '' ? '\n\n' : prevLineHasText ? '\n' : '';
  const after = textAfter.trim() !== '' ? '\n\n' : nextLineHasText ? '\n' : '';

  return {
    changes: { from, to, insert: before + template.text + after },
    selection: { anchor: from + before.length + template.cursorOffset },
    scrollIntoView: true,
  };
}
