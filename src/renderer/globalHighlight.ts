import { logger } from '../shared/logUtil';
import { EDITOR_SELECTOR, findTextRanges } from './textRanges';

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

/** True when `node` is inside CodeMirror's DOM, which highlight passes skip: the editor opens its own search panel pre-set to the global text. */
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
 *
 * See: (USER_GUIDE.md#search-highlight)
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

/**
 * The subtree a highlight pass should scan. App.tsx keeps every visited view mounted and
 * merely toggles `display`, marking the visible one with `data-active-view`; scanning all of
 * document.body would therefore build ranges for text in views the user cannot see. The
 * observer re-runs the highlight pass whenever that attribute moves, so scoping to the active
 * view is safe. Falls back to document.body before any view wrapper exists (initial load / error screen).
 *
 * See: (docs/technical_notes/application_tabs.md#mounting-and-scroll-position-important)
 */
function highlightRoot(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-active-view]') ?? document.body;
}

/**
 * Registers CSS Custom Highlight ranges for all case-insensitive matches of `searchText`
 * in the active view (see `findTextRanges` for what is skipped), replacing any previously
 * registered 'global-search' highlight. Passing null or an empty string clears the highlight.
 */
function applyGlobalHighlight(searchText: string | null): void {
  CSS.highlights.delete('global-search');
  if (!searchText) return;

  const ranges = findTextRanges(highlightRoot(), searchText);
  logger.debug('[globalHighlight] found', ranges.length, 'matches');

  if (ranges.length > 0) {
    CSS.highlights.set('global-search', new Highlight(...ranges));
  }
}
