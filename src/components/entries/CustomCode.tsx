import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import MermaidDiagram from './MermaidDiagram';

function CustomCode({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const codeString = String(children).replace(/\n$/, '');

  if (language === 'mermaid') {
    return <MermaidDiagram code={codeString} />;
  }

  if (language) {
    return (
      <SyntaxHighlighter
        style={oneDark as { [key: string]: React.CSSProperties }}
        language={language}
        PreTag="div"
        customStyle={{ margin: 0, border: '1px solid #475569', borderRadius: '0.375rem' }}
      >
        {codeString}
      </SyntaxHighlighter>
    );
  }

  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

export default CustomCode;
