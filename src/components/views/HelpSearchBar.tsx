import { useEffect, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
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

function countLabel(searchedQuery: string | null, matchCount: number, index: number): string {
  if (searchedQuery === null) return '';
  if (matchCount === 0) return 'No matches';
  return `${index + 1} / ${matchCount}`;
}

/**
 * Find-in-page for the Help tab: a case-insensitive substring search over the rendered guide,
 * highlighted with the CSS Custom Highlight API (no DOM changes, so the guide never re-renders).
 * The guide is static once loaded, so the live Ranges stay valid until the next search.
 * Enter searches (or steps to the next match when the text is unchanged), Shift+Enter steps
 * back, and Escape clears.
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
  };

  const step = (delta: number) => {
    if (matches.length === 0) return;
    const next = (index + delta + matches.length) % matches.length;
    setIndex(next);
    showMatch(matches, next);
  };

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
      if (query !== (searchedQuery ?? '')) runSearch();
      else step(e.shiftKey ? -1 : 1);
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
      <button type="button" onClick={() => step(-1)} disabled={noMatches} className={BUTTON_CLASS_SM_NEUTRAL} data-testid="help-search-prev">
        Prev
      </button>
      <button type="button" onClick={() => step(1)} disabled={noMatches} className={BUTTON_CLASS_SM_NEUTRAL} data-testid="help-search-next">
        Next
      </button>
      <span className="w-20 shrink-0 text-sm text-slate-400 whitespace-nowrap" aria-live="polite" data-testid="help-search-count">
        {countLabel(searchedQuery, matches.length, index)}
      </span>
    </div>
  );
}
