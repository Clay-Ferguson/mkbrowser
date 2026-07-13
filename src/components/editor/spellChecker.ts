import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { RefObject } from 'react';
import Typo from 'typo-js';
import { api } from '../../renderer/api';
import { logger } from '../../shared/logUtil';
import { frontMatterEndLine } from '../../renderer/editor/editorFrontMatterUtil';
import { eachVisibleLine } from '../../renderer/editor/editorViewportUtil';

// Module-level singletons so the dictionary is fetched and compiled exactly once,
// even if multiple editor instances call loadSpellChecker concurrently.
let typoInstance: Typo | null = null;
let typoLoadingPromise: Promise<Typo | null> | null = null;

/**
 * Loads the en_US Hunspell dictionary via IPC and returns a shared `Typo` instance.
 * Concurrent callers receive the same in-flight promise, so the dictionary files are
 * fetched and compiled only once per session. Returns `null` if loading fails.
 */
export async function loadSpellChecker(): Promise<Typo | null> {
  if (typoInstance) return typoInstance;
  if (typoLoadingPromise) return typoLoadingPromise;

  typoLoadingPromise = (async () => {
    try {
      const { affData, dicData } = await api.loadDictionary();
      typoInstance = new Typo('en_US', affData, dicData);
      return typoInstance;
    } catch (error) {
      logger.error('Failed to initialize spell checker:', error);
      return null;
    }
  })();

  return typoLoadingPromise;
}

const misspelledMark = Decoration.mark({ class: 'cm-misspelled' });

/**
 * Splits `text` into spellcheckable tokens, returning each token with its start and end
 * offsets within the string. Matches letter sequences including internal apostrophes
 * (e.g. "don't") so contractions are checked as a single word.
 */
export function extractWords(text: string): { word: string; from: number; to: number }[] {
  const words: { word: string; from: number; to: number }[] = [];
  // Match word characters, including apostrophes within words
  const regex = /[a-zA-Z]+(?:'[a-zA-Z]+)?/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    words.push({
      word: match[0],
      from: match.index,
      to: match.index + match[0].length,
    });
  }
  return words;
}

/**
 * Returns the word that contains character offset `pos` within `text`, or `null` if
 * `pos` falls outside any word boundary. Uses the same tokenisation as `extractWords`
 * so spell-check underlines and the context-menu misspelling lookup always agree.
 */
export function wordAt(text: string, pos: number): { word: string; from: number; to: number } | null {
  for (const w of extractWords(text)) {
    if (pos >= w.from && pos <= w.to) return w;
  }
  return null;
}

/**
 * Builds a `DecorationSet` that underlines every misspelled word visible in the current
 * viewport. Front-matter lines are skipped. Only the visible range is scanned so large
 * files don't incur unnecessary work on every keystroke or scroll event.
 */
export function createSpellCheckDecorations(view: EditorView, typo: Typo | null): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  if (!typo) return builder.finish();

  const doc = view.state.doc;

  // Determine front matter line range to skip (shared definition of where front
  // matter ends, so spell-check stays consistent with the editor's other utilities).
  const frontMatterEnd = frontMatterEndLine(doc);

  // Only decorate the visible viewport, not the whole document. Spell-check
  // underlines are only ever seen within the viewport, so scanning the entire
  // doc on every keystroke/scroll is wasted work on large files.
  eachVisibleLine(view, (line) => {
    if (line.number <= frontMatterEnd) return;

    const words = extractWords(line.text);
    for (const { word, from: wordFrom, to: wordTo } of words) {
      // Skip very short words and words that are all caps (likely acronyms)
      if (word.length < 2 || word === word.toUpperCase()) {
        continue;
      }

      if (!typo.check(word)) {
        builder.add(line.from + wordFrom, line.from + wordTo, misspelledMark);
      }
    }
  });

  return builder.finish();
}

/**
 * Creates a CodeMirror `ViewPlugin` that recomputes spell-check decorations whenever
 * the document or visible viewport changes. Receives `typoRef` rather than a `Typo`
 * instance directly so the plugin continues to work after the spell checker loads
 * asynchronously post-mount.
 */
export function createSpellCheckPlugin(typoRef: RefObject<Typo | null>) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = createSpellCheckDecorations(view, typoRef.current);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = createSpellCheckDecorations(update.view, typoRef.current);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

// Theme for misspelled words
export const spellCheckTheme = EditorView.baseTheme({
  '.cm-misspelled': {
    textDecoration: 'underline wavy red',
    textDecorationSkipInk: 'none',
  },
});

// Interface for spelling suggestions in context menu
export interface SpellingSuggestion {
  word: string;
  from: number;
  to: number;
  /** `null` while the suggestion search is still running (the menu opens before it finishes). */
  suggestions: string[] | null;
}
