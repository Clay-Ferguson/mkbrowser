import { useEffect, useState } from 'react';
import { api } from '../../renderer/api';
import { useAS, setEnableThesaurus } from '../../store';
import { logger } from '../../shared/logUtil';
import { MONO_FONT_STACK, CHECKBOX_CLASS } from '../../renderer/styles';
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
 * The checkbox in the corner is the feature's master switch (`settings.enableThesaurus`,
 * persisted to config.yaml). It stays mounted when the feature is off — it is the only way
 * back on — so the strip collapses to one short row rather than disappearing. Turning it
 * off is a real off: the idle plugin stops arming its timer, so nothing is scanned or
 * looked up while the user types.
 *
 * Rendered only by `BrowseFile`, and only while editing.
 */

interface ThesaurusViewProps {
  /** Persists `settings` to config.yaml — the checkbox has to survive a restart. */
  onSaveSettings: () => void;
}

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

function ThesaurusView({ onSaveSettings }: ThesaurusViewProps) {
  const word = useAS(s => s.thesaurusWord);
  const enabled = useAS(s => s.settings.enableThesaurus);
  const [result, setResult] = useState<ThesaurusResult | null>(null);

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

  const handleToggleEnabled = (checked: boolean) => {
    setEnableThesaurus(checked);
    onSaveSettings();
  };

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

  return (
    <div
      className="flex-shrink-0 border-t border-slate-600 bg-slate-800 px-4 py-2"
      data-testid="thesaurus-view"
    >
      {/* Two columns rather than one wrap flow: the switch has to stay put in the corner
          while the pills reflow past it. `items-start` plus the pill's own line box on the
          label is what puts the checkbox on the first row of pills instead of centred
          against eight rows of them. */}
      <div className="flex items-start gap-3">
        <label
          className="flex shrink-0 items-center gap-1.5 py-0.5 text-xs uppercase leading-5 tracking-wide text-slate-400 select-none cursor-pointer"
          title="Show synonyms for the word under the cursor"
        >
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => handleToggleEnabled(e.target.checked)}
            className={CHECKBOX_CLASS}
            data-testid="thesaurus-enabled"
          />
          Thesaurus
        </label>

        {/* Off: the label above is the whole strip, one row tall. Everything below it —
            the lookup, the pills, and the editor plugin feeding them — is inert. */}
        {enabled && (
          <div className="min-w-0 flex-1">
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
                // pr-2 keeps the pills off the scrollbar this container grows when the
                // entry is long enough to hit PILL_AREA_MAX_HEIGHT.
                className={`flex flex-wrap gap-1.5 overflow-y-auto pr-2${stale ? ' opacity-50' : ''}`}
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
                  // Clicking inserts the synonym just past the word the cursor is in — it
                  // never replaces it, see `insertSynonymAfterWord`. The pointer cursor and
                  // the brighter hover are the only affordance saying so, since a pill
                  // otherwise looks exactly like a label.
                  <button
                    key={synonym}
                    type="button"
                    onClick={() => handleSynonymClick(synonym)}
                    title={`Insert "${synonym}" after the word`}
                    className="px-2 py-0.5 shrink-0 rounded-md text-sm leading-5 bg-blue-600/50 hover:bg-blue-500/80 text-blue-100 hover:text-white border border-slate-400/60 hover:border-slate-300 select-none whitespace-nowrap cursor-pointer transition-colors"
                    style={{ fontFamily: MONO_FONT_STACK }}
                  >
                    {synonym}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ThesaurusView;
