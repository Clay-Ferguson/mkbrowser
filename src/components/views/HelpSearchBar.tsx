import { useEffect, useEffectEvent, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { useIsActiveView } from '../../store';
import { isKeyForOverlay } from '../../renderer/overlayDom';
import { BUTTON_CLASS_SM_BLUE, BUTTON_CLASS_SM_NEUTRAL, DLG_INPUT_CLASS_ALT_COMPACT } from '../../renderer/styles';
import { findTextRanges } from '../../renderer/textRanges';

/** CSS Custom Highlight names; styled in `src/index.css`. */
const ALL_MATCHES = 'help-search';
const CURRENT_MATCH = 'help-search-current';

interface HelpSearchBarProps {
  /** The rendered guide's container: the only subtree searched. */
  rootRef: RefObject<HTMLElement | null>;
}

function clearHighlights(): void {
  CSS.highlights.delete(ALL_MATCHES);
  CSS.highlights.delete(CURRENT_MATCH);
}

/**
 * Highlights every match, marks `matches[index]` as the current one, and scrolls it into view.
 * Both priorities sit above the default 0 of 'global-search', so a global search highlight
 * never paints over the Help search's current match.
 */
function showMatch(matches: Range[], index: number): void {
  const match = matches[index];
  if (!match) {
    clearHighlights();
    return;
  }
  const all = new Highlight(...matches);
  all.priority = 1;
  const current = new Highlight(match);
  current.priority = 2;
  CSS.highlights.set(ALL_MATCHES, all);
  CSS.highlights.set(CURRENT_MATCH, current);
  // parentElement also covers text inside mermaid SVG, whose parent is an SVG <text> element.
  match.startContainer.parentElement?.scrollIntoView({ block: 'center' });
}

const ARROW_HINT = 'Tip: the Left/Right arrow keys also work';
const PREV_TITLE = `Go to the previous match\n\n${ARROW_HINT}`;
const NEXT_TITLE = `Go to the next match\n\n${ARROW_HINT}`;

/**
 * True when an arrow key should keep its normal meaning: it was already consumed, carries a
 * modifier (e.g. Alt+Left history, Shift+arrow selection), or is aimed at a text field
 * (the search input included, so its caret still moves), a CodeMirror editor, or a dialog/menu.
 */
function isArrowForSomethingElse(e: globalThis.KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return true;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || t.closest('input,textarea,select,[contenteditable]'))) return true;
  return isKeyForOverlay(e);
}

/**
 * The search step (+1 / -1) for a document keydown, or 0 when the key isn't one: Left/Right
 * anywhere in the tab (see isArrowForSomethingElse), and Enter / Shift+Enter only while focus
 * is inside the rendered guide, but not on a link or button there, whose Enter activates it.
 */
function stepForKey(e: globalThis.KeyboardEvent, root: HTMLElement | null): number {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (isArrowForSomethingElse(e)) return 0;
    return e.key === 'ArrowLeft' ? -1 : 1;
  }
  if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return 0;
  const t = e.target;
  if (!root || !(t instanceof Node) || !root.contains(t)) return 0;
  if (t instanceof Element && t.closest('a,button,input,textarea,select,[contenteditable]')) return 0;
  return e.shiftKey ? -1 : 1;
}

function countLabel(searchedQuery: string | null, matchCount: number, index: number): string {
  if (searchedQuery === null) return '';
  if (matchCount === 0) return 'No matches';
  return `${index + 1} / ${matchCount}`;
}

/**
 * Find-in-page for the Help tab: a case-insensitive substring search over the rendered guide,
 * highlighted with the CSS Custom Highlight API (no DOM changes, so the guide never re-renders).
 * The guide is static once loaded, so the live Ranges stay valid until the next search.
 * In the input, Enter searches and Escape clears. A search that finds matches moves focus to the
 * guide, where Enter / Shift+Enter and the Left/Right arrows step forward/back through them.
 */
export default function HelpSearchBar({ rootRef }: HelpSearchBarProps) {
  const [query, setQuery] = useState('');
  // The text `matches` was built from; null when no search is in effect.
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const [matches, setMatches] = useState<Range[]>([]);
  const [index, setIndex] = useState(0);

  // Hygiene only: views never unmount, but don't leave stale highlights registered if this one does.
  useEffect(() => clearHighlights, []);

  const runSearch = () => {
    const root = rootRef.current;
    const found = query && root ? findTextRanges(root, query) : [];
    setMatches(found);
    setIndex(0);
    setSearchedQuery(query || null);
    showMatch(found, 0);
    // Hand focus to the guide so the arrow keys and Enter step through matches right away.
    // On no match it stays in the input so the text can be corrected. preventScroll keeps
    // the match showMatch just scrolled to.
    if (found.length > 0) root?.focus({ preventScroll: true });
  };

  const step = (delta: number) => {
    if (matches.length === 0) return;
    const next = (index + delta + matches.length) % matches.length;
    setIndex(next);
    showMatch(matches, next);
  };

  // Left/Right arrows mirror Prev/Next anywhere in the Help tab, and Enter / Shift+Enter do so
  // inside the guide. The listener is on the document (focus can be on <body>) and attached
  // only while this tab is shown.
  // See: (docs/technical_notes/application_tabs.md#hidden-views-are-live)
  const isActive = useIsActiveView('help');
  const arrowEvent = useEffectEvent((e: globalThis.KeyboardEvent) => {
    if (matches.length === 0) return;
    const delta = stepForKey(e, rootRef.current);
    if (delta === 0) return;
    e.preventDefault();
    step(delta);
  });
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: globalThis.KeyboardEvent) => arrowEvent(e);
    document.addEventListener('keydown', handler);
    // Returns the useEffect cleanup: removes the document 'keydown' listener when the tab hides.
    return () => document.removeEventListener('keydown', handler);
  }, [isActive]);

  const clear = () => {
    setQuery('');
    setMatches([]);
    setIndex(0);
    setSearchedQuery(null);
    clearHighlights();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch();
    } else if (e.key === 'Escape') {
      // preventDefault also tells App's document-level Escape handler this key was consumed.
      e.preventDefault();
      clear();
    }
  };

  const noMatches = matches.length === 0;

  return (
    <div className="flex items-center gap-2" data-testid="help-search">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search Help…"
        spellCheck={false}
        className={`${DLG_INPUT_CLASS_ALT_COMPACT} flex-1 min-w-0`}
        data-testid="help-search-input"
      />
      <button type="button" onClick={runSearch} className={BUTTON_CLASS_SM_BLUE} data-testid="help-search-button">
        Search
      </button>
      <button type="button" onClick={() => step(-1)} disabled={noMatches} title={PREV_TITLE} className={BUTTON_CLASS_SM_NEUTRAL} data-testid="help-search-prev">
        Prev
      </button>
      <button type="button" onClick={() => step(1)} disabled={noMatches} title={NEXT_TITLE} className={BUTTON_CLASS_SM_NEUTRAL} data-testid="help-search-next">
        Next
      </button>
      <span className="w-20 shrink-0 text-sm text-slate-400 whitespace-nowrap" aria-live="polite" data-testid="help-search-count">
        {countLabel(searchedQuery, matches.length, index)}
      </span>
    </div>
  );
}
