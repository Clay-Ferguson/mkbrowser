import { useState } from 'react';
import type { ExtraProps } from 'react-markdown';
import { ClipboardDocumentIcon, ClipboardDocumentCheckIcon } from '@heroicons/react/24/outline';
import { logger } from '../utils/logUtil';
import { nodeToString } from '../utils/reactUtil';

// `node` is react-markdown's internal hast node; destructure it out so it isn't
// spread onto the DOM <pre> element (React warns on unknown DOM props).
export default function CustomPre({ children, node, ...props }: React.HTMLAttributes<HTMLPreElement> & ExtraProps) {
  const [copied, setCopied] = useState(false);

  const codeElement = children as React.ReactElement;
  const codeClassName = (codeElement?.props as { className?: string })?.className || '';
  const languageMatch = /language-(\w+)/.exec(codeClassName);
  const hasLanguage = !!languageMatch;
  const isMermaid = languageMatch?.[1] === 'mermaid';

  const handleCopy = async () => {
    const codeContent = (codeElement?.props as { children?: React.ReactNode })?.children;
    const textToCopy = nodeToString(codeContent).replace(/\n$/, '');

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      logger.error('Failed to copy:', err);
    }
  };

  const copyButton = (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded bg-slate-700/80 hover:bg-slate-600 text-slate-400 hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
      title={copied ? 'Copied!' : 'Copy code'}
    >
      {copied ? (
        <ClipboardDocumentCheckIcon className="w-4 h-4 text-green-400" />
      ) : (
        <ClipboardDocumentIcon className="w-4 h-4" />
      )}
    </button>
  );

  if (hasLanguage) {
    return (
      <div className="relative group not-prose mb-4">
        {children}
        {!isMermaid && copyButton}
      </div>
    );
  }

  return (
    <div className="relative group">
      <pre {...props}>{children}</pre>
      {copyButton}
    </div>
  );
}
