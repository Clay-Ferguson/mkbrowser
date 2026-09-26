import { logger } from '../shared/logUtil';
import { escapeRegexLiteral } from '../shared/pathPattern';

// Module-private so `setGlobalHighlightText` stays the only write path: it owns the
// MutationObserver / rAF lifecycle that keeps the highlight in sync with the DOM, and a
// direct assignment from outside would leave that lifecycle out of step with the text.
let _highlightText: string | null = null;

let _observer: MutationObserver | null = null;
let _rafId: number | null = null;

/** The active global search text, or null when no global highlight is in effect. */
export function getGlobalHighlightText(): string | null {
  return _highlightText;
}

/**
 * Coalesces rapid successive highlight requests into a single rAF callback so
 * that a burst of DOM mutations (e.g. a React re-render) does not trigger
 * redundant highlight passes in the same frame.
 */
function scheduleHighlight() {
  if (_rafId !== null) return;
  _rafId = requestAnimationFrame(() => {
    _rafId = null;
    applyGlobalHighlight(_highlightText);
  });
}

/** CodeMirror's DOM, which highlight passes skip: the editor opens its own search panel pre-set to the global text. */
const EDITOR_SELECTOR = '.cm-editor';

function isInsideEditor(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return !!el?.closest(EDITOR_SELECTOR);
}

/**
 * Observer callback. Mutations entirely inside a CodeMirror editor (every keystroke, and
 * every scroll that renders new lines) are ignored, since passes skip editor text anyway;
 * opening or closing an editor mutates its parent, which is outside, so that still counts.
 */
function onMutations(records: MutationRecord[]) {
  if (records.some(r => !isInsideEditor(r.target))) scheduleHighlight();
}

/**
 * Sets the active global search text and manages the MutationObserver that keeps
 * highlights in sync as the DOM changes. Schedules an immediate highlight pass, then
 * re-highlights whenever the document body mutates (e.g. after React renders new entries,
 * loads file content, or opens/closes an editor) or the active view changes. This observer
 * is the only mechanism that re-applies the highlight; no caller needs to trigger a pass.
 * Passing null (or an empty string) clears the CSS Custom Highlight and disconnects the observer.
 */
export function setGlobalHighlightText(text: string | null) {
  _highlightText = text;

  if (text) {
    if (!_observer) {
      _observer = new MutationObserver(onMutations);
      // `data-active-view` is watched because switching back to an already-mounted view
      // only moves that attribute (App.tsx toggles `display`); no child nodes change.
      _observer.observe(document.body, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['data-active-view'],
      });
    }
    scheduleHighlight();
  } else {
    if (_observer) {
      _observer.disconnect();
      _observer = null;
    }
    if (_rafId !== null) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    CSS.highlights.delete('global-search');
  }
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA']);

/**
 * The subtree a highlight pass should scan. App.tsx keeps every visited view mounted and
 * merely toggles `display`, marking the visible one with `data-active-view`; scanning all of
 * document.body would therefore build ranges for text in views the user cannot see. The
 * observer re-runs the highlight pass whenever that attribute moves, so scoping to the active
 * view is safe. Falls back to document.body before any view wrapper exists (initial load / error screen).
 */
function highlightRoot(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-active-view]') ?? document.body;
}

/**
 * Walks every visible text node in the active view and registers CSS Custom Highlight
 * ranges for all case-insensitive matches of `searchText`. Replaces any previously
 * registered 'global-search' highlight. Script, style, input, and textarea subtrees are
 * skipped so that highlight markers never appear inside editable or code-execution
 * contexts, and so are CodeMirror editors, which highlight matches with their own search. Passing null or an empty string clears the highlight and returns immediately.
 */
function applyGlobalHighlight(searchText: string | null): void {
  // logger.log('[globalHighlight] called, searchText:', searchText);
  // logger.log('[globalHighlight] CSS.highlights available:', typeof CSS !== 'undefined' && 'highlights' in CSS);

  CSS.highlights.delete('global-search');
  if (!searchText) return;

  const ranges: Range[] = [];
  // Matching on the original text (rather than a lowercased copy) keeps match offsets and
  // lengths valid as range offsets: case folding is not length-preserving for every character
  // (e.g. 'İ'.toLowerCase() is two code units), so indices taken from a lowercased string can
  // drift and land mid-character or past the end of the node.
  const pattern = new RegExp(escapeRegexLiteral(searchText), 'giu');
  let nodeCount = 0;
  // Elements are shown to the filter only so a skipped element can REJECT its whole subtree;
  // every other element is SKIPped (descended into but never returned), so nextNode() yields
  // only text nodes.
  const walker = document.createTreeWalker(highlightRoot(), NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = node as Element;
      if (SKIP_TAGS.has(el.tagName) || el.matches(EDITOR_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_SKIP;
    },
  });

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    nodeCount++;
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

  logger.debug('[globalHighlight] scanned', nodeCount, 'text nodes, found', ranges.length, 'matches');

  if (ranges.length > 0) {
    CSS.highlights.set('global-search', new Highlight(...ranges));
    // logger.log('[globalHighlight] Highlight registered with', ranges.length, 'ranges');
  }
}
