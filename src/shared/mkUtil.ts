export function preprocessMathEscapes(content: string): string {
  return content.replace(/\\\$/g, '&#36;');
}

/** URL schemes we allow markdown links to use. `file`/`local-file` are needed
 *  for this app's local-file links, which react-markdown would otherwise strip. */
const ALLOWED_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'file', 'local-file']);

/**
 * Sanitizer for react-markdown's `urlTransform`. react-markdown's built-in
 * sanitizer strips any URL whose scheme isn't in its default whitelist, which
 * would silently drop the `file://` links this app supports. Rather than
 * disabling sanitization entirely (which would let `javascript:` and other
 * dangerous schemes through), this allow-lists only the schemes we need and
 * returns '' for anything else.
 *
 * URLs with no scheme — relative paths, in-page anchors (#section), and
 * query-only links — are passed through untouched; CustomAnchor resolves them.
 */
export function safeUrlTransform(url: string): string {
  // A leading scheme matches [a-z][a-z0-9+.-]* followed by ':'. The pattern
  // won't match a relative path that merely contains a colon (e.g. `a/b:c`),
  // since the disallowed chars before the colon break the match.
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!match) return url;
  return ALLOWED_URL_SCHEMES.has(match[1].toLowerCase()) ? url : '';
}

export function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Preprocess wikilinks: convert [[target]] and [[target|alias]] syntax
 * into standard markdown links before rendering.
 *
 * Supports:
 *   [[file]]              → [file](file)
 *   [[file|description]]  → [description](file)
 *   [[file#section]]      → [file#section](file#section)
 *   [[file#section|desc]] → [desc](file#section)
 */
export function preprocessWikiLinks(content: string): string {
  return content.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const pipeIndex = inner.indexOf('|');
    if (pipeIndex !== -1) {
      const target = inner.slice(0, pipeIndex).trim();
      const alias = inner.slice(pipeIndex + 1).trim();
      return `[${alias}](${target})`;
    }
    return `[${inner}](${inner})`;
  });
}

export interface ColumnChunk {
  text: string;
  lineOffset: number; // 0-based line index in the original content where this column's text begins
}

export function splitOnColumnBreaks(content: string): ColumnChunk[] {
  const lines = content.split('\n');
  const chunks: ColumnChunk[] = [];
  let current: string[] = [];
  let currentStart = 0;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();
    if (/^(`{3,}|~{3,})/.test(trimmed)) {
      inFence = !inFence;
    }
    if (!inFence && trimmed === '|||') {
      const joined = current.join('\n');
      const leadingBlanks = Math.max(0, joined.split('\n').findIndex(l => l.trim() !== ''));
      chunks.push({ text: joined.trim(), lineOffset: currentStart + leadingBlanks });
      currentStart = i + 1;
      current = [];
    } else {
      current.push(line);
    }
  }
  const joined = current.join('\n');
  const leadingBlanks = Math.max(0, joined.split('\n').findIndex(l => l.trim() !== ''));
  chunks.push({ text: joined.trim(), lineOffset: currentStart + leadingBlanks });
  return chunks;
}
