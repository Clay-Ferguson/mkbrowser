import { useEffect, useRef, useState } from 'react';
import DlgHeader from './common/DlgHeader';
import { DLG_OVERLAY_CLASS, DLG_CONTAINER } from '../../utils/styles';

interface StreamingDialogProps {
  onClose: () => void;
  onCancel: () => void;
}

function StreamingDialog({ onClose, onCancel }: StreamingDialogProps) {
  const outputRef = useRef<HTMLPreElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'pending' | 'streaming' | 'done' | 'error' | 'cancelled'>('pending');
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

    cleanups.push(window.electronAPI.onAiStreamThinking((text) => {
      setStatus((s) => s === 'pending' ? 'streaming' : s);
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
    <div className={DLG_OVERLAY_CLASS}>
      <div className={`${DLG_CONTAINER} flex flex-col mx-4 my-4`}
           style={{ width: '80vw', height: '75vh', maxWidth: '900px', maxHeight: '85vh' }}>
        <DlgHeader
          title={
            status === 'pending' ? 'Consulting the AI...' :
            status === 'streaming' ? 'Streaming AI Response...' :
            status === 'done' ? 'AI Answer' :
            status === 'error' ? 'Error' : 'Stopping...'
          }
          onClose={status === 'done' || status === 'error' || status === 'cancelled' ? onClose : handleStop}
        />

        {/* Content */}
        <div ref={containerRef} className="flex-1 overflow-y-auto p-4">
          {status === 'pending' && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-400">
              <svg className="animate-spin w-10 h-10 text-teal-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span className="text-sm">Sending your question to the AI — response will appear here shortly.</span>
            </div>
          )}
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
