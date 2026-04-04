import { useEffect, useRef, useState } from 'react';

interface StreamingDialogProps {
  onClose: () => void;
  onCancel: () => void;
}

function StreamingDialog({ onClose, onCancel }: StreamingDialogProps) {
  const outputRef = useRef<HTMLPreElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'streaming' | 'done' | 'error' | 'cancelled'>('streaming');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inThinkingRef = useRef(false);

  // Helper to append a text node to the output
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

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    cleanups.push(window.electronAPI.onAiStreamChunk((text) => {
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

    cleanups.push(window.electronAPI.onAiStreamThinking((text) => {
      if (!inThinkingRef.current) {
        // Add thinking header on first thinking chunk
        appendText('[Thinking]\n', 'text-slate-300 font-semibold');
        inThinkingRef.current = true;
      }
      appendText(text, 'text-slate-200');
    }));

    cleanups.push(window.electronAPI.onAiStreamTool((toolName, summary) => {
      const label = summary ? `🔧 ${toolName}: ${summary}\n` : `🔧 ${toolName}\n`;
      appendText(label, 'text-teal-400');
    }));

    cleanups.push(window.electronAPI.onAiStreamDone(() => {
      setStatus('done');
    }));

    cleanups.push(window.electronAPI.onAiStreamError((message) => {
      setStatus('error');
      setErrorMessage(message);
    }));

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [onClose]);

  const handleStop = () => {
    setStatus('cancelled');
    onCancel();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg border-2 border-slate-400 shadow-xl flex flex-col mx-4 my-4"
           style={{ width: '80vw', height: '75vh', maxWidth: '900px', maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex justify-between items-center px-4 py-2 border-b border-slate-600 flex-shrink-0">
          <span className="text-slate-300 text-sm">
            {status === 'streaming' && 'Streaming AI Response...'}
            {status === 'done' && 'AI Answer'}
            {status === 'error' && 'Error'}
            {status === 'cancelled' && 'Stopping...'}
          </span>
          {status === 'streaming' && (
            <button
              onClick={handleStop}
              className="px-3 py-1 text-sm text-slate-900 bg-red-400 hover:bg-red-300 rounded transition-colors font-semibold"
            >
              Stop
            </button>
          )}
          {(status === 'done' || status === 'error' || status === 'cancelled') && (
            <button
              onClick={onClose}
              className="px-3 py-1 text-sm text-white bg-slate-600 hover:bg-slate-500 rounded transition-colors"
            >
              Close
            </button>
          )}
        </div>

        {/* Content */}
        <div ref={containerRef} className="flex-1 overflow-y-auto p-4">
          <pre ref={outputRef}
               className="text-slate-200 text-sm font-mono whitespace-pre-wrap break-words leading-relaxed">
          </pre>
          {errorMessage && (
            <p className="text-red-400 font-semibold mt-2">Error: {errorMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default StreamingDialog;
