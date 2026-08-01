import { useEffect, useState } from 'react';
import { api } from '../../renderer/api';
import { useAS } from '../../store';
import { logger } from '../../shared/logUtil';
import { MONO_FONT_STACK } from '../../renderer/styles';

/**
 * The synonym strip that sits under the editor while a file is being edited.
 *
 * It is driven entirely by the cursor: the editor's idle plugin (see `editorThesaurusUtil`)
 * publishes the word under the cursor to `thesaurusWord` once the user has stopped moving
 * and typing for a couple of seconds, and this component looks that word up and renders the
 * results as pills. There is nothing for the user to invoke — click a word, wait a beat,
 * and synonyms appear.
 *
 * The lookup deliberately lives here rather than in the store, so an editor with no strip
 * mounted (an inline edit in the folder listing) never causes the thesaurus data file to be
 * read at all.
 *
 * Rendered only by `BrowseFile`, and only while editing.
 */

/** What is currently on screen: the word looked up under the cursor, and what came back. */
interface ThesaurusResult {
  /** The word as it appears under the cursor. */
  word: string;
  /** The headword the synonyms belong to — differs from `word` for an inflected form. */
  lemma: string | null;
  synonyms: string[];
}

// How many rows of pills the strip shows before it starts scrolling.
const PILL_ROWS = 8;

// A pill is 1.625rem tall: a text-sm line (`leading-5`, 1.25rem) plus `py-0.5` top and
// bottom (0.25rem) plus its 1px borders (0.125rem). Rows sit `gap-1.5` (0.375rem) apart, and
// N rows have N-1 gaps between them. The pills set their line height explicitly rather than
// inheriting it, which is what keeps this arithmetic true — and it holds at every
// `settings.fontSize`, since the pills are text-sm regardless of the editor's font.
const PILL_AREA_MAX_HEIGHT = `calc(${PILL_ROWS} * 1.625rem + ${PILL_ROWS - 1} * 0.375rem)`;

function ThesaurusView() {
  const word = useAS(s => s.thesaurusWord);
  const [result, setResult] = useState<ThesaurusResult | null>(null);

  useEffect(() => {
    // Nothing to look up. The last result is left in state rather than cleared: the render
    // below keys off `word`, so it is not shown, and clearing here would be a synchronous
    // setState in an effect (a cascading render, which the lint rules reject).
    if (word === null) return;

    // Guards against out-of-order responses: the cursor can land on a second word while
    // the first word's lookup is still in flight, and without this the slower reply would
    // win and leave the strip showing synonyms for a word the cursor has already left.
    let cancelled = false;

    api.lookupThesaurus(word)
      .then(({ lemma, synonyms }) => {
        if (!cancelled) setResult({ word, lemma, synonyms });
      })
      .catch((err: unknown) => {
        logger.error('Thesaurus lookup failed:', err);
        // Fall back to the "no synonyms" state rather than leaving the previous word's
        // pills up — a failed lookup must not look like a successful one.
        if (!cancelled) setResult({ word, lemma: null, synonyms: [] });
      });

    return () => { cancelled = true; };
  }, [word]);

  // While a new word's lookup is in flight the PREVIOUS result stays on screen (result
  // still holds the old word). That is deliberate: the cursor crossing a sentence would
  // otherwise blank the strip repeatedly, and the flicker is far more distracting than
  // briefly stale pills. `stale` dims them so what is showing is honest.
  const stale = result !== null && result.word !== word;

  return (
    <div
      className="flex-shrink-0 border-t border-slate-600 bg-slate-800 px-4 py-2"
      data-testid="thesaurus-view"
    >
      {word === null ? (
        <span className="text-sm text-slate-500" data-testid="thesaurus-idle">
          Place the cursor on a word to see synonyms.
        </span>
      ) : result === null ? (
        <span className="text-sm text-slate-500" data-testid="thesaurus-loading">
          Looking up &quot;{word}&quot;…
        </span>
      ) : result.synonyms.length === 0 ? (
        <span className="text-sm text-slate-500" data-testid="thesaurus-empty">
          No synonyms for &quot;{result.word}&quot;.
        </span>
      ) : (
        <div
          className={`flex flex-wrap gap-1.5 overflow-y-auto${stale ? ' opacity-50' : ''}`}
          style={{ maxHeight: PILL_AREA_MAX_HEIGHT }}
          data-testid="thesaurus-synonyms"
          title={`Synonyms for "${result.lemma ?? result.word}"`}
        >
          {/* Names the entry the pills came from, but ONLY when it is not the word under
              the cursor — a cursor on "walked" is answered from "walk", and the user
              should see that rather than wonder why the tenses don't match. It rides
              inside the wrap flow rather than in a column of its own, so nothing but
              synonyms occupies the strip whenever there is nothing to disclose. */}
          {!stale && result.lemma !== null && result.lemma !== result.word && (
            <span
              className="self-center shrink-0 pr-1 text-xs uppercase tracking-wide text-slate-500 select-none"
              data-testid="thesaurus-label"
            >
              {result.lemma}
            </span>
          )}
          {result.synonyms.map((synonym) => (
            // Already a <button> so that clicking one to replace the word under the
            // cursor is purely an onClick away. Inert for now, and kept out of the tab
            // order until it does something — drop the tabIndex when the handler lands.
            <button
              key={synonym}
              type="button"
              tabIndex={-1}
              className="px-2 py-0.5 shrink-0 rounded-md text-sm leading-5 bg-blue-600/50 text-blue-100 border border-slate-400/60 select-none whitespace-nowrap cursor-default"
              style={{ fontFamily: MONO_FONT_STACK }}
            >
              {synonym}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ThesaurusView;
