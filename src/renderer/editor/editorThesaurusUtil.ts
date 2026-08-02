import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { wordAt } from '../../components/editor/spellChecker';
import { frontMatterEndLine } from './editorFrontMatterUtil';

/**
 * Reports the word under the editor cursor once the user goes idle, driving the thesaurus
 * pane below the editor (see `ThesaurusView`).
 *
 * The pane is meant to feel like it appears on its own — the user clicks a word or stops
 * typing, and synonyms show up — so this watches for *stillness* rather than for an
 * explicit gesture: any cursor movement or document change restarts the timer, and only
 * when nothing has happened for `THESAURUS_IDLE_MS` is the word looked up.
 */

// How long the cursor must sit still (and no typing occur) before a lookup fires.
export const THESAURUS_IDLE_MS = 2000;

// Words this short are articles, prepositions and initials — a thesaurus has nothing
// useful for them, and skipping them avoids pointless lookups as the cursor crosses a line.
export const MIN_THESAURUS_WORD_LENGTH = 3;

/**
 * Returns the word under the cursor, or `null` when there is nothing worth looking up —
 * the cursor sits on whitespace or punctuation, the word is too short, or the cursor is
 * inside YAML front matter (whose keys are structure, not prose).
 *
 * Uses the same `wordAt` tokenizer as the spell checker, so the thesaurus and the
 * right-click spelling suggestions always agree on where a word begins and ends.
 *
 * Takes the `EditorState` rather than the view, since the cursor and document are all it
 * needs — which also lets it be unit-tested without a DOM.
 */
export function thesaurusWordAtCursor(state: EditorState): string | null {
  const { head } = state.selection.main;
  const doc = state.doc;
  if (head > doc.length) return null;

  const line = doc.lineAt(head);
  if (line.number <= frontMatterEndLine(doc)) return null;

  const found = wordAt(line.text, head - line.from);
  if (!found || found.word.length < MIN_THESAURUS_WORD_LENGTH) return null;
  return found.word;
}

/**
 * The editor the pills currently on screen were read from — the one a clicked pill gets
 * inserted into.
 *
 * The store carries the word from the editor to the strip, but a click has to travel the
 * other way, and only two things can make that trip: a `CodeMirror` view or something that
 * can reach one. A module-level reference (like `store/scroll.ts`'s deliberate non-reactive
 * Map) rather than store state, because nothing renders off it — it would be a state field
 * whose every write is followed by no re-render.
 *
 * It is set from `report()`, so it is by construction the focused editor whose cursor
 * produced the word the pills belong to, and it is dropped when that editor reports no word
 * or is torn down. `null` therefore means "no pills are actionable", and every insert path
 * checks it.
 */
let sourceView: EditorView | null = null;

function setSourceView(view: EditorView | null): void {
  sourceView = view;
}

/**
 * Where a clicked synonym goes: the first whitespace at or after the cursor, or the end of
 * the line — i.e. just past the end of the word the cursor is in.
 *
 * Scanning only the current line is complete, not a shortcut. A line ends at either a line
 * break — whitespace, so the scan would stop there anyway — or the end of the document.
 *
 * Split out from the insert (and taking the `EditorState`, like `thesaurusWordAtCursor`)
 * so the position rule can be unit-tested with no DOM.
 */
export function synonymInsertPos(state: EditorState): number | null {
  const { head } = state.selection.main;
  if (head > state.doc.length) return null;

  const line = state.doc.lineAt(head);
  const whitespace = /\s/.exec(line.text.slice(head - line.from));
  return whitespace ? head + whitespace.index : line.to;
}

/**
 * Inserts `synonym` just past the word the cursor is in, and returns whether it happened.
 *
 * **This deliberately does not replace anything.** Swapping the word out would be lossy in
 * a way the user cannot preview: the pills are Moby's unranked breadth, so a mis-click
 * would silently destroy prose, and an inflected word (`walked` → `stride`) would come out
 * grammatically wrong either way. Inserting leaves both words on the page and lets the user
 * delete the one they don't want — a keystroke's cost, and it can never lose text.
 *
 * A leading space is part of the inserted text — without it `walked` + `stride` would come
 * out as `walkedstride`. The cursor lands after the insertion and focus returns to the
 * editor, so the user can carry straight on typing (or immediately delete the original).
 */
export function insertSynonymAfterWord(synonym: string): boolean {
  const view = sourceView;
  if (!view) return false;

  const pos = synonymInsertPos(view.state);
  if (pos === null) return false;

  const insert = ' ' + synonym;
  view.dispatch({
    changes: { from: pos, insert },
    selection: { anchor: pos + insert.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/**
 * Creates the idle-cursor `ViewPlugin`. `onWord` receives the word to look up, or `null`
 * when the pane should show nothing.
 *
 * `isEnabled` is read fresh on every keystroke rather than captured once, because the
 * user's on/off switch is an item in this very editor's right-click menu — the extension
 * list is built once at mount and never reconfigured, so a value baked in here would leave
 * the setting inert until the next edit. When it returns false no timer is even armed,
 * which is the point: turning the feature off has to cost nothing while the user types.
 *
 * Two further guards keep the reports meaningful:
 * - **Focus.** Only the focused editor reports. Several editors can be mounted at once
 *   (every expanded entry in a folder listing has one), and without this the pane would be
 *   fed by whichever one happened to be constructed last.
 * - **Repeats.** Re-reporting the word already showing is suppressed, so arrow-keying
 *   within one word doesn't re-trigger a lookup and make the pills flicker.
 */
export function createThesaurusPlugin(
  onWord: (word: string | null) => void,
  isEnabled: () => boolean,
) {
  return ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null;
      lastReported: string | null = null;
      // Kept only so destroy() can withdraw this editor from `sourceView` — the plugin's
      // own callbacks all receive the view as an argument.
      view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
        this.schedule(view);
      }

      update(update: ViewUpdate) {
        // focusChanged is included so clicking into an editor starts its countdown, and
        // so the word is re-evaluated when focus moves between editors.
        if (update.docChanged || update.selectionSet || update.focusChanged) {
          this.schedule(update.view);
        }
      }

      schedule(view: EditorView) {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        // Turned off: no timer, no word scan, no lookup. The next cursor move or keystroke
        // after the user turns it back on re-arms this normally. `lastReported` is dropped
        // with it, because turning the feature off also clears the published word — without
        // this, coming back to the same word the strip was showing before would be
        // suppressed as a repeat and leave the strip empty.
        if (!isEnabled()) {
          this.lastReported = null;
          return;
        }
        this.timer = setTimeout(() => {
          this.timer = null;
          this.report(view);
        }, THESAURUS_IDLE_MS);
      }

      report(view: EditorView) {
        // Re-checked here as well as in schedule(): the user can turn the feature off
        // during the two seconds a timer is already counting down.
        if (!isEnabled()) return;
        if (!view.hasFocus) return;
        const word = thesaurusWordAtCursor(view.state);
        if (word === this.lastReported) return;
        this.lastReported = word;
        // Claim the strip on the way out: whatever pills the click handler is about to
        // put on screen came from THIS editor's cursor, so this is the editor a clicked
        // pill must be inserted into. Publishing the word and claiming the strip are the
        // same event, which is what keeps the two from ever disagreeing.
        setSourceView(word === null ? null : view);
        onWord(word);
      }

      destroy() {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        // The editor is going away (edit ended, file closed) — clear the pane rather than
        // leaving it showing synonyms for a word that is no longer on screen, and make
        // sure a stale view can't be dispatched into afterwards.
        if (sourceView === this.view) sourceView = null;
        onWord(null);
      }
    }
  );
}
