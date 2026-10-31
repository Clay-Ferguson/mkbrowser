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
}

// Blend one-dark into the dialog's input styling (bg-slate-900, rounded border).
const inputTheme = EditorView.theme({
  '&': { backgroundColor: 'rgb(15 23 42)', fontSize: '16px' },
  '&.cm-focused': { outline: 'none' },
  // `lh` is the scroller's own line height, so this is ~8 rows tall (scrolling past 16).
  '.cm-scroller': { fontFamily: MONO_FONT_STACK, minHeight: '8lh', maxHeight: '16lh' },
});

/**
 * A plain, minimal CodeMirror editor with JavaScript syntax highlighting, used as a
 * small form field (e.g. the Advanced search expression). Deliberately unrelated to
 * the full-featured file editor in `components/editor/`.
 *
 * See: (USER_GUIDE.md#advanced-search-predicates)
 */
function JsCodeInput({ value, onChange, onSubmit, placeholder, testId, focusRef }: JsCodeInputProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Captured once; the mount effect intentionally uses first-render values.
  const mountConfigRef = useRef({ value, placeholder, testId, focusRef });
  const changeEvent = useEffectEvent((text: string) => onChange(text));
  const submitEvent = useEffectEvent(() => onSubmit());

  useEffect(() => {
    const { value, placeholder, testId, focusRef } = mountConfigRef.current;
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
        inputTheme,
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

  return <div ref={hostRef} className="w-full rounded border border-slate-600 overflow-hidden" />;
}

export default JsCodeInput;
