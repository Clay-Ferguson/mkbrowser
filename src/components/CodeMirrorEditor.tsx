import { useEffect, useRef, useState, useCallback } from 'react';
import { EditorView, placeholder as placeholderExt, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { markdown } from '@codemirror/lang-markdown';
import { useSettings, type FontSize } from '../store';
import Typo from 'typo-js';
import { formatDate, formatTimestamp } from '../utils/timeUtil';
import { hashtagPlugin, hashtagTheme } from '../utils/editorHashtagUtil';
import { datePlugin, dateTheme, dateTooltipExtension } from '../utils/editorDateUtil';
import { loadSpellChecker, createSpellCheckPlugin, spellCheckTheme } from './spellChecker';
import { useEditorContextMenu, EditorContextMenu } from './editorContextMenu';

const STORAGE_KEY = 'codemirror-editor-height';
const DEFAULT_HEIGHT = 256;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 800;

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
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const {
    contextMenu,
    handleContextMenu,
    handleCut,
    handleCopy,
    handlePaste,
    handleSelectAll,
    handleSpellingSuggestion,
    handleInsertTimestamp,
    handleInsertDate,
  } = useEditorContextMenu({ viewRef, typoRef });

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
      dateTooltipExtension,
      EditorView.lineWrapping,
      keymap.of([
        {
          key: 'Ctrl-t',
          run: (view) => {
            const timestamp = formatTimestamp();
            const { from, to } = view.state.selection.main;
            view.dispatch({
              changes: { from, to, insert: timestamp },
              selection: { anchor: from + timestamp.length },
            });
            return true;
          },
        },
        {
          key: 'Ctrl-d',
          run: (view) => {
            const date = formatDate();
            const { from, to } = view.state.selection.main;
            view.dispatch({
              changes: { from, to, insert: date },
              selection: { anchor: from + date.length },
            });
            return true;
          },
        },
      ]),
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

      <EditorContextMenu
        contextMenu={contextMenu}
        onCut={handleCut}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onSelectAll={handleSelectAll}
        onSpellingSuggestion={handleSpellingSuggestion}
        onInsertTimestamp={handleInsertTimestamp}
        onInsertDate={handleInsertDate}
      />
    </div>
  );
}

export default CodeMirrorEditor;
