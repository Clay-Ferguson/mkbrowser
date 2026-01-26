import { useEffect, useRef, useState, useCallback } from 'react';
import { EditorView, placeholder as placeholderExt, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EditorState, Compartment, RangeSetBuilder } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { markdown } from '@codemirror/lang-markdown';
import { useSettings, type FontSize } from '../store';
import Typo from 'typo-js';

const STORAGE_KEY = 'codemirror-editor-height';
const DEFAULT_HEIGHT = 256;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 800;

// Dictionary URLs (using jsDelivr CDN for hunspell dictionaries)
const DICT_BASE_URL = 'https://cdn.jsdelivr.net/npm/dictionary-en@4.0.0/index';

// Singleton for the spell checker
let typoInstance: Typo | null = null;
let typoLoadingPromise: Promise<Typo | null> | null = null;

async function loadSpellChecker(): Promise<Typo | null> {
  if (typoInstance) return typoInstance;
  if (typoLoadingPromise) return typoLoadingPromise;

  typoLoadingPromise = (async () => {
    try {
      const [affResponse, dicResponse] = await Promise.all([
        fetch(`${DICT_BASE_URL}.aff`),
        fetch(`${DICT_BASE_URL}.dic`),
      ]);

      if (!affResponse.ok || !dicResponse.ok) {
        console.error('Failed to load dictionary files');
        return null;
      }

      const [affData, dicData] = await Promise.all([
        affResponse.text(),
        dicResponse.text(),
      ]);

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
function extractWords(text: string): { word: string; from: number; to: number }[] {
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
function createSpellCheckDecorations(view: EditorView, typo: Typo | null): DecorationSet {
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
function createSpellCheckPlugin(typoRef: { current: Typo | null }) {
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
const spellCheckTheme = EditorView.baseTheme({
  '.cm-misspelled': {
    textDecoration: 'underline wavy red',
    textDecorationSkipInk: 'none',
  },
});

const FONT_SIZE_MAP: Record<FontSize, string> = {
  small: '12px',
  medium: '14px',
  large: '16px',
  xlarge: '18px',
};

function getStoredHeight(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const height = parseInt(stored, 10);
      if (!isNaN(height) && height >= MIN_HEIGHT && height <= MAX_HEIGHT) {
        return height;
      }
    }
  } catch {
    // localStorage not available
  }
  return DEFAULT_HEIGHT;
}

function setStoredHeight(height: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(height));
  } catch {
    // localStorage not available
  }
}

interface SpellingSuggestion {
  word: string;
  from: number;
  to: number;
  suggestions: string[];
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  spelling?: SpellingSuggestion;
}

interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  language?: 'markdown' | 'text';
}

function CodeMirrorEditor({ value, onChange, placeholder, language = 'text' }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fontSizeCompartment = useRef(new Compartment());
  const spellCheckCompartment = useRef(new Compartment());
  const typoRef = useRef<Typo | null>(null);
  const settings = useSettings();
  const [height, setHeight] = useState(getStoredHeight);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const view = viewRef.current;
    const typo = typoRef.current;

    let spelling: SpellingSuggestion | undefined;

    if (view && typo) {
      // Get the position in the document from the click coordinates
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos !== null) {
        // Find the word at this position
        const line = view.state.doc.lineAt(pos);
        const lineText = line.text;
        const posInLine = pos - line.from;

        // Find word boundaries
        let wordStart = posInLine;
        let wordEnd = posInLine;

        // Expand left to find word start
        while (wordStart > 0 && /[a-zA-Z']/.test(lineText[wordStart - 1])) {
          wordStart--;
        }

        // Expand right to find word end
        while (wordEnd < lineText.length && /[a-zA-Z']/.test(lineText[wordEnd])) {
          wordEnd++;
        }

        if (wordEnd > wordStart) {
          const word = lineText.slice(wordStart, wordEnd);
          // Check if it's misspelled
          if (word.length >= 2 && !typo.check(word)) {
            const suggestions = typo.suggest(word, 5); // Get up to 5 suggestions
            spelling = {
              word,
              from: line.from + wordStart,
              to: line.from + wordEnd,
              suggestions,
            };
          }
        }
      }
    }

    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      spelling,
    });
  }, []);

  const handleCut = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;

    const { from, to } = view.state.selection.main;
    if (from !== to) {
      const selectedText = view.state.sliceDoc(from, to);
      await navigator.clipboard.writeText(selectedText);
      view.dispatch({
        changes: { from, to, insert: '' },
      });
    }
    closeContextMenu();
    view.focus();
  }, [closeContextMenu]);

  const handleCopy = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;

    const { from, to } = view.state.selection.main;
    if (from !== to) {
      const selectedText = view.state.sliceDoc(from, to);
      await navigator.clipboard.writeText(selectedText);
    }
    closeContextMenu();
    view.focus();
  }, [closeContextMenu]);

  const handlePaste = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;

    const text = await navigator.clipboard.readText();
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    closeContextMenu();
    view.focus();
  }, [closeContextMenu]);

  const handleSelectAll = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      selection: { anchor: 0, head: view.state.doc.length },
    });
    closeContextMenu();
    view.focus();
  }, [closeContextMenu]);

  const handleSpellingSuggestion = useCallback((suggestion: string) => {
    const view = viewRef.current;
    if (!view || !contextMenu.spelling) return;

    const { from, to } = contextMenu.spelling;
    view.dispatch({
      changes: { from, to, insert: suggestion },
      selection: { anchor: from + suggestion.length },
    });
    closeContextMenu();
    view.focus();
  }, [closeContextMenu, contextMenu.spelling]);

  // Close context menu when clicking elsewhere
  useEffect(() => {
    if (!contextMenu.visible) return;

    const handleClick = () => closeContextMenu();
    const handleScroll = () => closeContextMenu();

    document.addEventListener('click', handleClick);
    document.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [contextMenu.visible, closeContextMenu]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = height;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [height]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = e.clientY - startYRef.current;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeightRef.current + delta));
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Persist the final height
        setStoredHeight(height);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [height]);

  const createFontSizeTheme = useCallback((fontSize: FontSize) => {
    return EditorView.theme({
      '&': {
        height: '100%',
        fontSize: FONT_SIZE_MAP[fontSize],
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      },
      '.cm-content': {
        caretColor: '#fff',
      },
      '&.cm-focused': {
        outline: 'none',
      },
    });
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;

    const extensions = [
      basicSetup,
      oneDark,
      fontSizeCompartment.current.of(createFontSizeTheme(settings.fontSize)),
      spellCheckCompartment.current.of([]),
      spellCheckTheme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString());
        }
      }),
    ];

    if (placeholder) {
      extensions.push(placeholderExt(placeholder));
    }

    if (language === 'markdown') {
      extensions.push(markdown());
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    // Load spell checker asynchronously
    loadSpellChecker().then((typo) => {
      if (typo && viewRef.current) {
        typoRef.current = typo;
        // Add the spell check plugin
        viewRef.current.dispatch({
          effects: spellCheckCompartment.current.reconfigure(createSpellCheckPlugin(typoRef)),
        });
      }
    });

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Sync external value changes to editor (but not when editor itself changed)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentContent = view.state.doc.toString();
    if (currentContent !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: value,
        },
      });
    }
  }, [value]);

  // Update font size when settings change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: fontSizeCompartment.current.reconfigure(createFontSizeTheme(settings.fontSize)),
    });
  }, [settings.fontSize, createFontSizeTheme]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded border border-slate-600 focus-within:border-blue-500 overflow-hidden flex flex-col"
    >
      <div
        ref={editorRef}
        style={{ height: `${height}px` }}
        className="overflow-hidden"
        onContextMenu={handleContextMenu}
      />
      <div
        onMouseDown={handleMouseDown}
        className="h-2 bg-slate-700 hover:bg-slate-600 cursor-ns-resize flex items-center justify-center border-t border-slate-600"
        title="Drag to resize"
      >
        <div className="w-8 h-0.5 bg-slate-500 rounded-full" />
      </div>

      {contextMenu.visible && (
        <div
          className="fixed bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 z-50 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.spelling && (
            <>
              <div className="px-4 py-1 text-xs text-red-400 font-medium">
                Misspelled: "{contextMenu.spelling.word}"
              </div>
              {contextMenu.spelling.suggestions.length > 0 ? (
                contextMenu.spelling.suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => handleSpellingSuggestion(suggestion)}
                    className="w-full px-4 py-2 text-left text-sm text-blue-300 hover:bg-slate-700"
                  >
                    {suggestion}
                  </button>
                ))
              ) : (
                <div className="px-4 py-2 text-sm text-slate-500 italic">
                  No suggestions available
                </div>
              )}
              <div className="border-t border-slate-600 my-1" />
            </>
          )}
          <button
            onClick={handleCut}
            className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
          >
            <span>Cut</span>
            <span className="text-slate-500 text-xs">Ctrl+X</span>
          </button>
          <button
            onClick={handleCopy}
            className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
          >
            <span>Copy</span>
            <span className="text-slate-500 text-xs">Ctrl+C</span>
          </button>
          <button
            onClick={handlePaste}
            className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
          >
            <span>Paste</span>
            <span className="text-slate-500 text-xs">Ctrl+V</span>
          </button>
          <div className="border-t border-slate-600 my-1" />
          <button
            onClick={handleSelectAll}
            className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center justify-between"
          >
            <span>Select All</span>
            <span className="text-slate-500 text-xs">Ctrl+A</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default CodeMirrorEditor;
