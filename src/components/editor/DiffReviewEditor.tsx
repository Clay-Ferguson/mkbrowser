import { useEffect, useRef, useCallback } from 'react';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { markdown } from '@codemirror/lang-markdown';
import { unifiedMergeView, acceptChunk, rejectChunk, getChunks } from '@codemirror/merge';
import { useSettings, type FontSize } from '../../store';

const FONT_SIZE_MAP: Record<FontSize, string> = {
  small: '12px',
  medium: '14px',
  large: '16px',
  xlarge: '18px',
};

interface DiffReviewEditorProps {
  originalText: string;
  modifiedText: string;
  language?: 'markdown' | 'text';
  onAcceptAll: (finalText: string) => void;
  onCancel: () => void;
}

function DiffReviewEditor({ originalText, modifiedText, language = 'text', onAcceptAll, onCancel }: DiffReviewEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const settings = useSettings();

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
      createFontSizeTheme(settings.fontSize),
      EditorView.lineWrapping,
      EditorState.readOnly.of(true),
      unifiedMergeView({
        original: originalText,
        mergeControls: true,
        highlightChanges: true,
        gutter: true,
      }),
    ];

    if (language === 'markdown') {
      extensions.push(markdown());
    }

    const state = EditorState.create({
      doc: modifiedText,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  const handleAcceptAll = () => {
    const view = viewRef.current;
    if (!view) return;

    // Accept all chunks from last to first to avoid position shifts
    let accepted = true;
    while (accepted) {
      const result = getChunks(view.state);
      if (!result || result.chunks.length === 0) break;
      // Accept the last chunk first
      const lastChunk = result.chunks[result.chunks.length - 1];
      accepted = acceptChunk(view, lastChunk.fromB);
    }

    onAcceptAll(view.state.doc.toString());
  };

  const handleDone = () => {
    const view = viewRef.current;
    if (!view) return;

    // Reject all remaining chunks from last to first to avoid position shifts
    let rejected = true;
    while (rejected) {
      const result = getChunks(view.state);
      if (!result || result.chunks.length === 0) break;
      const lastChunk = result.chunks[result.chunks.length - 1];
      rejected = rejectChunk(view, lastChunk.fromB);
    }

    onAcceptAll(view.state.doc.toString());
  };

  return (
    <div className="w-full flex flex-col gap-2">
      <div
        ref={editorRef}
        className="w-full rounded border border-amber-600 overflow-hidden"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={handleAcceptAll}
          className="px-3 py-1 text-sm text-white bg-green-600 hover:bg-green-500 rounded transition-colors"
        >
          Accept All
        </button>
        <button
          onClick={handleDone}
          className="px-3 py-1 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
        >
          Done
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors"
        >
          Cancel Rewrite
        </button>
      </div>
    </div>
  );
}

export default DiffReviewEditor;
