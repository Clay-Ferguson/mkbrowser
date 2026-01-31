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

// todo-0: I think we have multiple places where this function is duplicated. Refactor into a shared utility.
// Format current date as MM/DD/YY
function formatDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

// Format current date/time as MM/DD/YY HH:MM AM/PM
function formatTimestamp(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  let hours = now.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hoursStr = String(hours).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${month}/${day}/${year} ${hoursStr}:${minutes} ${ampm}`;
}

// Singleton for the spell checker
let typoInstance: Typo | null = null;
let typoLoadingPromise: Promise<Typo | null> | null = null;

async function loadSpellChecker(): Promise<Typo | null> {
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

// Decorations for hashtags
const hashtagP1Mark = Decoration.mark({ class: 'cm-hashtag-p1' });
const hashtagP2Mark = Decoration.mark({ class: 'cm-hashtag-p2' });
const hashtagRegularMark = Decoration.mark({ class: 'cm-hashtag-regular' });

// Decoration for date patterns
const dateMark = Decoration.mark({ class: 'cm-date' });

// Extract hashtags from text with their positions
function extractHashtags(text: string): { tag: string; from: number; to: number }[] {
  const hashtags: { tag: string; from: number; to: number }[] = [];
  // Match hashtags: # followed by word characters (letters, numbers, underscores)
  const regex = /#[a-zA-Z0-9_]+/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    hashtags.push({
      tag: match[0],
      from: match.index,
      to: match.index + match[0].length,
    });
  }
  return hashtags;
}

// Create hashtag decorations for a view
function createHashtagDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const hashtags = extractHashtags(line.text);

    for (const { tag, from, to } of hashtags) {
      const lowerTag = tag.toLowerCase();
      let mark: Decoration;
      
      if (lowerTag === '#p1') {
        mark = hashtagP1Mark;
      } else if (lowerTag === '#p2') {
        mark = hashtagP2Mark;
      } else {
        mark = hashtagRegularMark;
      }

      builder.add(line.from + from, line.from + to, mark);
    }
  }

  return builder.finish();
}

// ViewPlugin for hashtag highlighting
const hashtagPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = createHashtagDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = createHashtagDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// Theme for hashtags
const hashtagTheme = EditorView.baseTheme({
  '.cm-hashtag-p1': {
    color: '#fb923c', // orange-400
    fontWeight: '600',
    border: '1px solid #fb923c',
    borderRadius: '3px',
    padding: '1px 3px',
  },
  '.cm-hashtag-p2': {
    color: '#facc15', // yellow-400
    fontWeight: '600',
    border: '1px solid #facc15',
    borderRadius: '3px',
    padding: '1px 3px',
  },
  '.cm-hashtag-regular': {
    color: '#38bdf8', // sky-400 (cyan-blue)
    fontWeight: '500',
    border: '1px solid #38bdf8',
    borderRadius: '3px',
    padding: '1px 3px',
  },
});

// Extract date patterns from text with their positions
// Matches: MM/DD/YYYY, MM/DD/YY, and optionally with HH:MM AM/PM or HH:MM:SS AM/PM
function extractDates(text: string): { from: number; to: number }[] {
  const dates: { from: number; to: number }[] = [];
  // Regex matches:
  // - MM/DD/YYYY or MM/DD/YY (required)
  // - Optionally followed by space and HH:MM AM/PM or HH:MM:SS AM/PM (seconds optional)
  const regex = /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(\d{4}|\d{2})(\s+(0?[1-9]|1[0-2]):[0-5]\d(:[0-5]\d)?\s*[AaPp][Mm])?\b/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    dates.push({
      from: match.index,
      to: match.index + match[0].length,
    });
  }
  return dates;
}

// Create date decorations for a view
function createDateDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const dates = extractDates(line.text);

    for (const { from, to } of dates) {
      builder.add(line.from + from, line.from + to, dateMark);
    }
  }

  return builder.finish();
}

// ViewPlugin for date highlighting
const datePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = createDateDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = createDateDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// Theme for dates
const dateTheme = EditorView.baseTheme({
  '.cm-date': {
    color: '#4ade80', // green-400
    fontWeight: '500',
    border: '1px solid #4ade80',
    borderRadius: '3px',
    padding: '1px 3px',
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
  /** If true, automatically focus the editor after mounting (with a small delay for rendering) */
  autoFocus?: boolean;
  /** 1-based line number to scroll to and position cursor at after initialization */
  goToLine?: number;
  /** Callback when goToLine has been processed (so parent can clear it) */
  onGoToLineComplete?: () => void;
}

function CodeMirrorEditor({ value, onChange, placeholder, language = 'text', autoFocus = false, goToLine, onGoToLineComplete }: CodeMirrorEditorProps) {
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

  const handleInsertTimestamp = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;

    const timestamp = formatTimestamp();
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: timestamp },
      selection: { anchor: from + timestamp.length },
    });
    closeContextMenu();
    view.focus();
  }, [closeContextMenu]);

  const handleInsertDate = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;

    const date = formatDate();
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: date },
      selection: { anchor: from + date.length },
    });
    closeContextMenu();
    view.focus();
  }, [closeContextMenu]);

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
      hashtagPlugin,
      hashtagTheme,
      datePlugin,
      dateTheme,
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

    // Auto-focus and scroll to line after a delay to ensure rendering is complete
    const focusTimer = setTimeout(() => {
      if (viewRef.current) {
        // If goToLine is specified, scroll to that line and position cursor
        if (goToLine && goToLine > 0) {
          try {
            const doc = viewRef.current.state.doc;
            // Ensure line number is within bounds (1-based)
            const targetLine = Math.min(goToLine, doc.lines);
            const line = doc.line(targetLine);

            viewRef.current.dispatch({
              selection: { anchor: line.from, head: line.from },
              scrollIntoView: true,
            });

            // Notify parent that goToLine has been processed
            if (onGoToLineComplete) {
              onGoToLineComplete();
            }
          } catch (err) {
            console.error('Failed to scroll to line:', err);
          }
        }

        // Focus the editor
        if (autoFocus) {
          viewRef.current.focus();
        }
      }
    }, 100);

    // Clean up timer if component unmounts
    view.destroy = (() => {
      const originalDestroy = view.destroy.bind(view);
      return () => {
        clearTimeout(focusTimer);
        originalDestroy();
      };
    })();

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
          <div className="border-t border-slate-600 my-1" />
          <button
            onClick={handleInsertTimestamp}
            className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700"
          >
            Insert Timestamp
          </button>
          <button
            onClick={handleInsertDate}
            className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700"
          >
            Insert Date
          </button>
        </div>
      )}
    </div>
  );
}

export default CodeMirrorEditor;
