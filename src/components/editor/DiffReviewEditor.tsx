import { useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { markdown } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { unifiedMergeView, acceptChunk, rejectChunk, getChunks } from '@codemirror/merge';
import { useAS } from '../../store';
import { createFontSizeTheme } from './editorTheme';
import { BUTTON_CLASS_SM_BLUE, BUTTON_CLASS_SM_GREEN } from '../../renderer/styles';

interface DiffReviewEditorProps {
  /** The pre-edit content, shown as the "original" side in the unified diff. */
  originalText: string;
  /** The post-edit content (the current document), shown as the "modified" side. */
  modifiedText: string;
  language?: 'markdown' | 'text' | 'javascript' | 'typescript' | 'python' | 'shell';
  /** Reports the final document after the user resolves every chunk (accepting or rejecting all). */
  onComplete: (finalText: string) => void;
  /** Called when the user cancels the review without saving. */
  onCancel: () => void;
}

/**
 * Read-only unified diff viewer built on CodeMirror's `unifiedMergeView`. Shows the AI-rewritten
 * text alongside the original so the user can accept or reject individual change chunks before
 * committing the result. "Accept All" bulk-resolves every chunk; "Done" rejects all remaining
 * chunks and finalises with the current document state.
 */
function DiffReviewEditor({ originalText, modifiedText, language = 'text', onComplete, onCancel }: DiffReviewEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const settings = useAS(s => s.settings);

  // Mount-time configuration, captured on first render. The mount effect below intentionally
  // uses these initial values — a review session is created fresh per rewrite rather than
  // having its texts mutated on a live instance, so capturing them once is correct.
  const mountConfigRef = useRef({
    originalText,
    modifiedText,
    language,
    fontSize: settings.fontSize,
  });

  useEffect(() => {
    if (!editorRef.current) return;
    const cfg = mountConfigRef.current;

    const extensions = [
      basicSetup,
      oneDark,
      createFontSizeTheme(cfg.fontSize),
      EditorView.lineWrapping,
      EditorState.readOnly.of(true),
      unifiedMergeView({
        original: cfg.originalText,
        mergeControls: true,
        highlightChanges: true,
        gutter: true,
      }),
    ];

    if (cfg.language === 'markdown') {
      extensions.push(markdown());
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
      doc: cfg.modifiedText,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    // Returns the useEffect cleanup (an unsubscribe-style teardown): destroys the CodeMirror EditorView and clears its ref on unmount.
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  const resolveAllChunks = (action: 'accept' | 'reject') => {
    const view = viewRef.current;
    if (!view) return;

    // Repeatedly resolve the last remaining chunk until none are left. We re-fetch the chunks
    // each pass (rather than iterating a fixed list) because resolving a chunk shifts the
    // positions of the others. `resolved` guards against a stuck loop if a chunk ever fails to
    // resolve and the count therefore stops shrinking.
    const resolveChunk = action === 'accept' ? acceptChunk : rejectChunk;
    let resolved = true;
    while (resolved) {
      const result = getChunks(view.state);
      if (!result || result.chunks.length === 0) break;
      const lastChunk = result.chunks[result.chunks.length - 1];
      resolved = resolveChunk(view, lastChunk!.fromB); 
    }

    onComplete(view.state.doc.toString());
  };

  return (
    <div className="w-full flex flex-col gap-2">
      <div
        ref={editorRef}
        className="w-full rounded border border-amber-600 overflow-hidden"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => resolveAllChunks('accept')}
          className={BUTTON_CLASS_SM_GREEN}
          data-testid="diff-accept-all-button"
        >
          Accept All
        </button>
        <button
          type="button"
          onClick={() => resolveAllChunks('reject')}
          className={BUTTON_CLASS_SM_BLUE}
          data-testid="diff-done-button"
        >
          Done
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          data-testid="diff-cancel-button"
        >
          Cancel Rewrite
        </button>
      </div>
    </div>
  );
}

export default DiffReviewEditor;
