import { useState, type RefObject } from 'react';
import { api } from '../../../renderer/api';
import { logger } from '../../../shared/logUtil';
import { useAS, setItemReviewing } from '../../../store';
import type { CodeMirrorEditorHandle } from '../../editor/CodeMirrorEditor';
import type { DeferrableAction, StreamingRunner } from './useAiStreamingDialog';

interface UseAiRewriteOptions {
  /** Path of the file being rewritten. */
  path: string;
  /** Whether an .INDEX file is present (passed through to the rewrite call). */
  hasIndexFile: boolean;
  /** Ref to the editor, used to read the current selection. */
  editorRef: RefObject<CodeMirrorEditorHandle | null>;
  /** The current editor content to rewrite. */
  editContent: string;
  /** Surface an error message (e.g. via an AlertDialog). */
  onError: (message: string) => void;
  /**
   * Optional wrapper (the AI streaming dialog) that owns subscription
   * lifecycle, error surfacing, and the defer-until-dialog-closed behavior.
   * When omitted, the rewrite runs inline and the review is entered
   * immediately.
   */
  runner?: StreamingRunner;
}

export interface AiRewrite {
  /** Whether a rewrite is currently in flight. */
  isRewriting: boolean;
  /**
   * Kick off a rewrite of the selection (if any) or the whole document.
   * Fire-and-forget (`() => void`): the async work and error handling run
   * internally.
   */
  aiRewrite: () => void;
}

// Module-level (not compiled by the React Compiler): the ternary lives in a
// rejection handler, which inside the hook's own try/catch would make the
// compiler bail out.
function reportRewriteError(err: unknown, onError: (message: string) => void): void {
  logger.error('Rewrite failed:', err);
  onError(err instanceof Error ? err.message : 'Unknown error');
}

/**
 * Shared selection-vs-whole-document rewrite logic used by both TextEntry and
 * MarkdownEntry. On success it enters review mode for the file; markdown passes
 * a streaming `runner` so review entry is deferred until the streaming dialog
 * closes, while text runs inline and enters review immediately.
 */
export function useAiRewrite({
  path,
  hasIndexFile,
  editorRef,
  editContent,
  onError,
  runner,
}: UseAiRewriteOptions): AiRewrite {
  const [isRewriting, setIsRewriting] = useState(false);

  // Inline fallback when there's no streaming dialog to wait on: run the
  // operation now, surfacing thrown errors so error handling matches the
  // wrapped path. `defer` runs its action immediately.
  const run: StreamingRunner =
    runner ??
    ((operation) =>
      operation((action: DeferrableAction) => action()).catch((err: unknown) =>
        reportRewriteError(err, onError)
      ));

  const aiRewrite = () => {
    const selection = editorRef.current?.getSelection();
    // Read the edit buffer at call time: clicking the rewrite button blurs the editor, which
    // flushes its debounced onChange into the store — this render's editContent may be missing
    // the final keystrokes. The selection offsets come from the live editor doc, so the content
    // sent must describe that same (current) text.
    const latestContent = useAS.getState().items.get(path)?.editContent ?? editContent;
    setIsRewriting(true);
    void run(async (defer) => {
      const result = selection
        ? await api.rewriteContentSelection(latestContent, selection.from, selection.to, path, hasIndexFile)
        : await api.rewriteContent(latestContent, path, hasIndexFile);
      if ('error' in result) {
        logger.error('Rewrite failed:', result.error);
        onError(result.error);
      } else {
        defer(() => setItemReviewing(path, true, result.rewrittenContent));
      }
    })
      .catch((err: unknown) => reportRewriteError(err, onError))
      .finally(() => setIsRewriting(false));
  };

  return { isRewriting, aiRewrite };
}
