/**
 * A whole fenced code block: the opening fence line (``` or ~~~, three or more), everything up
 * to the matching closing fence, and that closing line — or the rest of the document when the
 * fence is never closed, which is how markdown itself reads an unclosed fence.
 *
 * Leading whitespace and `>` markers are allowed before a fence so that blocks nested in list
 * items and blockquotes/callouts count too. A backtick fence whose opening line contains
 * another backtick is not a fence (it is inline code, e.g. "```x``` text"), hence the lookahead.
 * The closing fence must use the same character and be at least as long as the opening one.
 */
export const FENCED_BLOCK =
  /^[ \t>]*(?<fence>(?<fenceChar>[`~])\k<fenceChar>{2,})(?:(?<=~)|(?![^\n]*`))[^\n]*(?:\n[\s\S]*?)?(?:\n[ \t>]*\k<fence>\k<fenceChar>*[ \t]*$|(?![\s\S]))/;

/**
 * Replaces every match of `pattern` that lies outside a fenced code block, leaving fenced
 * blocks byte-for-byte intact. The text inside a fence is literal — source code, or data such
 * as YAML where `[[1, 2]]` is a nested list rather than a wikilink — so the preprocessing
 * passes below must not rewrite it.
 *
 * Fences and `pattern` are matched in a single left-to-right scan, so whichever starts first
 * wins: a fence marker inside an HTML comment belongs to the comment, and a comment inside a
 * fence belongs to the fence.
 */
function replaceOutsideFences(content: string, pattern: RegExp, replaceMatch: (match: string) => string): string {
  const scanner = new RegExp(`${FENCED_BLOCK.source}|${pattern.source}`, 'gm');
  let result = '';
  let lastEnd = 0;
  for (const match of content.matchAll(scanner)) {
    const isFence = match.groups?.fence !== undefined;
    result += content.slice(lastEnd, match.index) + (isFence ? match[0] : replaceMatch(match[0]));
    lastEnd = match.index + match[0].length;
  }
  return result + content.slice(lastEnd);
}

/** Replaces escaped dollar signs (`\$`) with the HTML entity `&#36;` so KaTeX
 *  does not interpret them as the start of a math expression. Fenced code blocks
 *  are left untouched. */
export function preprocessMathEscapes(content: string): string {
  return replaceOutsideFences(content, /\\\$/, () => '&#36;');
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
  const scheme = match[1];
  if (!scheme) return url;
  return ALLOWED_URL_SCHEMES.has(scheme.toLowerCase()) ? url : '';
}

/** Removes all HTML comments (`<!-- … -->`) from content, including multi-line ones.
 *  Comments inside fenced code blocks are left untouched. */
export function stripHtmlComments(content: string): string {
  return replaceOutsideFences(content, /<!--[\s\S]*?-->/, () => '');
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
 *
 * Fenced code blocks are left untouched.
 */
export function preprocessWikiLinks(content: string): string {
  return replaceOutsideFences(content, /\[\[[^\]]+\]\]/, (match) => {
    const inner = match.slice(2, -2);
    const pipeIndex = inner.indexOf('|');
    if (pipeIndex !== -1) {
      const target = inner.slice(0, pipeIndex).trim();
      const alias = inner.slice(pipeIndex + 1).trim();
      return `[${alias}](${target})`;
    }
    return `[${inner}](${inner})`;
  });
}

/**
 * A single column's text after splitting on `|||` delimiters.
 * `lineOffset` is the 0-based line index in the original content where this
 * column's first non-blank line begins (used for line-number-accurate error
 * reporting and editor gutter alignment).
 */
export interface ColumnChunk {
  text: string;
  lineOffset: number;
}

/**
 * Splits markdown content on `|||` column-break delimiters (a line containing
 * only `|||`), returning each segment as a `ColumnChunk`. Delimiters inside
 * fenced code blocks are ignored. Whitespace-only leading lines are trimmed from
 * each chunk, and `lineOffset` is adjusted to point at the first real line.
 */
export function splitOnColumnBreaks(content: string): ColumnChunk[] {
  const lines = content.split('\n');
  const chunks: ColumnChunk[] = [];
  let current: string[] = [];
  let currentStart = 0;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
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
