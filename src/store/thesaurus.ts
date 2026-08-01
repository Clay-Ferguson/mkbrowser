import { getState } from './core';
import type { StoreSet } from './core';

// ============================================================================
// Thesaurus - the word the synonym pane is currently showing
// ============================================================================

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts`.
 */
export interface ThesaurusSlice {
  setThesaurusWord: (word: string | null) => void;
}

export function createThesaurusSlice(set: StoreSet): ThesaurusSlice {
  return {
    setThesaurusWord: (word: string | null) => {
      // The idle plugin fires on a timer, so a re-report of the same word is common
      // (focus changes, re-mounts). Patching state anyway would re-run the pane's lookup
      // effect and make the pills blink for no reason.
      if (getState().thesaurusWord === word) return;
      set({ thesaurusWord: word });
    },
  };
}

/**
 * Publish the word under the editor cursor for the thesaurus pane, or `null` to clear it.
 *
 * This exists because the pane and the editor have no prop path between them: `BrowseFile`
 * renders the pane, but CodeMirror lives two levels down inside the entry component. The
 * store is the channel — the editor's idle plugin writes here, `ThesaurusView` reads.
 *
 * Only the *word* travels through the store. The synonym lookup happens in the pane, so an
 * editor with no pane mounted (inline edits in the folder listing) never touches the
 * thesaurus data file.
 */
export function setThesaurusWord(word: string | null): void {
  getState().setThesaurusWord(word);
}
