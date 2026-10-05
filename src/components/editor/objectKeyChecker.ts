import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, type EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { unknownObjectKeys, type UnknownObjectKey } from '../../shared/objects/genericObject';
import type { TypeDefinitions } from '../../shared/shared';
import { getTypeDefs } from '../../store';

/**
 * Flags unknown properties in typed object blocks (DEVELOPER_GUIDE § "Typed Object Blocks"):
 * inside a fenced `yaml` block whose `type` is a user-defined object type (Types Editor), any
 * key the type doesn't define gets a wavy underline — the same idea as a spelling underline, for a typo
 * like `nmae` that the rendered card would otherwise silently drop.
 */

/**
 * Reads a `FencedCode` node as (info string, body text), with a map from offsets in the body
 * back to document positions. Returns null for a fence with no body yet or no closing fence —
 * an unclosed fence swallows the rest of the document, which is never an object block.
 *
 * A fence nested in a list item is indented, and Markdown strips that indentation from the
 * block's content; the same number of leading spaces is stripped here so the body is the text
 * the renderer will actually parse. (A fence inside a blockquote is not handled: its `>`
 * prefixes stay in, the YAML fails to parse, and nothing is flagged.)
 */
function readFencedBlock(state: EditorState, node: SyntaxNode): { info: string; code: string; toDocPos: (offset: number) => number } | null {
  const infoNode = node.getChild('CodeInfo');
  if (!infoNode || node.getChildren('CodeMark').length < 2) return null;

  const { doc } = state;
  const openLine = doc.lineAt(node.from);
  const closeLine = doc.lineAt(node.to);
  if (closeLine.number - openLine.number < 2) return null;
  const indent = node.from - openLine.from;

  // Each body line's start position in the document, after stripping the fence's indentation.
  const lineStarts: number[] = [];
  const lines: string[] = [];
  for (let n = openLine.number + 1; n < closeLine.number; n++) {
    const line = doc.line(n);
    const stripped = Math.min(indent, line.text.length - line.text.trimStart().length);
    lineStarts.push(line.from + stripped);
    lines.push(line.text.slice(stripped));
  }

  // Offsets into `code` (lines joined by '\n') map back line by line.
  const codeStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    codeStarts.push(offset);
    offset += line.length + 1;
  }
  const toDocPos = (codeOffset: number) => {
    let i = codeStarts.length - 1;
    while (i > 0 && (codeStarts[i] ?? 0) > codeOffset) i--;
    return (lineStarts[i] ?? 0) + (codeOffset - (codeStarts[i] ?? 0));
  };

  // The info string's first word is the language, as Markdown renderers read it.
  const info = /\S*/.exec(doc.sliceString(infoNode.from, infoNode.to))?.[0] ?? '';
  return { info, code: lines.join('\n'), toDocPos };
}

/**
 * Finds the unknown object properties in the fenced blocks that intersect `from`–`to`, as
 * document positions in ascending order, checked against `defs`. Relies on the Markdown syntax
 * tree, so it sees what has been parsed so far (the plugin below re-runs as parsing progresses).
 */
export function unknownObjectKeysInRange(state: EditorState, from: number, to: number, defs: TypeDefinitions): UnknownObjectKey[] {
  const found: UnknownObjectKey[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== 'FencedCode') return undefined;
      const block = readFencedBlock(state, node.node);
      if (block) {
        for (const key of unknownObjectKeys(block.info, block.code, defs)) {
          found.push({ ...key, from: block.toDocPos(key.from), to: block.toDocPos(key.to) });
        }
      }
      // Nothing inside a fenced block is itself a fenced block.
      return false;
    },
  });
  return found;
}

/** Underlines the unknown object properties in the visible part of the document. */
function createObjectKeyDecorations(view: EditorView, defs: TypeDefinitions): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // Visible ranges are ascending and disjoint, but one block can straddle two of them; skip
  // anything already added so the builder's ascending-position contract holds.
  let lastEnd = -1;
  for (const { from, to } of view.visibleRanges) {
    for (const key of unknownObjectKeysInRange(view.state, from, to, defs)) {
      if (key.from < lastEnd) continue;
      lastEnd = key.to;
      builder.add(key.from, key.to, Decoration.mark({
        class: 'cm-unknown-object-key',
        attributes: { title: `"${key.key}" is not a ${key.type} property` },
      }));
    }
  }
  return builder.finish();
}

/**
 * CodeMirror `ViewPlugin` that keeps the unknown-property underlines current. Rebuilds when
 * the document or viewport changes, and when the syntax tree does — parsing can finish after
 * the edit that triggered it, and the fenced blocks are read from the tree. The type
 * definitions are read from the store; a change to them is picked up on the next update.
 */
export const objectKeyPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    defs: TypeDefinitions;

    constructor(view: EditorView) {
      this.defs = getTypeDefs();
      this.decorations = createObjectKeyDecorations(view, this.defs);
    }

    update(update: ViewUpdate) {
      const defs = getTypeDefs();
      if (defs !== this.defs || update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.defs = defs;
        this.decorations = createObjectKeyDecorations(update.view, defs);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// Amber rather than the spell checker's red: the word may be spelled perfectly well, it just
// isn't a property of this object type.
export const objectKeyTheme = EditorView.baseTheme({
  '.cm-unknown-object-key': {
    textDecoration: 'underline wavy #f59e0b',
    textDecorationSkipInk: 'none',
  },
});
