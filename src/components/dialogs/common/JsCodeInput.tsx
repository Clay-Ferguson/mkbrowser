import { useEffect, useEffectEvent, useRef, type RefObject } from 'react';
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { MONO_FONT_STACK } from '../../../renderer/styles';

interface JsCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called on Ctrl/Cmd+Enter. */
  onSubmit: () => void;
  placeholder?: string;
  testId?: string;
  /** Receives the editable element, so a Dialog can focus it via `initialFocusRef`. */
  focusRef?: RefObject<HTMLElement | null>;
  /** Start one line tall (growing to 4) instead of ~8 (growing to 16), for short expressions. */
  compact?: boolean;
}

// Blend one-dark into the dialog's input styling (bg-slate-900, rounded slate-600
// border). Heights are in lines (`lh`, one 16px line at CodeMirror's 1.4 line
// height): the editor starts `lines` tall and grows with its text up to
// `maxLines`, then scrolls.
//
// The editor element is itself the form's flex item (the host div is
// `display: contents`), so it is `flex-shrink: 0`: in a height-limited flex
// column (the Search dialog's scrolling options panel) it keeps its full
// `lines` height and the panel scrolls, rather than being squeezed into a short
// box that scrolls inside a panel that also scrolls.
function makeInputTheme(lines: number, maxLines: number) {
  return EditorView.theme({
    '&': {
      backgroundColor: 'rgb(15 23 42)',
      fontSize: '16px',
      lineHeight: 1.4,
      border: '1px solid var(--color-slate-600)',
      borderRadius: '0.25rem',
      overflow: 'hidden',
      flexShrink: 0,
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: MONO_FONT_STACK, maxHeight: `${maxLines}lh` },
    '.cm-content': { minHeight: `${lines}lh` },
  });
}
const inputTheme = makeInputTheme(8, 16);
const compactInputTheme = makeInputTheme(1, 4);

/**
 * A plain, minimal CodeMirror editor with JavaScript syntax highlighting, used as a
 * small form field (e.g. the Advanced search expression, or the custom sort
 * expression with `compact`). Deliberately unrelated to
 * the full-featured file editor in `components/editor/`.
 *
 * See: (USER_GUIDE.md#advanced-search-predicates)
 */
function JsCodeInput({ value, onChange, onSubmit, placeholder, testId, focusRef, compact }: JsCodeInputProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Captured once; the mount effect intentionally uses first-render values.
  const mountConfigRef = useRef({ value, placeholder, testId, focusRef, compact });
  const changeEvent = useEffectEvent((text: string) => onChange(text));
  const submitEvent = useEffectEvent(() => onSubmit());

  useEffect(() => {
    const { value, placeholder, testId, focusRef, compact } = mountConfigRef.current;
    const view = new EditorView({
      parent: hostRef.current!,
      doc: value,
      extensions: [
        history(),
        keymap.of([
          { key: 'Mod-Enter', run: () => { submitEvent(); return true; } },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        javascript(),
        oneDark,
        compact ? compactInputTheme : inputTheme,
        EditorView.lineWrapping,
        ...(placeholder ? [placeholderExt(placeholder)] : []),
        ...(testId ? [EditorView.contentAttributes.of({ 'data-testid': testId })] : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) changeEvent(u.state.doc.toString());
        }),
      ],
    });
    viewRef.current = view;
    if (focusRef) focusRef.current = view.contentDOM;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Sync external value changes (e.g. loading a saved search) into the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  // `contents`: the host only holds the editor, which carries the field's own
  // box and sizing (see makeInputTheme).
  return <div ref={hostRef} className="contents" />;
}

export default JsCodeInput;
