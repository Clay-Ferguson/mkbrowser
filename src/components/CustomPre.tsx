import { useEffect, useRef, useState } from 'react';
import type { ExtraProps } from 'react-markdown';
import { ClipboardDocumentIcon, ClipboardDocumentCheckIcon } from '@heroicons/react/24/outline';
import { logger } from '../shared/logUtil';
import { nodeToString } from '../renderer/reactUtil';
import { BUTTON_CLASS_CODE_COPY } from '../renderer/styles';
import { resolveObjectBlock } from './objects/objectRegistry';
import ObjectBlock, { InvalidObjectHint } from './objects/ObjectBlock';

/**
 * Custom <pre> renderer for react-markdown that adds a copy-to-clipboard button.
 *
 * For language-tagged blocks, CustomCode/SyntaxHighlighter already renders its own
 * container, so this component wraps it in a relative-positioned div and overlays
 * the copy button without duplicating the <pre> tag. Mermaid blocks suppress the
 * copy button since the diagram is an SVG, not copyable source text. Plain (untagged)
 * pre blocks get a normal <pre> with the copy button overlaid.
 *
 * This is also where typed object blocks are dispatched: a `yaml` block whose `type` names a
 * registered object type (see objects/objectRegistry.tsx) renders as that type's card instead
 * of as code. The decision is made here rather than in CustomCode because <pre> owns the whole
 * block — wrapper and copy button included — so the YAML is parsed once, in one place.
 */
// `node` is react-markdown's internal hast node; destructure it out so it isn't
// spread onto the DOM <pre> element (React warns on unknown DOM props).
export default function CustomPre({ children, node, ...props }: React.HTMLAttributes<HTMLPreElement> & ExtraProps) {
  const [copied, setCopied] = useState(false);
  // Pending "Copied!" reset, tracked so a repeat click restarts the 2s window (instead of
  // the earlier click's timer cutting it short) and so unmount cancels it.
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimerRef.current), []);

  const codeElement = children as React.ReactElement;
  const codeProps = codeElement?.props as { className?: string; children?: React.ReactNode } | undefined;
  const languageMatch = /language-(\w+)/.exec(codeProps?.className || '');
  const language = languageMatch?.[1] ?? '';
  const hasLanguage = !!languageMatch;
  const isMermaid = language === 'mermaid';
  // The block's source text: what the copy button copies, and what an object block is parsed from.
  const codeText = nodeToString(codeProps?.children).replace(/\n$/, '');
  const objectBlock = hasLanguage ? resolveObjectBlock(language, codeText) : null;

  // Writes the block's source text to the clipboard.
  // Stops propagation so the click doesn't bubble to the parent entry and trigger edit mode.
  const handleCopy = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    void (async () => {
      try {
        await navigator.clipboard.writeText(codeText);
        setCopied(true);
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        logger.error('Failed to copy:', err);
      }
    })();
  };

  const copyButton = (
    <button
      type="button"
      onClick={handleCopy}
      // The parent entry enters edit mode on mouseup (MarkdownEntry.tsx), not click,
      // so the copy button has to stop that event specifically.
      onMouseUp={(e) => e.stopPropagation()}
      className={BUTTON_CLASS_CODE_COPY}
      title={copied ? 'Copied!' : 'Copy code'}
    >
      {copied ? (
        <ClipboardDocumentCheckIcon className="w-4 h-4 text-green-400" />
      ) : (
        <ClipboardDocumentIcon className="w-4 h-4" />
      )}
    </button>
  );

  if (objectBlock?.kind === 'object') {
    return (
      <ObjectBlock type={objectBlock.type} source={codeText}>
        {objectBlock.element}
      </ObjectBlock>
    );
  }

  if (hasLanguage) {
    return (
      <div className="relative group not-prose mb-4">
        {children}
        {!isMermaid && copyButton}
        {/* A registered object type whose fields don't fit: still code, plus the reason why. */}
        {objectBlock?.kind === 'invalid' && <InvalidObjectHint type={objectBlock.type} error={objectBlock.error} />}
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
