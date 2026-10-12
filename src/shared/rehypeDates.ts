import type { Nodes, Element, ElementContent } from 'hast';
import { DATE_REGEX } from './regexPatterns';

/**
 * Local rehype plugin: date highlighting.
 *
 * Wraps every date token (`MM/DD/YY` or `MM/DD/YYYY`, optionally with a time — the same
 * `DATE_REGEX` the CodeMirror editor highlights with) in `<span class="md-date">` so the
 * rendered view styles dates like the editor does. Styling lives in `src/index.css`.
 *
 * Text inside `code`, `pre`, and `a` is left alone. Run this before rehype-katex: until then
 * remark-math nodes are still `code.language-math` elements, so math is skipped too.
 */

const SKIP_TAGS = new Set(['code', 'pre', 'a']);

export function rehypeDates() {
  return (tree: Nodes) => {
    walk(tree);
  };
}

function walk(node: Nodes): void {
  if (!('children' in node)) return;
  if (node.type === 'element' && SKIP_TAGS.has(node.tagName)) return;

  // Rebuilt only when a text child actually contains a date, so date-free parents keep
  // their original children array.
  let next: ElementContent[] | null = null;
  node.children.forEach((child, i) => {
    const pieces = child.type === 'text' ? splitDates(child.value) : null;
    if (pieces) {
      next ??= node.children.slice(0, i) as ElementContent[];
      next.push(...pieces);
    } else {
      walk(child as Nodes);
      next?.push(child as ElementContent);
    }
  });
  if (next) node.children = next;
}

/** Splits `text` into text and `md-date` span nodes, or returns null when it holds no date. */
function splitDates(text: string): ElementContent[] | null {
  // Cheap pre-check: nearly every text node lacks a slash, so the regex never runs on them.
  if (!text.includes('/')) return null;

  const regex = new RegExp(DATE_REGEX.source, 'g');
  const pieces: ElementContent[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) pieces.push({ type: 'text', value: text.slice(last, match.index) });
    pieces.push(dateSpan(match[0]));
    last = match.index + match[0].length;
  }
  if (pieces.length === 0) return null;
  if (last < text.length) pieces.push({ type: 'text', value: text.slice(last) });
  return pieces;
}

function dateSpan(value: string): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['md-date'] },
    children: [{ type: 'text', value }],
  };
}
