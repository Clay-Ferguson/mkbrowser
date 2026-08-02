import { useEffect, useRef, useState } from 'react';
import { api } from '../../renderer/api';
import { useAS } from '../../store';
import { logger } from '../../shared/logUtil';
import { MONO_FONT_STACK } from '../../renderer/styles';
import { insertSynonymAfterWord } from '../../renderer/editor/editorThesaurusUtil';

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
 * `settings.enableThesaurus` is the feature's master switch, and off means **gone**: this
 * renders nothing at all, so the editor above it keeps every pixel. The switch itself lives
 * in the editor's right-click menu (see `useEditorContextMenu`) rather than here, precisely
 * so that turning the feature off can take the whole strip with it. Off is also a real off
 * further up the chain — the idle plugin stops arming its timer, so nothing is scanned or
 * looked up while the user types.
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
  const enabled = useAS(s => s.settings.enableThesaurus);
  const [result, setResult] = useState<ThesaurusResult | null>(null);
  const pillAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Switched off: no lookup, and therefore no reason for the main process to read the
    // 25 MB data file. Belt and braces — the idle plugin stops publishing words too, so
    // `word` should already be null.
    if (!enabled) return;

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
  }, [word, enabled]);

  // A new lookup replaces every pill, so any scroll position carried over from the previous
  // word is meaningless — a large entry (Moby's biggest run to 1446 synonyms) would leave the
  // user parked mid-list of a word the cursor has already left, looking at row 8 of something
  // else. `result` is a fresh object per lookup, so this fires exactly when the content is
  // replaced and never on an unrelated re-render. Runs even when the pill area is not
  // currently rendered (idle/empty/loading), where the ref is simply null.
  useEffect(() => {
    const el = pillAreaRef.current;
    if (el !== null) el.scrollTop = 0;
  }, [result]);

  // The click travels back into the CodeMirror instance the pills came from, which the
  // idle plugin holds a reference to (the store channel only runs editor → strip). A
  // failure here means that editor is gone, in which case there is nothing to insert into
  // and nothing worth telling the user.
  const handleSynonymClick = (synonym: string) => {
    if (!insertSynonymAfterWord(synonym)) {
      logger.warn('Thesaurus insert ignored: no editor to insert into');
    }
  };

  // While a new word's lookup is in flight the PREVIOUS result stays on screen (result
  // still holds the old word). That is deliberate: the cursor crossing a sentence would
  // otherwise blank the strip repeatedly, and the flicker is far more distracting than
  // briefly stale pills. `stale` dims them so what is showing is honest.
  const stale = result !== null && result.word !== word;

  // Switched off: no strip in the DOM at all, so the editor above simply gets that height
  // back. This is the whole reason the on/off control moved to the editor's context menu —
  // a switch living in here would have to keep a row of chrome on screen to be clickable.
  if (!enabled) return null;

  return (
    <div
      className="flex-shrink-0 border-t border-slate-600 bg-slate-800"
      data-testid="thesaurus-view"
    >
      {word === null ? (
        <span className="text-sm text-slate-500 px-2 py-2" data-testid="thesaurus-idle">
          Place the cursor on a word to see synonyms.
        </span>
      ) : result === null ? (
        <span className="text-sm text-slate-500 px-2 py-2" data-testid="thesaurus-loading">
          Looking up &quot;{word}&quot;…
        </span>
      ) : result.synonyms.length === 0 ? (
        <span className="text-sm text-slate-500 px-2 py-2" data-testid="thesaurus-empty">
          No synonyms for &quot;{result.word}&quot;.
        </span>
      ) : (
        <div
          ref={pillAreaRef}
          // pr-2 keeps the pills off the scrollbar this container grows when the
          // entry is long enough to hit PILL_AREA_MAX_HEIGHT.
          className={`flex flex-wrap gap-1.5 overflow-y-auto px-2 py-2${stale ? ' opacity-50' : ''}`}
          style={{ maxHeight: PILL_AREA_MAX_HEIGHT }}
          data-testid="thesaurus-synonyms"
          title={`Synonyms for "${result.lemma ?? result.word}"`}
        >
          {result.synonyms.map((synonym) => (
            // Clicking inserts the synonym just past the word the cursor is in — it
            // never replaces it, see `insertSynonymAfterWord`. The pointer cursor and
            // the hover are the only affordance saying so, since a pill otherwise
            // looks exactly like a label. Hover moves the BORDER only: with hundreds
            // of pills on screen at once, lighting up a whole background under the
            // mouse is glare rather than feedback.
            <button
              key={synonym}
              type="button"
              onClick={() => handleSynonymClick(synonym)}
              title={`Insert "${synonym}" after the word`}
              className="px-2 py-0.5 shrink-0 rounded-md text-sm leading-5 bg-blue-700/50 text-blue-100 border border-slate-400/60 hover:border-slate-200 select-none whitespace-nowrap cursor-pointer transition-colors"
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
