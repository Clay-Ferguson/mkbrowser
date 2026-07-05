import { logger } from '../shared/logUtil';

export let globalHighlightText: string| null = null;

let _observer: MutationObserver | null = null;
let _rafId: number | null = null;

/**
 * Coalesces rapid successive highlight requests into a single rAF callback so
 * that a burst of DOM mutations (e.g. a React re-render) does not trigger
 * redundant highlight passes in the same frame.
 */
function scheduleHighlight() {
  if (_rafId !== null) return;
  _rafId = requestAnimationFrame(() => {
    _rafId = null;
    applyGlobalHighlight(globalHighlightText);
  });
}

/**
 * Sets the active global search text and manages the MutationObserver that keeps
 * highlights in sync as the DOM changes. Schedules an immediate highlight pass, then
 * re-highlights whenever the document body mutates (e.g. after React renders new entries).
 * Passing null (or an empty string) clears the CSS Custom Highlight and disconnects the observer.
 */
export function setGlobalHighlightText(text: string | null) {
  globalHighlightText = text;

  if (text) {
    if (!_observer) {
      _observer = new MutationObserver(scheduleHighlight);
      _observer.observe(document.body, { childList: true, subtree: true, characterData: true });
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
 * Walks every visible text node in the document body and registers CSS Custom Highlight
 * ranges for all case-insensitive matches of `searchText`. Replaces any previously
 * registered 'global-search' highlight. Script, style, input, and textarea nodes are
 * skipped so that highlight markers never appear inside editable or code-execution
 * contexts. Passing null or an empty string clears the highlight and returns immediately.
 */
export function applyGlobalHighlight(searchText: string | null): void {
  // logger.log('[globalHighlight] called, searchText:', searchText);
  // logger.log('[globalHighlight] CSS.highlights available:', typeof CSS !== 'undefined' && 'highlights' in CSS);

  CSS.highlights.delete('global-search');
  if (!searchText) return;

  const ranges: Range[] = [];
  const lower = searchText.toLowerCase();
  let nodeCount = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    nodeCount++;
    const text = node.textContent;
    const lowerText = text.toLowerCase();
    let idx = 0;
    while ((idx = lowerText.indexOf(lower, idx)) !== -1) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + searchText.length);
      ranges.push(range);
      idx += searchText.length;
    }
  }

  logger.debug('[globalHighlight] scanned', nodeCount, 'text nodes, found', ranges.length, 'matches');

  if (ranges.length > 0) {
    CSS.highlights.set('global-search', new Highlight(...ranges));
    // logger.log('[globalHighlight] Highlight registered with', ranges.length, 'ranges');
  }
}
