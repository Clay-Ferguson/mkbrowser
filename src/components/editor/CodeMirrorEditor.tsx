import { useEffect, useRef, useState, useImperativeHandle, type Ref, type RefObject, type CSSProperties } from 'react';
import { EditorView, placeholder as placeholderExt, keymap, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { EditorState, Compartment, type Text } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap, openSearchPanel, setSearchQuery, SearchQuery } from '@codemirror/search';
import { indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, StreamLanguage } from '@codemirror/language';
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { unifiedMergeView, getChunks, getOriginalDoc } from '@codemirror/merge';
import { oneDarkTheme, oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import Typo from 'typo-js';
import { getGlobalHighlightText } from '../../renderer/globalHighlight';
import AlertDialog from '../dialogs/AlertDialog';
import { useAS } from '../../store';
import { formatDate, formatTimestamp } from '../../shared/timeUtil';
import { hashtagPlugin, hashtagTheme } from '../../renderer/editor/editorHashtagUtil';
import { datePlugin, dateTheme, dateTooltipExtension } from '../../renderer/editor/editorDateUtil';
import { frontMatterPlugin, frontMatterTheme, frontMatterHideField, frontMatterAtomicRanges, frontMatterCursorGuard, frontMatterHiddenEnd, hrLinePlugin } from '../../renderer/editor/editorFrontMatterUtil';
import { headingSizeExtensions } from '../../renderer/editor/editorHeadingUtil';
import { markdownHighlightStyle } from '../../renderer/editor/editorMarkdownHighlight';
import { minimalDiff } from '../../renderer/editor/editorDiffUtil';
import { loadSpellChecker, createSpellCheckPlugin, spellCheckTheme } from './spellChecker';
import { useEditorContextMenu } from './useEditorContextMenu';
import { EditorContextMenu } from './EditorContextMenu';
import { createFontSizeTheme } from './editorTheme';
import { logger } from '../../shared/logUtil';
import { BUTTON_CLASS_SM_BLUE, BUTTON_CLASS_SM_GREEN } from '../../renderer/styles';

// Delay before auto-focusing / scrolling to a line after mount. Lets CodeMirror finish its
// initial layout so focus and scrollIntoView land on correctly measured content.
const FOCUS_DELAY_MS = 100;

// Debounce window for the onChange callback. Collapses rapid keystroke bursts (e.g. speech-to-text
// or held keys) into a single store update without a perceptible lag.
const ONCHANGE_DEBOUNCE_MS = 50;

/**
 * Mutable debounce state for onChange delivery, held in a single ref. `pendingDoc` holds the
 * immutable CodeMirror `Text` of the latest undelivered change — capturing the reference is
 * O(1) per keystroke, and the O(doc) `toString()` happens once at flush time instead of on
 * every keystroke. `lastDelivered` is the last doc text handed to onChange (or adopted from
 * an external value sync); the value-sync effect uses it to tell a store echo of the editor's
 * own onChange apart from a genuine external content change.
 */
interface OnChangeDebounceState {
  timer: ReturnType<typeof setTimeout> | null;
  pendingDoc: Text | null;
  lastDelivered: string;
}

/**
 * Synchronously delivers a pending debounced onChange, if any. Called on every path where a
 * consumer is about to read onChange-fed state or the editor is going away — before onSave and
 * onEscape run, when the editor loses focus, and in the mount-effect cleanup — so the final
 * keystrokes of the debounce window are never dropped. Module-level so the mount effect and
 * the other effects can share it (and the React Compiler leaves it uncompiled).
 */
function flushPendingOnChange(d: OnChangeDebounceState, onChange: (value: string) => void): void {
  if (d.timer !== null) {
    clearTimeout(d.timer);
    d.timer = null;
  }
  if (d.pendingDoc !== null) {
    const doc = d.pendingDoc.toString();
    d.pendingDoc = null;
    d.lastDelivered = doc;
    onChange(doc);
  }
}

/**
 * Discards a pending debounced onChange without delivering it — used when the doc content it
 * was captured from is being superseded (external value sync) or intentionally abandoned
 * (Ctrl-Q force cancel).
 */
function cancelPendingOnChange(d: OnChangeDebounceState): void {
  if (d.timer !== null) {
    clearTimeout(d.timer);
    d.timer = null;
  }
  d.pendingDoc = null;
}

/**
 * Ends AI-review mode: swaps the unified merge view out of `mergeCompartment` and brings the
 * document to `finalText` in a single transaction. Any pending debounced onChange is dropped —
 * it was captured from a review-mode doc state that never belonged in the store — and
 * `lastDelivered` is primed with `finalText` so the store echoing the result back through the
 * value prop is recognized as an echo rather than re-dispatched into the editor. The caller
 * clears `reviewingRef` AFTER this runs, so the updateListener ignores the exit transaction.
 */
function exitReviewToText(
  view: EditorView,
  mergeCompartment: Compartment,
  d: OnChangeDebounceState,
  finalText: string,
): void {
  cancelPendingOnChange(d);
  const current = view.state.doc.toString();
  view.dispatch({
    ...(current === finalText ? {} : { changes: minimalDiff(current, finalText) }),
    effects: mergeCompartment.reconfigure([]),
  });
  d.lastDelivered = finalText;
}

/**
 * Centers the first pending diff chunk after entering review, so the user sees the proposal
 * immediately instead of hunting for it in a long document. Runs in a rAF because the merge
 * extension computes its chunks after the reconfigure transaction settles.
 */
function scrollFirstChunkIntoView(view: EditorView | null): void {
  if (!view) return;
  const first = getChunks(view.state)?.chunks[0];
  if (first !== undefined) {
    view.dispatch({ effects: EditorView.scrollIntoView(first.fromB, { y: 'center' }) });
  }
}

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
  /**
   * AI-review mode. When set (non-null), the live editor enters an in-place diff review: the
   * current document is snapshotted as the diff's "original" side, the document becomes this
   * proposed text, and CodeMirror's unified merge view (swapped in via a compartment) shows
   * per-chunk accept/reject gutter controls plus an Accept All / Done / Cancel button bar.
   * Undo history, scroll position, and the spell checker all survive the round trip. While
   * reviewing, onChange is not fired and external `value` syncs are ignored; the review's
   * outcome is delivered through onReviewComplete / onReviewCancel instead.
   */
  reviewText?: string | null;
  /**
   * Reports the final document when the user finishes the review. "Accept All" keeps every
   * unresolved chunk's proposed text; "Done" rejects every unresolved chunk (keeping only the
   * chunks accepted individually via the gutter controls).
   */
  onReviewComplete?: (finalText: string) => void;
  /** Called when the user cancels the review; the editor restores the pre-review document. */
  onReviewCancel?: () => void;
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
  const highlightText = getGlobalHighlightText();
  if (highlightText) {
    openSearchPanel(view);
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: highlightText, caseSensitive: false })),
    });
  }

  // Focus the editor
  if (cfg.autoFocus) {
    view.focus();
  }
}

/**
 * Full-featured CodeMirror 6 editor with Markdown/code language support, spell checking,
 * front-matter hiding, hashtag/date decorations, an in-place AI-review diff mode (see
 * `reviewText`), and a custom context menu.
 *
 * The view is created once on mount and never rebuilt for prop changes — mutable props
 * (value, fontSize, showPropsInEditor, reviewText) are applied through separate effects or
 * compartments so that undo history, cursor position, and the async spell checker are preserved.
 */
function CodeMirrorEditor({ ref, value, onChange, placeholder, language = 'text', autoFocus = false, goToLine, onGoToLineComplete, goToPosition, onGoToPositionComplete, onEscape, onForceCancel, onSave, onSelectionChange, showPropsInEditor = true, readOnly = false, fileName, filePath, onMakeCalendarItem, onMakeRepeatingCalendarItem, onReady, fillHeight = false, onViewModeClick, reviewText = null, onReviewComplete, onReviewCancel }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fontSizeCompartment = useRef(new Compartment());
  const frontMatterCompartment = useRef(new Compartment());
  const spellCheckCompartment = useRef(new Compartment());
  const mergeCompartment = useRef(new Compartment());
  // True while the merge view is active in the editor. A ref (not state) because the once-created
  // updateListener and keymap handlers need the live value; the buttons and border render from
  // the `reviewing` prop-derived flag below instead.
  const reviewingRef = useRef(false);
  // The pre-review document, snapshotted when review is entered — the diff's "original" side
  // and the text restored on cancel.
  const reviewOriginalRef = useRef<string | null>(null);
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
  // Debounce state for onChange (see OnChangeDebounceState) — collapses rapid keystroke bursts
  // (e.g. speech-to-text) into one store update. lastDelivered starts as the mount value.
  const onChangeDebounceRef = useRef<OnChangeDebounceState>({ timer: null, pendingDoc: null, lastDelivered: value });
  const onChangeRef = useRef(onChange);
  // Pixel cap for the editor height (some % of the surrounding scroll area). undefined means
  // no cap (no <main> ancestor, e.g. in unit tests) and the editor grows with its content.
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const settings = useAS(s => s.settings);

  // Mount-time configuration, captured on first render. The mount effect below intentionally
  // uses these initial values — a given editor instance is created fresh per file/mode rather
  // than having them mutated on a live instance, so capturing them once is correct (not a
  // stale-closure bug). The props that DO change during a session are re-synced by their own
  // effects below: `value` (value-sync), `settings.fontSize` (font-size),
  // `showPropsInEditor` (front matter), and `reviewText` (AI-review merge view).
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
      // one-dark, unbundled: `oneDark` is just [oneDarkTheme, syntaxHighlighting(oneDarkHighlightStyle)],
      // and Markdown needs a different highlight style (markdownHighlightStyle extends one-dark's
      // rather than replacing them) while keeping the identical UI chrome. Registering one
      // highlighter rather than two keeps tag precedence explicit — see editorMarkdownHighlight.
      // NOTE: this is the only *active* highlighter; the defaultHighlightStyle above is registered
      // with `fallback: true`, so it applies only if no other highlighter is present.
      oneDarkTheme,
      syntaxHighlighting(cfg.language === 'markdown' ? markdownHighlightStyle : oneDarkHighlightStyle),
      cursorOverrideTheme,
      fontSizeCompartment.current.of(createFontSizeTheme(cfg.fontSize)),
      spellCheckCompartment.current.of([]),
      spellCheckTheme,
      // AI-review merge view, swapped in/out by the review effect below. Empty when not reviewing.
      mergeCompartment.current.of([]),
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
            // During AI review the store's edit buffer still holds the pre-review text, so the
            // parent's "unmodified → cancel editing" Escape logic would silently tear down the
            // review. The explicit review buttons are the only exits (Ctrl-Q stays available
            // as the force-abandon hatch).
            if (reviewingRef.current) return false;
            if (onEscapeRef.current) {
              // Deliver any pending onChange first: the parent's Escape handler decides whether
              // to cancel by checking for unsaved modifications, which it must not miss.
              flushPendingOnChange(onChangeDebounceRef.current, onChangeRef.current);
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
              // Force-cancel discards the edit; drop (don't deliver) the pending onChange so
              // the abandoned keystrokes can't be written back into the store on teardown.
              cancelPendingOnChange(onChangeDebounceRef.current);
              onForceCancelRef.current();
              return true;
            }
            return false;
          },
        },
        {
          key: 'Ctrl-s',
          run: () => {
            // Saving mid-review would write the pre-review edit buffer while the user is looking
            // at the proposal — resolve the review first (the Save button is hidden too).
            if (reviewingRef.current) return false;
            if (onSaveRef.current) {
              // Deliver any pending onChange before saving, or keystrokes from the last
              // ONCHANGE_DEBOUNCE_MS would be missing from the content the save reads.
              flushPendingOnChange(onChangeDebounceRef.current, onChangeRef.current);
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
        // Flush the onChange debounce whenever focus leaves the editor: clicking Save / Cancel /
        // Ask-AI etc. blurs the editor before the button's click handler runs, so this guarantees
        // the store is current by the time any outside handler reads the edit buffer.
        blur: () => {
          flushPendingOnChange(onChangeDebounceRef.current, onChangeRef.current);
          return false;
        },
      }),
      EditorView.updateListener.of((update) => {
        // During AI review doc changes are review mechanics (entering review, rejecting chunks,
        // hand-tweaking the proposal) — none of them belong in the store until the review is
        // resolved, at which point onReviewComplete/onReviewCancel deliver the outcome.
        if (update.docChanged && !suppressOnChangeRef.current && !reviewingRef.current) {
          const d = onChangeDebounceRef.current;
          d.pendingDoc = update.state.doc;
          if (d.timer !== null) clearTimeout(d.timer);
          d.timer = setTimeout(() => flushPendingOnChange(d, onChangeRef.current), ONCHANGE_DEBOUNCE_MS);
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
      // `base: markdownLanguage` parses GFM; markdown()'s default base is plain CommonMark, under
      // which ~~strikethrough~~, tables and task lists produce no tags at all — so they could never
      // be coloured, while MarkdownView renders them via remark-gfm. This keeps what the editor
      // highlights honest about what the app actually renders.
      extensions.push(markdown({ base: markdownLanguage }), ...headingSizeExtensions);
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
      // Deliver (never drop) any pending onChange so the final keystrokes survive teardown —
      // e.g. an unmount mid-edit keeps them in the store's edit buffer. Intentional discards
      // (Ctrl-Q force cancel) cancel the pending state before this runs, making it a no-op.
      flushPendingOnChange(onChangeDebounceRef.current, onChangeRef.current);
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

    // During AI review the editor doc intentionally diverges from `value` (it holds the
    // proposed text; the store still holds the pre-review buffer). Syncing here would clobber
    // the diff — the review handlers reconcile doc and store when the review is resolved.
    if (reviewingRef.current) return;

    const currentContent = view.state.doc.toString();
    if (currentContent === value) return;

    const d = onChangeDebounceRef.current;
    // The store echoing back the editor's own last onChange can land while newer keystrokes
    // are already pending — the editor is ahead of the store, not out of sync with it.
    // Replacing the doc here would revert live typing; skip, and let the pending flush
    // bring the store up to date instead.
    if (d.pendingDoc !== null && value === d.lastDelivered) return;

    // Genuine external change (AI rewrite, external-modification re-read, tags panel edit).
    // It supersedes anything still sitting in the debounce window: drop the pending onChange,
    // or its timer would later fire and overwrite this fresh value in the store with
    // pre-sync content.
    cancelPendingOnChange(d);
    d.lastDelivered = value;
    suppressOnChangeRef.current = true;
    // Dispatch a minimal diff, not a whole-doc replace: replacing the entire document
    // maps CodeMirror's scroll anchor (and selection) to position 0, bouncing the user
    // to the top of the file on every external sync.
    view.dispatch({
      changes: minimalDiff(currentContent, value),
    });
    suppressOnChangeRef.current = false;
  }, [value]);

  // Enter/exit AI-review mode. `unifiedMergeView` is an extension, not a component, so review
  // happens in the LIVE editor: the current doc is snapshotted as the diff's original side and
  // the document becomes the proposed text, with per-chunk accept/reject controls in the gutter.
  // Undo history, scroll position, and the async spell checker survive the whole round trip.
  // The exit branch only covers review state being cleared externally (e.g. the parent leaving
  // edit mode mid-review); the button handlers below clear reviewingRef themselves before the
  // parent nulls the prop, making the exit branch a no-op on the normal paths.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (reviewText !== null && reviewText !== undefined) {
      if (reviewingRef.current) return;
      const original = view.state.doc.toString();
      reviewingRef.current = true;
      reviewOriginalRef.current = original;
      // Keystrokes still in the debounce window describe the pre-review doc; the rewrite flow
      // already read the live edit buffer (flushed by the button click's blur), so drop them.
      cancelPendingOnChange(onChangeDebounceRef.current);
      view.dispatch({
        ...(original === reviewText ? {} : { changes: minimalDiff(original, reviewText) }),
        effects: mergeCompartment.current.reconfigure(
          unifiedMergeView({
            original,
            mergeControls: true,
            highlightChanges: true,
            gutter: true,
          })
        ),
      });
      requestAnimationFrame(() => scrollFirstChunkIntoView(viewRef.current));
    } else if (reviewingRef.current) {
      exitReviewToText(view, mergeCompartment.current, onChangeDebounceRef.current, reviewOriginalRef.current ?? view.state.doc.toString());
      reviewingRef.current = false;
      reviewOriginalRef.current = null;
    }
  }, [reviewText]);

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

  // Renders the review button bar / amber border. Derived from the prop (not reviewingRef) so it
  // participates in React rendering; reviewingRef guards the handlers against the brief window
  // where the prop is set but the effect hasn't entered (or has already exited) review.
  const reviewing = reviewText !== null && reviewText !== undefined;

  const handleReviewAcceptAll = () => {
    const view = viewRef.current;
    if (!view || !reviewingRef.current) return;
    // Accepting every unresolved chunk keeps the proposal text, so the current editor doc
    // (the proposal, minus any chunks already rejected individually) IS the final result.
    const finalText = view.state.doc.toString();
    exitReviewToText(view, mergeCompartment.current, onChangeDebounceRef.current, finalText);
    reviewingRef.current = false;
    reviewOriginalRef.current = null;
    onReviewComplete?.(finalText);
  };

  const handleReviewDone = () => {
    const view = viewRef.current;
    if (!view || !reviewingRef.current) return;
    // "Done" rejects every unresolved chunk. acceptChunk folds accepted chunks into the merge
    // view's original document, so getOriginalDoc() is exactly "original + accepted so far" —
    // the result of rejecting the rest. Read it before the merge field is torn down.
    const finalText = getOriginalDoc(view.state).toString();
    exitReviewToText(view, mergeCompartment.current, onChangeDebounceRef.current, finalText);
    reviewingRef.current = false;
    reviewOriginalRef.current = null;
    onReviewComplete?.(finalText);
  };

  const handleReviewCancel = () => {
    const view = viewRef.current;
    if (!view || !reviewingRef.current) return;
    exitReviewToText(view, mergeCompartment.current, onChangeDebounceRef.current, reviewOriginalRef.current ?? view.state.doc.toString());
    reviewingRef.current = false;
    reviewOriginalRef.current = null;
    onReviewCancel?.();
  };

  return (
    <div
      ref={containerRef}
      className={`w-full border ${reviewing ? 'border-amber-600' : 'border-slate-600 focus-within:border-blue-500'} overflow-hidden flex flex-col${fillHeight ? ' flex-1 min-h-0' : ''}`}
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

      {reviewing && (
        <div className="flex items-center gap-2 p-2 border-t border-slate-600">
          <button
            type="button"
            onClick={handleReviewAcceptAll}
            className={BUTTON_CLASS_SM_GREEN}
            data-testid="diff-accept-all-button"
          >
            Accept All
          </button>
          <button
            type="button"
            onClick={handleReviewDone}
            className={BUTTON_CLASS_SM_BLUE}
            data-testid="diff-done-button"
          >
            Done
          </button>
          <button
            type="button"
            onClick={handleReviewCancel}
            className="px-3 py-1 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors"
            data-testid="diff-cancel-button"
          >
            Cancel Rewrite
          </button>
        </div>
      )}

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
