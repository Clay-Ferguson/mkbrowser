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
 * Creates the idle-cursor `ViewPlugin`. `onWord` receives the word to look up, or `null`
 * when the pane should show nothing.
 *
 * Two guards keep the reports meaningful:
 * - **Focus.** Only the focused editor reports. Several editors can be mounted at once
 *   (every expanded entry in a folder listing has one), and without this the pane would be
 *   fed by whichever one happened to be constructed last.
 * - **Repeats.** Re-reporting the word already showing is suppressed, so arrow-keying
 *   within one word doesn't re-trigger a lookup and make the pills flicker.
 */
export function createThesaurusPlugin(onWord: (word: string | null) => void) {
  return ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null;
      lastReported: string | null = null;

      constructor(view: EditorView) {
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
        this.timer = setTimeout(() => {
          this.timer = null;
          this.report(view);
        }, THESAURUS_IDLE_MS);
      }

      report(view: EditorView) {
        if (!view.hasFocus) return;
        const word = thesaurusWordAtCursor(view.state);
        if (word === this.lastReported) return;
        this.lastReported = word;
        onWord(word);
      }

      destroy() {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        // The editor is going away (edit ended, file closed) — clear the pane rather than
        // leaving it showing synonyms for a word that is no longer on screen.
        onWord(null);
      }
    }
  );
}
