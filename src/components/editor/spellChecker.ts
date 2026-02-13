import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import Typo from 'typo-js';

// Singleton for the spell checker
let typoInstance: Typo | null = null;
let typoLoadingPromise: Promise<Typo | null> | null = null;

export async function loadSpellChecker(): Promise<Typo | null> {
  if (typoInstance) return typoInstance;
  if (typoLoadingPromise) return typoLoadingPromise;

  typoLoadingPromise = (async () => {
    try {
      const { affData, dicData } = await window.electronAPI.loadDictionary();
      typoInstance = new Typo('en_US', affData, dicData);
      return typoInstance;
    } catch (error) {
      console.error('Failed to initialize spell checker:', error);
      return null;
    }
  })();

  return typoLoadingPromise;
}

// Decoration for misspelled words
const misspelledMark = Decoration.mark({ class: 'cm-misspelled' });

// Extract words from text with their positions
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

// Create spell check decorations for a view
export function createSpellCheckDecorations(view: EditorView, typo: Typo | null): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  if (!typo) return builder.finish();

  const doc = view.state.doc;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const words = extractWords(line.text);

    for (const { word, from, to } of words) {
      // Skip very short words and words that are all caps (likely acronyms)
      if (word.length < 2 || (word.length > 1 && word === word.toUpperCase())) {
        continue;
      }

      if (!typo.check(word)) {
        builder.add(line.from + from, line.from + to, misspelledMark);
      }
    }
  }

  return builder.finish();
}

// ViewPlugin for spell checking
export function createSpellCheckPlugin(typoRef: { current: Typo | null }) {
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
  suggestions: string[];
}
