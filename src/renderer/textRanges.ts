import { escapeRegexLiteral } from '../shared/pathPattern';

/** CodeMirror's DOM, which text-range searches skip: the editor highlights matches with its own search. */
export const EDITOR_SELECTOR = '.cm-editor';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA']);

/**
 * Walks every text node under `root` and returns a Range for each case-insensitive
 * substring match of `searchText`, in document order. Script, style, input, and textarea
 * subtrees are skipped so that highlight markers never appear inside editable or
 * code-execution contexts, and so are CodeMirror editors. Matches are found per text node,
 * so a match that spans formatting boundaries (e.g. into a `<strong>`) is not found.
 * Returns an empty array for an empty `searchText`.
 */
export function findTextRanges(root: Node, searchText: string): Range[] {
  const ranges: Range[] = [];
  if (!searchText) return ranges;

  // Matching on the original text (rather than a lowercased copy) keeps match offsets and
  // lengths valid as range offsets: case folding is not length-preserving for every character
  // (e.g. 'İ'.toLowerCase() is two code units), so indices taken from a lowercased string can
  // drift and land mid-character or past the end of the node.
  const pattern = new RegExp(escapeRegexLiteral(searchText), 'giu');
  // Elements are shown to the filter only so a skipped element can REJECT its whole subtree;
  // every other element is SKIPped (descended into but never returned), so nextNode() yields
  // only text nodes.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = node as Element;
      if (SKIP_TAGS.has(el.tagName) || el.matches(EDITOR_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_SKIP;
    },
  });

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent;
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      ranges.push(range);
      // A zero-length match can only arise from an empty searchText, which is rejected above,
      // but guard anyway so a pathological pattern cannot spin here.
      if (m[0].length === 0) pattern.lastIndex++;
    }
  }
  return ranges;
}
