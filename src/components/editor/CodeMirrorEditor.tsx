import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { EditorView, placeholder as placeholderExt, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';
import { markdown } from '@codemirror/lang-markdown';
import Typo from 'typo-js';
import { useSettings, type FontSize } from '../../store';
import { formatDate, formatTimestamp } from '../../utils/timeUtil';
import { hashtagPlugin, hashtagTheme } from '../../utils/editorHashtagUtil';
import { datePlugin, dateTheme, dateTooltipExtension } from '../../utils/editorDateUtil';
import { frontMatterPlugin, frontMatterTheme, frontMatterHideField } from '../../utils/editorFrontMatterUtil';
import { loadSpellChecker, createSpellCheckPlugin, spellCheckTheme } from './spellChecker';
import { useEditorContextMenu, EditorContextMenu } from './editorContextMenu';
import { logger } from '../../utils/logUtil';

const FONT_SIZE_MAP: Record<FontSize, string> = {
  small: '12px',
  medium: '14px',
  large: '16px',
  xlarge: '18px',
};

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
  /** Called when Escape is pressed (parent should cancel editing if content is unmodified) */
  onEscape?: () => void;
  /** Called when Ctrl-Q is pressed — force-cancel editing without saving */
  onForceCancel?: () => void;
  /** Called when Ctrl-S is pressed — save and exit editing */
  onSave?: () => void;
  /** Called when the editor selection changes — reports whether text is selected */
  onSelectionChange?: (hasSelection: boolean) => void;
  /** Whether to show front matter (Properties) in the editor. Defaults to true. */
  showPropsInEditor?: boolean;
}

export interface CodeMirrorEditorHandle {
  /** Returns the current selection range, or null if nothing is selected (cursor only). */
  getSelection(): { from: number; to: number; text: string } | null;
}

const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, CodeMirrorEditorProps>(function CodeMirrorEditor({ value, onChange, placeholder, language = 'text', autoFocus = false, goToLine, onGoToLineComplete, onEscape, onForceCancel, onSave, onSelectionChange, showPropsInEditor = true }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fontSizeCompartment = useRef(new Compartment());
  const frontMatterCompartment = useRef(new Compartment());
  const spellCheckCompartment = useRef(new Compartment());
  const typoRef = useRef<Typo | null>(null);
  const onEscapeRef = useRef(onEscape);
  const onForceCancelRef = useRef(onForceCancel);
  const onSaveRef = useRef(onSave);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onEscapeRef.current = onEscape;
  onForceCancelRef.current = onForceCancel;
  onSaveRef.current = onSave;
  onSelectionChangeRef.current = onSelectionChange;
  const settings = useSettings();

  useImperativeHandle(ref, () => ({
    getSelection() {
      const view = viewRef.current;
      if (!view) return null;
      const { from, to } = view.state.selection.main;
      if (from === to) return null;
      return { from, to, text: view.state.sliceDoc(from, to) };
    },
  }));

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

  const createFontSizeTheme = useCallback((fontSize: FontSize) => {
    return EditorView.theme({
      '&': {
        fontSize: FONT_SIZE_MAP[fontSize],
      },
      '.cm-scroller': {
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      },
      '.cm-content, .cm-gutter': {
        minHeight: '75px',
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

      // NOTE: In order to remove 'Code Folding' we replaced the line
      // 'basicSetup' which used to be passed here without the parenthesis to call it
      // with the lines between BEGIN_basicSetupReplacement and END_basicSetupReplacement
      // BEGIN_basicSetupReplacement
      // lineNumbers(), <-- removed line numbers (add back with this line)
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap]),
      // END_basicSetupReplacement
      search({ top: true }),
      oneDark,
      fontSizeCompartment.current.of(createFontSizeTheme(settings.fontSize)),
      spellCheckCompartment.current.of([]),
      spellCheckTheme,
      frontMatterCompartment.current.of(
        showPropsInEditor ? [frontMatterPlugin, frontMatterTheme] : [frontMatterHideField]
      ),
      hashtagPlugin,
      hashtagTheme,
      datePlugin,
      dateTheme,
      dateTooltipExtension,
      EditorView.lineWrapping,
      keymap.of([
        {
          key: 'Escape',
          run: () => {
            if (onEscapeRef.current) {
              onEscapeRef.current();
              return true;
            }
            return false;
          },
        },
        {
          key: 'Ctrl-q',
          run: () => {
            if (onForceCancelRef.current) {
              onForceCancelRef.current();
              return true;
            }
            return false;
          },
        },
        {
          key: 'Ctrl-s',
          run: () => {
            if (onSaveRef.current) {
              onSaveRef.current();
              return true;
            }
            return false;
          },
        },
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
        if (update.selectionSet && onSelectionChangeRef.current) {
          const { from, to } = update.state.selection.main;
          onSelectionChangeRef.current(from !== to);
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
            logger.error('Failed to scroll to line:', err);
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

  // Toggle front matter visibility when showPropsInEditor changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: frontMatterCompartment.current.reconfigure(
        showPropsInEditor ? [frontMatterPlugin, frontMatterTheme] : [frontMatterHideField]
      ),
    });
  }, [showPropsInEditor]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded border border-slate-600 focus-within:border-blue-500 overflow-hidden flex flex-col"
    >
      <div
        ref={editorRef}
        onContextMenu={handleContextMenu}
      />

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
});

export default CodeMirrorEditor;
