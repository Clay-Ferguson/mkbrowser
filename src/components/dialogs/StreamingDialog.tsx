import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import Dialog from './common/Dialog';

interface StreamingDialogProps {
  /** Dismiss (hide) the dialog. Does not touch the in-flight AI request — used
   *  once the response has finished, or after onCancel when stopping mid-stream. */
  onClose: () => void;
  /** Abort the in-flight AI stream on the backend (cancelAiStream). Does NOT
   *  close the dialog by itself; handleStop pairs it with onClose. */
  onCancel: () => void;
}

function StreamingDialog({ onClose, onCancel }: StreamingDialogProps) {
  const outputRef = useRef<HTMLPreElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'pending' | 'streaming' | 'done' | 'error' | 'cancelled'>('pending');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inThinkingRef = useRef(false);

  // Append streamed text by mutating the DOM directly rather than accumulating
  // it in React state. This is a deliberate exception to the declarative model:
  // AI responses arrive as many small, high-frequency chunks, and re-rendering a
  // continuously growing <pre> on every token causes noticeable jank. Appending a
  // text node (coalescing consecutive same-styled chunks into one span) keeps
  // streaming smooth. The trade-off is that this output lives outside React's
  // control, so nothing else should try to render into the same <pre>.
  const appendText = (text: string, className?: string) => {
    const output = outputRef.current;
    if (!output) return;

    // Get or create the current span
    const lastChild = output.lastElementChild as HTMLSpanElement | null;
    if (lastChild && lastChild.className === (className || '')) {
      lastChild.textContent += text;
    } else {
      const span = document.createElement('span');
      if (className) span.className = className;
      span.textContent = text;
      output.appendChild(span);
    }

    // Auto-scroll
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  };

  // Subscribe to the AI stream IPC events exactly once, on mount. The handlers
  // only touch stable refs and state setters (and appendText, which itself only
  // reads refs), so there are no reactive dependencies — re-subscribing on every
  // render would tear down and re-add the IPC listeners and risk dropping chunks.
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    cleanups.push(api.onAiStreamChunk((text) => {
      setStatus((s) => s === 'pending' ? 'streaming' : s);
      if (inThinkingRef.current) {
        // Transition from thinking to content — add a visible gap
        inThinkingRef.current = false;
        const output = outputRef.current;
        if (output) {
          const divider = document.createElement('div');
          divider.className = 'my-4 border-t border-slate-600';
          output.appendChild(divider);
        }
      }
      appendText(text, 'text-green-300');
    }));

    cleanups.push(api.onAiStreamThinking((text) => {
      setStatus((s) => s === 'pending' ? 'streaming' : s);
      if (!inThinkingRef.current) {
        // Add thinking header on first thinking chunk
        appendText('[Thinking]\n', 'text-slate-300 font-semibold');
        inThinkingRef.current = true;
      }
      appendText(text, 'text-slate-200');
    }));

    cleanups.push(api.onAiStreamTool((toolName, summary) => {
      const label = summary ? `🔧 ${toolName}: ${summary}\n` : `🔧 ${toolName}\n`;
      appendText(label, 'text-teal-400');
    }));

    cleanups.push(api.onAiStreamDone(() => {
      setStatus('done');
    }));

    cleanups.push(api.onAiStreamError((message) => {
      setStatus('error');
      setErrorMessage(message);
    }));

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  const handleStop = () => {
    setStatus('cancelled');
    onCancel();
    onClose();
  };

  // The header ✕ and Esc dismiss the dialog: once the response is finished they
  // simply close it; while it's still running they stop the stream first.
  const isFinished = status === 'done' || status === 'error' || status === 'cancelled';
  const handleDismiss = isFinished ? onClose : handleStop;

  return (
    <Dialog
      title={
        status === 'pending' ? 'Consulting the AI...' :
        status === 'streaming' ? 'Streaming AI Response...' :
        status === 'done' ? 'AI Answer' :
        status === 'error' ? 'Error' : 'Stopping...'
      }
      onClose={handleDismiss}
      className="flex flex-col w-[80vw] h-[75vh] max-w-[900px] max-h-[85vh]"
    >
        {/* Content */}
        <div ref={containerRef} className="flex-1 overflow-y-auto p-4">
          {status === 'pending' && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-400">
              <svg role="img" aria-label="Loading" className="animate-spin w-10 h-10 text-teal-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span className="text-sm">Sending your question to the AI — response will appear here shortly.</span>
            </div>
          )}
          {/* aria-live so screen readers announce text as it streams in. */}
          <pre ref={outputRef}
               aria-live="polite"
               aria-atomic="false"
               className="text-slate-200 text-sm font-mono whitespace-pre-wrap break-words leading-relaxed">
          </pre>
          {errorMessage && (
            <p className="text-red-400 font-semibold mt-2">Error: {errorMessage}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-4 py-3 border-t border-slate-700">
          {status === 'streaming' || status === 'pending' ? (
            <button
              type="button"
              onClick={handleStop}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded cursor-pointer"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded cursor-pointer"
            >
              Close
            </button>
          )}
        </div>
    </Dialog>
  );
}

export default StreamingDialog;
