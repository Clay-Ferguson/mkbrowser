import { useState } from 'react';
import { ClipboardDocumentIcon, ClipboardDocumentCheckIcon } from '@heroicons/react/24/outline';
import { logger } from '../../utils/logUtil';

export default function CustomPre({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false);

  const codeElement = children as React.ReactElement;
  const codeClassName = (codeElement?.props as { className?: string })?.className || '';
  const languageMatch = /language-(\w+)/.exec(codeClassName);
  const hasLanguage = !!languageMatch;
  const isMermaid = languageMatch?.[1] === 'mermaid';

  const handleCopy = async () => {
    const codeContent = (codeElement?.props as { children?: string })?.children;
    const textToCopy = String(codeContent).replace(/\n$/, '');

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      logger.error('Failed to copy:', err);
    }
  };

  if (hasLanguage) {
    return (
      <div className="relative group not-prose">
        {children}
        {!isMermaid && (
          <button
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
        )}
      </div>
    );
  }

  return (
    <div className="relative group">
      <pre {...props}>{children}</pre>
      <button
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
    </div>
  );
}
