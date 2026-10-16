import { escapeRegexLiteral } from '../shared/pathPattern';

/** CodeMirror's DOM, which text-range searches skip: the editor highlights matches with its own search. */
export const EDITOR_SELECTOR = '.cm-editor';

/**
 * Subtrees searches never enter: CodeMirror editors, and KaTeX's MathML copy of each formula,
 * which is visually hidden (it exists for screen readers), so a match there could not be seen.
 */
const SKIP_SELECTOR = `${EDITOR_SELECTOR}, .katex-mathml`;

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA']);

/**
 * Elements whose text is a separate run from the text around them, so a match never joins the
 * end of one to the start of the next (a heading "Tips" followed by a paragraph "Click…" must not
 * match "TipsClick"). HTML tag names are uppercase; the lowercase entries are SVG elements, which
 * keep their case: mermaid diagrams put each label in a `<text>` and each label line in a `<tspan>`.
 */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'CAPTION', 'DD', 'DETAILS', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
  'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH',
  'THEAD', 'TR', 'UL', 'text', 'tspan',
]);

/** Where a match starts and ends, as (piece index, offset within that piece). */
export interface TextSpan {
  startPiece: number;
  startOffset: number;
  endPiece: number;
  endOffset: number;
}

/**
 * Builds the case-insensitive pattern for a literal search. Each run of whitespace in
 * `searchText` matches any run of whitespace in the page, since a soft line break in the
 * Markdown source reaches the DOM as "\n" but renders as a space. Returns null for text
 * that is empty or only whitespace.
 */
export function buildSearchPattern(searchText: string): RegExp | null {
  if (!searchText.trim()) return null;
  // Matching on the original text (rather than a lowercased copy) keeps match offsets and
  // lengths valid as range offsets: case folding is not length-preserving for every character
  // (e.g. 'İ'.toLowerCase() is two code units), so indices taken from a lowercased string can
  // drift and land mid-character or past the end of the node.
  return new RegExp(searchText.split(/\s+/u).map(escapeRegexLiteral).join('\\s+'), 'giu');
}

/**
 * Finds every match of `pattern` in the concatenation of `pieces` (the text nodes of one run,
 * in order), so a match may start in one piece and end in another. Each match is reported by
 * the piece holding its first character and the piece holding its last.
 */
export function findSpans(pieces: readonly string[], pattern: RegExp): TextSpan[] {
  const bounds: { start: number; end: number }[] = [];
  let text = '';
  for (const piece of pieces) {
    bounds.push({ start: text.length, end: text.length + piece.length });
    text += piece;
  }

  const spans: TextSpan[] = [];
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    // A zero-length match can only arise from an empty search, which buildSearchPattern
    // rejects, but guard anyway so a pathological pattern cannot spin here.
    if (m[0].length === 0) {
      pattern.lastIndex++;
      continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    const startPiece = bounds.findIndex(b => start < b.end);
    const endPiece = bounds.findIndex(b => end <= b.end);
    const startBound = bounds[startPiece];
    const endBound = bounds[endPiece];
    if (!startBound || !endBound) continue;
    spans.push({ startPiece, startOffset: start - startBound.start, endPiece, endOffset: end - endBound.start });
  }
  return spans;
}

/** The nearest block-level ancestor of `node` (see BLOCK_TAGS), or `root` when there is none below it. */
function blockOf(node: Text, root: Node): Node {
  let el = node.parentElement;
  while (el && el !== root && !BLOCK_TAGS.has(el.tagName)) el = el.parentElement;
  return el ?? root;
}

/** Adds a Range to `ranges` for every match of `pattern` across the text nodes of one run. */
function addRunRanges(run: Text[], pattern: RegExp, ranges: Range[]): void {
  if (run.length === 0) return;
  for (const span of findSpans(run.map(n => n.data), pattern)) {
    const startNode = run[span.startPiece];
    const endNode = run[span.endPiece];
    if (!startNode || !endNode) continue;
    const range = document.createRange();
    range.setStart(startNode, span.startOffset);
    range.setEnd(endNode, span.endOffset);
    ranges.push(range);
  }
}

/**
 * Returns a Range for each case-insensitive match of `searchText` under `root`, in document order.
 * Text is matched per run: the consecutive text nodes that share a block-level ancestor, with a
 * `<br>` also ending a run. So a phrase that crosses inline formatting (bold, links, inline code,
 * syntax-highlighting spans) is found, and its Range spans those text nodes, but text in separate
 * blocks is never joined. Script, style, input, and textarea subtrees are skipped so that
 * highlight markers never appear inside editable or code-execution contexts, and so are CodeMirror
 * editors and KaTeX's hidden MathML (see SKIP_SELECTOR). Returns an empty array for empty or
 * whitespace-only `searchText`.
 */
export function findTextRanges(root: Node, searchText: string): Range[] {
  const ranges: Range[] = [];
  const pattern = buildSearchPattern(searchText);
  if (!pattern) return ranges;

  // Set by the filter, which sees every element in document order, when it passes a <br>.
  const pending = { lineBreak: false };
  // Elements are shown to the filter only so a skipped element can REJECT its whole subtree
  // (and so a <br> can be noticed); every other element is SKIPped (descended into but never
  // returned), so nextNode() yields only text nodes.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = node as Element;
      if (SKIP_TAGS.has(el.tagName) || el.matches(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      if (el.tagName === 'BR') pending.lineBreak = true;
      return NodeFilter.FILTER_SKIP;
    },
  });

  let run: Text[] = [];
  let runBlock: Node | null = null;
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.length === 0) continue;
    const block = blockOf(node, root);
    if (block !== runBlock || pending.lineBreak) {
      addRunRanges(run, pattern, ranges);
      run = [];
      runBlock = block;
    }
    pending.lineBreak = false;
    run.push(node);
  }
  addRunRanges(run, pattern, ranges);
  return ranges;
}
