import React from 'react';

/**
 * Flatten a React node into its raw text content.
 *
 * `children` for a rendered code element is usually a single string, but with
 * certain remark/rehype plugins or syntax tokenization it can be an array of
 * strings/elements. Using `String(children)` in that case injects commas
 * (`String(['a','b'])` → `"a,b"`) or yields `"[object Object]"` for elements.
 * This helper recurses through arrays and elements to reconstruct the text.
 */
export function nodeToString(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToString).join('');
  if (React.isValidElement(node)) {
    return nodeToString((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}
