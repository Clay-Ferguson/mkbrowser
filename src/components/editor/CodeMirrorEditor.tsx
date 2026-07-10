import { useEffect, useRef, useState, useImperativeHandle, type Ref, type RefObject, type CSSProperties } from 'react';
import { EditorView, placeholder as placeholderExt, keymap, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap, openSearchPanel, setSearchQuery, SearchQuery } from '@codemirror/search';
import { indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, StreamLanguage } from '@codemirror/language';
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';
import { markdown } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import Typo from 'typo-js';
import { globalHighlightText } from '../../renderer/globalHighlight';
import AlertDialog from '../dialogs/AlertDialog';
import { useAS } from '../../store';
import { formatDate, formatTimestamp } from '../../shared/timeUtil';
import { hashtagPlugin, hashtagTheme } from '../../renderer/editor/editorHashtagUtil';
import { datePlugin, dateTheme, dateTooltipExtension } from '../../renderer/editor/editorDateUtil';
import { frontMatterPlugin, frontMatterTheme, frontMatterHideField, frontMatterAtomicRanges, frontMatterCursorGuard, frontMatterHiddenEnd, hrLinePlugin } from '../../renderer/editor/editorFrontMatterUtil';
import { headingSizeExtensions } from '../../renderer/editor/editorHeadingUtil';
import { loadSpellChecker, createSpellCheckPlugin, spellCheckTheme } from './spellChecker';
import { useEditorContextMenu } from './useEditorContextMenu';
import { EditorContextMenu } from './EditorContextMenu';
import { createFontSizeTheme } from './editorTheme';
import { logger } from '../../shared/logUtil';

// Delay before auto-focusing / scrolling to a line after mount. Lets CodeMirror finish its
// initial layout so focus and scrollIntoView land on correctly measured content.
const FOCUS_DELAY_MS = 100;

// Debounce window for the onChange callback. Collapses rapid keystroke bursts (e.g. speech-to-text
// or held keys) into a single store update without a perceptible lag.
const ONCHANGE_DEBOUNCE_MS = 50;

const searchMatchTheme = EditorView.theme({
  '.cm-searchMatch': { backgroundColor: 'yellow', color: 'black' },
  '.cm-searchMatch-selected': { backgroundColor: '#e6b800', color: 'black' },
});

const cursorOverrideTheme = EditorView.theme({
  '& .cm-cursor, & .cm-dropCursor': {
    borderLeftColor: 'white !important',
    borderLeftWidth: '3px !important',
  },
  '& .cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.15) !important',
  },
  '& .cm-activeLineGutter': {
    backgroundColor: 'rgba(255, 255, 255, 0.15) !important',
  },
  '& .cm-selectionBackground, &.cm-focused .cm-selectionBackground, & .cm-content ::selection': {
    backgroundColor: '#1d4ed8 !important',
  },
});

interface CodeMirrorEditorProps {
  /** Imperative handle exposing editor commands (see CodeMirrorEditorHandle). */
  ref?: Ref<CodeMirrorEditorHandle>;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  language?: 'markdown' | 'text' | 'javascript' | 'typescript' | 'python' | 'shell';
  /** If true, automatically focus the editor after mounting (with a small delay for rendering) */
  autoFocus?: boolean;
  /** 1-based line number to scroll to and position cursor at after initialization */
  goToLine?: number;
  /** Callback when goToLine has been processed (so parent can clear it) */
  onGoToLineComplete?: () => void;
  /**
   * Character offset to focus and place the cursor at, applied after the current `value` has
   * been synced into the editor. Use this (instead of a setTimeout) to position the cursor in
   * response to a content change — it runs deterministically once the editor reflects the new value.
   */
  goToPosition?: number | null;
  /** Callback when goToPosition has been processed (so parent can clear it) */
  onGoToPositionComplete?: () => void;
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
  /** If true, render as a non-editable view (still selectable, searchable, syntax-highlighted). */
  readOnly?: boolean;
  /** The file name — used to enable markdown-only context menu items. */
  fileName?: string;
  /** The full path of the file being edited — used to compute relative "Paste Link" paths. */
  filePath?: string;
  /** Called when the user chooses "Make Calendar Item" from the context menu. */
  onMakeCalendarItem?: () => void;
  /** Called when the user chooses "Make Calendar Item (Repeating)" from the context menu. */
  onMakeRepeatingCalendarItem?: () => void;
  /**
   * Called once the editor view (and its imperative handle) is ready. Fired from the mount
   * effect, so the handle is guaranteed populated — use this instead of reading a ref in an
   * effect, which can run before the imperative handle is attached.
   */
  onReady?: (handle: CodeMirrorEditorHandle) => void;
  /**
   * If true, the editor flexes to fill all available height in its (flex-column) parent instead
   * of being capped at a fraction of the scroll area — used by the expanded-editor mode, where
   * the entry is maximized within the browse area and only the editor itself scrolls.
   */
  fillHeight?: boolean;
  /**
   * Called when the user plainly clicks the text of a read-only view — i.e. a left click inside
   * the content DOM (so scrollbar clicks never fire it) that was not a drag and left no text
   * selected. Receives the 1-based line number clicked, so the caller can open the editor there.
   */
  onViewModeClick?: (line: number) => void;
}

export interface CodeMirrorEditorHandle {
  /** Returns the current selection range, or null if nothing is selected (cursor only). */
  getSelection(): { from: number; to: number; text: string } | null;
  /** Focuses the editor and places the cursor at the given character offset. */
  focusAtPosition(pos: number): void;
  /** Inserts text at the current cursor position (replacing any selection). */
  insertAtCursor(text: string): void;
}

/**
 * Builds an imperative handle whose methods read `viewRef` lazily, so any instance works
 * for the editor's whole lifetime regardless of when the view is (re)created.
 */
function createEditorHandle(viewRef: RefObject<EditorView | null>): CodeMirrorEditorHandle {
  return {
    getSelection() {
      const view = viewRef.current;
      if (!view) return null;
      const { from, to } = view.state.selection.main;
      if (from === to) return null;
      return { from, to, text: view.state.sliceDoc(from, to) };
    },
    focusAtPosition(pos: number) {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ selection: { anchor: pos, head: pos } });
      view.focus();
    },
    insertAtCursor(text: string) {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      view.focus();
    },
  };
}

/**
 * Post-mount focus/scroll behavior, run once CodeMirror has finished its initial layout
 * (see FOCUS_DELAY_MS). Module-level (not compiled by the React Compiler): the try/catch
 * around the goToLine dispatch would make the compiler bail out on the whole component.
 */
function applyPostMountFocus(
  view: EditorView,
  cfg: { goToLine?: number; showPropsInEditor: boolean; autoFocus: boolean },
  onGoToLineComplete: (() => void) | undefined,
): void {
  // If goToLine is specified, scroll to that line and position cursor
  if (cfg.goToLine && cfg.goToLine > 0) {
    try {
      const doc = view.state.doc;
      // Ensure line number is within bounds (1-based)
      const targetLine = Math.min(cfg.goToLine, doc.lines);
      const line = doc.line(targetLine);

      view.dispatch({
        selection: { anchor: line.from, head: line.from },
        scrollIntoView: true,
      });

      // Notify parent that goToLine has been processed
      onGoToLineComplete?.();
    } catch (err) {
      logger.error('Failed to scroll to line:', err);
    }
  } else if (!cfg.showPropsInEditor) {
    // Transaction filters don't run on the initial state, so the cursor would
    // otherwise default to position 0 (inside the hidden front matter). Nudge it
    // down to the first visible line.
    const end = frontMatterHiddenEnd(view.state.doc);
    if (end > 0) {
      view.dispatch({ selection: { anchor: end, head: end } });
    }
  }

  // If there's a global search term active, open the search panel pre-populated
  if (globalHighlightText) {
    openSearchPanel(view);
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: globalHighlightText, caseSensitive: false })),
    });
  }

  // Focus the editor
  if (cfg.autoFocus) {
    view.focus();
  }
}

/**
 * Full-featured CodeMirror 6 editor with Markdown/code language support, spell checking,
 * front-matter hiding, hashtag/date decorations, and a custom context menu.
 *
 * The view is created once on mount and never rebuilt for prop changes — mutable props
 * (value, fontSize, showPropsInEditor) are applied through separate effects or compartments
 * so that undo history, cursor position, and the async spell checker are preserved.
 */
function CodeMirrorEditor({ ref, value, onChange, placeholder, language = 'text', autoFocus = false, goToLine, onGoToLineComplete, goToPosition, onGoToPositionComplete, onEscape, onForceCancel, onSave, onSelectionChange, showPropsInEditor = true, readOnly = false, fileName, filePath, onMakeCalendarItem, onMakeRepeatingCalendarItem, onReady, fillHeight = false, onViewModeClick }: CodeMirrorEditorProps) {
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
  const onReadyRef = useRef(onReady);
  const onGoToLineCompleteRef = useRef(onGoToLineComplete);
  const onGoToPositionCompleteRef = useRef(onGoToPositionComplete);
  const onViewModeClickRef = useRef(onViewModeClick);
  // Where the last left-button mousedown landed, used by the view-mode click handler to
  // distinguish a plain click from a drag-to-select gesture.
  const viewClickStartRef = useRef<{ x: number; y: number } | null>(null);
  // Prevents onChange feedback loop when the sync effect dispatches an external value into the editor
  const suppressOnChangeRef = useRef(false);
  // Debounce timer for onChange — collapses rapid keystroke bursts (e.g. speech-to-text) into one store update
  const onChangeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDocRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  // Pixel cap for the editor height (some % of the surrounding scroll area). undefined means
  // no cap (no <main> ancestor, e.g. in unit tests) and the editor grows with its content.
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const settings = useAS(s => s.settings);

  // Mount-time configuration, captured on first render. The mount effect below intentionally
  // uses these initial values — a given editor instance is created fresh per file/mode rather
  // than having them mutated on a live instance, so capturing them once is correct (not a
  // stale-closure bug). The props that DO change during a session are re-synced by their own
  // effects below: `value` (value-sync), `settings.fontSize` (font-size), and
  // `showPropsInEditor` (front matter).
  const mountConfigRef = useRef({
    value,
    placeholder,
    language,
    autoFocus,
    goToLine,
    readOnly,
    showPropsInEditor,
    fontSize: settings.fontSize,
  });

  // Keep the "latest callback" refs in sync so handlers inside the once-created EditorView
  // always call the current props. Synced in an effect rather than during render — mutating
  // refs during render breaks the rules of React and makes the React Compiler bail out on
  // the whole component. Declared before the other effects so it runs first on every commit.
  useEffect(() => {
    onChangeRef.current = onChange;
    onEscapeRef.current = onEscape;
    onForceCancelRef.current = onForceCancel;
    onSaveRef.current = onSave;
    onSelectionChangeRef.current = onSelectionChange;
    onReadyRef.current = onReady;
    onGoToLineCompleteRef.current = onGoToLineComplete;
    onGoToPositionCompleteRef.current = onGoToPositionComplete;
    onViewModeClickRef.current = onViewModeClick;
  });

  // The handle methods read viewRef lazily, so any instance works for the editor's whole
  // lifetime (see createEditorHandle); the onReady callback in the mount effect gets its
  // own equivalent instance.
  useImperativeHandle(ref, () => createEditorHandle(viewRef), []);

  const {
    contextMenu,
    handleContextMenu,
    handleCut,
    handleCopy,
    handlePaste,
    handlePasteLink,
    canPasteLink,
    handleSelectAll,
    handleSpellingSuggestion,
    handleInsertTimestamp,
    handleInsertDate,
    handleMakeCalendarItem,
    handleMakeRepeatingCalendarItem,
    isMarkdown,
    calendarAlreadyExists,
    setCalendarAlreadyExists,
  } = useEditorContextMenu({ viewRef, typoRef, fileName, filePath, onMakeCalendarItem, onMakeRepeatingCalendarItem });

  // Build the EditorView exactly once, on mount, from the mountConfigRef snapshot (see its
  // comment above for why first-render values are correct here). Rebuilding the whole view
  // on a prop change would needlessly discard undo history, cursor, scroll position, and
  // the async-loaded spell checker.
  useEffect(() => {
    if (!editorRef.current) return;
    const cfg = mountConfigRef.current;

    const extensions = [

      // NOTE: In order to remove 'Code Folding' we replaced the line
      // 'basicSetup' which used to be passed here without the parenthesis to call it
      // with the lines between BEGIN_basicSetupReplacement and END_basicSetupReplacement
      // BEGIN_basicSetupReplacement
      // lineNumbers(), <-- removed line numbers (add back with this line)
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      ...(cfg.readOnly ? [] : [history()]),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      ...(cfg.readOnly ? [] : [indentOnInput()]),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      ...(cfg.readOnly ? [] : [closeBrackets(), autocompletion()]),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of(
        cfg.readOnly
          ? [...defaultKeymap, ...searchKeymap]
          : [...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, ...searchKeymap]
      ),
      ...(cfg.readOnly ? [EditorState.readOnly.of(true)] : []),
      // END_basicSetupReplacement
      search({ top: true }),
      searchMatchTheme,
      oneDark,
      cursorOverrideTheme,
      fontSizeCompartment.current.of(createFontSizeTheme(cfg.fontSize)),
      spellCheckCompartment.current.of([]),
      spellCheckTheme,
      frontMatterCompartment.current.of(
        cfg.showPropsInEditor ? [frontMatterPlugin, frontMatterTheme, hrLinePlugin] : [frontMatterHideField, frontMatterAtomicRanges, frontMatterCursorGuard, hrLinePlugin, frontMatterTheme]
      ),
      hashtagPlugin,
      hashtagTheme,
      datePlugin,
      dateTheme,
      dateTooltipExtension,
      // customRenderPlugin, <-- Keep for future use
      // customRenderTheme, <-- Keep for future use
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
      // Click-to-edit for read-only views. Registered on the editor's content DOM, so clicks
      // on the .cm-scroller scrollbar never reach it; drags and clicks that leave a text
      // selection are filtered out so the user can highlight text without entering edit mode.
      EditorView.domEventHandlers({
        mousedown: (event) => {
          viewClickStartRef.current = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
          return false;
        },
        mouseup: (event, view) => {
          const start = viewClickStartRef.current;
          viewClickStartRef.current = null;
          if (!onViewModeClickRef.current || !start) return false;
          const dragged = Math.abs(event.clientX - start.x) > 4 || Math.abs(event.clientY - start.y) > 4;
          if (dragged || !view.state.selection.main.empty) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          const line = pos !== null ? view.state.doc.lineAt(pos).number : 1;
          onViewModeClickRef.current(line);
          return false;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !suppressOnChangeRef.current) {
          pendingDocRef.current = update.state.doc.toString();
          if (onChangeDebounceRef.current) clearTimeout(onChangeDebounceRef.current);
          onChangeDebounceRef.current = setTimeout(() => {
            if (pendingDocRef.current !== null) {
              onChangeRef.current(pendingDocRef.current);
              pendingDocRef.current = null;
            }
          }, ONCHANGE_DEBOUNCE_MS);
        }
        if (update.selectionSet && onSelectionChangeRef.current) {
          const { from, to } = update.state.selection.main;
          onSelectionChangeRef.current(from !== to);
        }
      }),
    ];

    if (cfg.placeholder) {
      extensions.push(placeholderExt(cfg.placeholder));
    }

    if (cfg.language === 'markdown') {
      extensions.push(markdown(), ...headingSizeExtensions);
    } else if (cfg.language === 'javascript') {
      extensions.push(javascript());
    } else if (cfg.language === 'typescript') {
      extensions.push(javascript({ typescript: true }));
    } else if (cfg.language === 'python') {
      extensions.push(python());
    } else if (cfg.language === 'shell') {
      extensions.push(StreamLanguage.define(shell));
    }

    const state = EditorState.create({
      doc: cfg.value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    // The view (and the imperative handle, attached during the preceding layout phase) is now
    // ready. Notify the parent so it can register this editor without racing a ref read.
    onReadyRef.current?.(createEditorHandle(viewRef));

    // Auto-focus and scroll to line after a delay to ensure rendering is complete
    const focusTimer = setTimeout(() => {
      if (viewRef.current) {
        applyPostMountFocus(viewRef.current, cfg, onGoToLineCompleteRef.current);
      }
    }, FOCUS_DELAY_MS);

    // The useEffect cleanup (an unsubscribe-style teardown) returned by every return path below:
    // clears pending timers and destroys the CodeMirror view on unmount.
    const cleanup = () => {
      clearTimeout(focusTimer);
      if (onChangeDebounceRef.current) clearTimeout(onChangeDebounceRef.current);
      view.destroy();
      viewRef.current = null;
    };

    // Skip spell checking for code languages or read-only views
    const isCodeLanguage = cfg.language === 'javascript' || cfg.language === 'typescript' || cfg.language === 'python' || cfg.language === 'shell';
    if (isCodeLanguage || cfg.readOnly) {
      // Returns the useEffect cleanup (unsubscribe) defined above.
      return cleanup;
    }

    // Load spell checker asynchronously
    loadSpellChecker()
      .then((typo) => {
        if (typo && viewRef.current) {
          typoRef.current = typo;
          // Add the spell check plugin
          viewRef.current.dispatch({
            effects: spellCheckCompartment.current.reconfigure(createSpellCheckPlugin(typoRef)),
          });
        }
      })
      .catch((err: unknown) => logger.error('Failed to load spell checker:', err));

    // Returns the useEffect cleanup (unsubscribe) defined above.
    return cleanup;
  }, []);

  // Cap the editor at ~60% of the BrowseView scroll area (`<main>`, the app's one scroll
  // container — same discovery pattern as renderer/entryDom.ts) so CodeMirror's own
  // .cm-scroller scrolls and its viewport rendering stays cheap on large documents. The
  // ResizeObserver keeps the cap in sync with window/panel resizes. In fillHeight mode the
  // editor is sized by the flex chain instead, so no measurement is needed.
  useEffect(() => {
    if (fillHeight) return;
    const scrollContainer = containerRef.current?.closest('main');
    if (!scrollContainer) return;
    const update = () => setMaxHeight(Math.round(scrollContainer.clientHeight * 0.60));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(scrollContainer);
    return () => observer.disconnect();
  }, [fillHeight]);

  // Sync external value changes to editor (but not when editor itself changed)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentContent = view.state.doc.toString();
    if (currentContent !== value) {
      suppressOnChangeRef.current = true;
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: value,
        },
      });
      suppressOnChangeRef.current = false;
    }
  }, [value]);

  // Apply a requested cursor position. Declared after the value-sync effect so that, when a
  // content change and a position request land in the same commit, the doc is already updated
  // by the time the cursor is placed — no setTimeout/race needed.
  useEffect(() => {
    const view = viewRef.current;
    if (view === null || goToPosition === null || goToPosition === undefined) return;
    const pos = Math.max(0, Math.min(goToPosition, view.state.doc.length));
    view.dispatch({ selection: { anchor: pos, head: pos }, scrollIntoView: true });
    view.focus();
    onGoToPositionCompleteRef.current?.();
  }, [goToPosition]);

  // Update font size when settings change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: fontSizeCompartment.current.reconfigure(createFontSizeTheme(settings.fontSize)),
    });
  }, [settings.fontSize]);

  // Toggle front matter visibility when showPropsInEditor changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: frontMatterCompartment.current.reconfigure(
        showPropsInEditor ? [frontMatterPlugin, frontMatterTheme, hrLinePlugin] : [frontMatterHideField, frontMatterAtomicRanges, frontMatterCursorGuard, hrLinePlugin, frontMatterTheme]
      ),
    });
  }, [showPropsInEditor]);

  return (
    <div
      ref={containerRef}
      className={`w-full border border-slate-600 focus-within:border-blue-500 overflow-hidden flex flex-col${fillHeight ? ' flex-1 min-h-0' : ''}`}
      style={
        fillHeight
          ? ({ '--cm-max-height': '100%', '--cm-height': '100%' } as CSSProperties)
          : maxHeight !== undefined
            ? ({ '--cm-max-height': `${maxHeight}px` } as CSSProperties)
            : undefined
      }
    >
      <div
        ref={editorRef}
        className={fillHeight ? 'flex-1 min-h-0' : undefined}
        onContextMenu={handleContextMenu}
      />

      <EditorContextMenu
        contextMenu={contextMenu}
        onCut={handleCut}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onPasteLink={handlePasteLink}
        canPasteLink={canPasteLink}
        onSelectAll={handleSelectAll}
        onSpellingSuggestion={handleSpellingSuggestion}
        onInsertTimestamp={handleInsertTimestamp}
        onInsertDate={handleInsertDate}
        onMakeCalendarItem={handleMakeCalendarItem}
        onMakeRepeatingCalendarItem={handleMakeRepeatingCalendarItem}
        isMarkdown={isMarkdown}
      />
      {calendarAlreadyExists && (
        <AlertDialog
          preserveWhitespace
          title="Calendar Item Exists"
          message="This file already contains calendar information (a 'due' property was found in the front matter)."
          onClose={() => setCalendarAlreadyExists(false)}
        />
      )}
    </div>
  );
}

export default CodeMirrorEditor;
