import { useCallback, useRef, useState } from 'react';
import { api } from '../../../renderer/api';
import { logger } from '../../../shared/logUtil';

/** An action that may be deferred until the streaming dialog is closed. */
export type DeferrableAction = () => void;

/**
 * Runs an async AI operation. The operation receives a `defer` helper: pass it
 * the post-completion action (navigate / enter review) so it runs immediately
 * for scripted (non-streaming) answers, or is deferred until the user closes
 * the dialog when streaming actually occurred.
 */
export type StreamingRunner = (
  operation: (defer: (action: DeferrableAction) => void) => Promise<void>,
) => Promise<void>;

interface UseAiStreamingDialogOptions {
  /** Surface an error message (e.g. via an AlertDialog). */
  onError: (message: string) => void;
}

export interface AiStreamingDialog {
  /** Whether the streaming dialog is currently shown. */
  showStreamingDialog: boolean;
  /** Close handler: hides the dialog and runs any deferred action. */
  handleStreamingDialogClose: () => void;
  /** Cancel handler: aborts the in-flight stream. */
  handleCancelStream: () => void;
  /** See {@link StreamingRunner}. */
  runWithStreamingDialog: StreamingRunner;
}

/**
 * Owns the AI streaming-dialog lifecycle: it subscribes to the stream
 * start/chunk events, shows the dialog as soon as the backend commits to the
 * real streaming path, always tears the subscriptions back down (even on
 * throw), surfaces errors via `onError`, and defers a post-completion action
 * until the dialog is closed when streaming occurred.
 *
 * Extracted from the near-identical Ask-AI and AI-Rewrite blocks that each
 * hand-rolled this subscription + deferred-navigation dance.
 */
export function useAiStreamingDialog({ onError }: UseAiStreamingDialogOptions): AiStreamingDialog {
  const [showStreamingDialog, setShowStreamingDialog] = useState(false);
  const showStreamingDialogRef = useRef(false);
  const pendingNavigationRef = useRef<DeferrableAction | null>(null);

  const handleStreamingDialogClose = useCallback(() => {
    showStreamingDialogRef.current = false;
    setShowStreamingDialog(false);
    if (pendingNavigationRef.current) {
      pendingNavigationRef.current();
      pendingNavigationRef.current = null;
    }
  }, []);

  const handleCancelStream = useCallback(() => {
    api.cancelAiStream();
  }, []);

  const runWithStreamingDialog = useCallback<StreamingRunner>(
    async (operation) => {
      // Show the streaming dialog as soon as the backend commits to the real
      // streaming path (ai-stream-start), so it appears instantly in its
      // "pending" state during the (potentially long) model warm-up — well
      // before the first chunk arrives. Scripted answers (used in tests)
      // resolve immediately and never emit this event, so the dialog stays
      // hidden there.
      const showDialog = () => {
        if (!showStreamingDialogRef.current) {
          showStreamingDialogRef.current = true;
          setShowStreamingDialog(true);
        }
      };
      const unsubStart = api.onAiStreamStart(() => {
        showDialog();
        unsubStart();
      });
      // Fallback: also show on the first chunk in case the start event is missed.
      const unsubChunk = api.onAiStreamChunk(() => {
        showDialog();
        unsubChunk();
      });

      // Use the ref (not state) for a synchronous check: if streaming started,
      // defer the action until the user closes the dialog; otherwise run now.
      const defer = (action: DeferrableAction) => {
        if (showStreamingDialogRef.current) {
          pendingNavigationRef.current = action;
        } else {
          action();
        }
      };

      try {
        await operation(defer);
      } catch (err) {
        logger.error('AI streaming operation failed:', err);
        onError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        // Always clean up so the subscriptions never leak on throw. These are
        // no-ops if the events already fired (the handlers unsubscribe
        // themselves), and cancel the subscriptions for scripted answers that
        // never emit any events.
        unsubStart();
        unsubChunk();
      }
    },
    [onError],
  );

  return {
    showStreamingDialog,
    handleStreamingDialogClose,
    handleCancelStream,
    runWithStreamingDialog,
  };
}
