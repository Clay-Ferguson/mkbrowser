import { useEffect, useState, useRef } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
});

const mermaidRenderQueue: Array<() => Promise<void>> = [];
let isRenderingMermaid = false;

async function processMermaidQueue() {
  if (isRenderingMermaid || mermaidRenderQueue.length === 0) return;

  isRenderingMermaid = true;
  const task = mermaidRenderQueue.shift();

  if (task) {
    try {
      await task();
    } catch {
      // Error handled by the task itself
    }
  }

  isRenderingMermaid = false;

  if (mermaidRenderQueue.length > 0) {
    processMermaidQueue();
  }
}

export function queueMermaidRender(task: () => Promise<void>) {
  mermaidRenderQueue.push(task);
  processMermaidQueue();
}

let mermaidIdCounter = 0;

export function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const idRef = useRef<number | null>(null);

  if (idRef.current === null) {
    idRef.current = ++mermaidIdCounter;
  }

  useEffect(() => {
    let isMounted = true;
    const diagramId = idRef.current;

    setLoading(true);
    setSvg('');
    setError('');

    queueMermaidRender(async () => {
      try {
        const safeId = `mermaid-diagram-${diagramId}-${Date.now()}`;
        const result = await mermaid.render(safeId, code);

        if (isMounted) {
          // HACK_BEGIN
          // Mermaid's text-width measurement tends to run slightly narrow,
          // causing foreignObject labels to clip on the right edge.
          // Widen every foreignObject by 15% to give text room to breathe.
          const fixedSvg = result.svg.replace(
            /(<foreignObject\b[^>]*?\bwidth=")([^"]+)(")/g,
            (_match, prefix, widthStr, suffix) => {
              const newWidth = parseFloat(widthStr) * 1.15;
              return `${prefix}${newWidth}${suffix}`;
            }
          );
          setSvg(fixedSvg);
          // HACK_END

          setError('');
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
          setSvg('');
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [code]);

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-500 rounded p-3 text-red-300 text-sm">
        <strong>Mermaid Error:</strong> {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-400">
        <ArrowPathIcon className="animate-spin h-5 w-5 mr-3" />
        <span>Rendering diagram...</span>
      </div>
    );
  }

  return (
    <div
      className="mermaid-diagram flex justify-center my-4"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default MermaidDiagram;
