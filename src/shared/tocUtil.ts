import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { toc } from 'mdast-util-toc';
import type { Root, Heading } from 'mdast';
import GithubSlugger from 'github-slugger';
import type { MarkdownHeadingNode } from './types';

const START_TAG = '<!-- TOC -->';
const END_TAG = '<!-- /TOC -->';

// A TOC tag only counts when it stands alone on its own line (allowing the
// markdown-legal indent of up to 3 spaces and spacing variants inside the comment).
// Inline occurrences — in prose, table cells, or code fences — are literal text.
const START_LINE_RE = /^ {0,3}<!--\s*TOC\s*-->\s*$/;
const END_LINE_RE = /^ {0,3}<!--\s*\/TOC\s*-->\s*$/;

interface LineInfo {
  text: string;
  /** Char offset of the line's first character within the source content. */
  start: number;
  /** Char offset just past the line's last character (before the newline). */
  end: number;
  frontMatter: boolean;
  /** True for fenced code block delimiters and everything between them. */
  code: boolean;
}

/**
 * Splits content into lines annotated with their character offsets and whether they
 * fall inside front matter (a YAML block delimited by "---" on the very first line) or
 * a fenced code block (backtick or tilde fences of any length, e.g. ```, ~~~~).
 *
 * This is the single source of truth for "is this line real markdown?", shared by TOC
 * tag lookup and TOC generation so the two can never disagree about what is a fence.
 */
function scanLines(content: string): LineInfo[] {
  let offset = 0;
  const lines: LineInfo[] = content.split('\n').map(text => {
    const info: LineInfo = { text, start: offset, end: offset + text.length, frontMatter: false, code: false };
    offset += text.length + 1; // +1 for the newline
    return info;
  });

  let i = 0;

  // Front matter, if the file starts with "---"
  if (lines[0]?.text.trim() === '---') {
    lines[0]!.frontMatter = true;
    i = 1;
    while (i < lines.length && lines[i]!.text.trim() !== '---') {
      lines[i]!.frontMatter = true;
      i++;
    }
    if (i < lines.length) {
      lines[i]!.frontMatter = true; // closing "---"
      i++;
    }
  }

  // Fenced code blocks. An unterminated fence swallows the rest of the document.
  for (; i < lines.length; i++) {
    const fenceMatch = lines[i]!.text.match(/^(`{3,}|~{3,})/);
    if (!fenceMatch) continue;

    const fence = fenceMatch[1] ?? '';
    const char = fence[0];
    const len = fence.length;
    lines[i]!.code = true;
    i++;
    while (i < lines.length) {
      lines[i]!.code = true;
      const closing = lines[i]!.text.match(/^(`+|~+)/);
      if (closing && closing[1] && closing[1][0] === char && closing[1].length >= len) break;
      i++;
    }
  }

  return lines;
}

interface TocTag {
  kind: 'start' | 'end';
  /** Char offset of the start of the tag's line. */
  lineStart: number;
  /** Char offset of the end of the tag's line (before the newline). */
  lineEnd: number;
}

/**
 * Locates every real TOC tag in content: standalone-line `<!-- TOC -->` / `<!-- /TOC -->`
 * occurrences outside front matter and fenced code blocks, in document order.
 *
 * Used by both removeTOC and processTOC so a document that *documents* the TOC feature
 * (tags shown inside a code fence) is never mistaken for one that *uses* it.
 */
function findTOCTags(content: string): TocTag[] {
  const tags: TocTag[] = [];

  for (const line of scanLines(content)) {
    if (line.frontMatter || line.code) continue;
    if (START_LINE_RE.test(line.text)) {
      tags.push({ kind: 'start', lineStart: line.start, lineEnd: line.end });
    } else if (END_LINE_RE.test(line.text)) {
      tags.push({ kind: 'end', lineStart: line.start, lineEnd: line.end });
    }
  }

  return tags;
}

/**
 * Strips the generated TOC body from content, leaving only the opening tag.
 * Used when loading content into the editor so the user sees `<!-- TOC -->` instead
 * of the full generated list.
 *
 * Only standalone-line tags outside code fences are treated as real TOC tags, and a
 * start tag is only collapsed when a matching end tag follows it, so text that merely
 * *shows* the tags (e.g. documentation inside a fence) is left untouched.
 */
export function removeTOC(content: string): string {
  const tags = findTOCTags(content);
  if (tags.length === 0) return content;

  let out = '';
  let cursor = 0;

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!;
    if (tag.kind !== 'start') continue;

    const next = tags[i + 1];
    if (!next || next.kind !== 'end') continue; // unmatched start tag: leave it as written

    out += content.slice(cursor, tag.lineStart) + START_TAG;
    cursor = next.lineEnd;
    i++; // consume the end tag
  }

  return out + content.slice(cursor);
}

/**
 * Returns a sanitized copy of content safe for TOC generation by removing front matter
 * and blanking fenced code blocks, so headings inside those regions are ignored.
 */
function sanitizeForTOC(content: string): string {
  const body = scanLines(content).filter(l => !l.frontMatter);
  const out: string[] = [];

  for (let i = 0; i < body.length; i++) {
    const line = body[i]!;
    out.push(line.code ? '' : line.text);
  }

  return out.join('\n');
}

/**
 * Generates or updates a Table of Contents in a Markdown string.
 *
 * The TOC is inserted between `<!-- TOC -->` and `<!-- /TOC -->` comment tags.
 * If only the opening tag is present, the closing tag is appended automatically.
 * Returns the content unchanged if no `<!-- TOC -->` tag is found, if multiple
 * such tags exist, or if the document contains no headings.
 *
 * Heading slugs are generated by mdast-util-toc using GitHub-style slugging,
 * which matches the rehype-slug plugin used in the renderer.
 */
export async function processTOC(content: string): Promise<string> {
  const tags = findTOCTags(content);
  const starts = tags.filter(t => t.kind === 'start');

  // Exactly one placeholder, or we leave the document alone.
  if (starts.length !== 1) return content;
  const start = starts[0]!;

  // The closing tag is the first real end tag after the placeholder. End tags inside
  // code fences or sharing a line with other text are not end tags, so the body we
  // overwrite can never run past the user's real content.
  const end = tags.find(t => t.kind === 'end' && t.lineStart > start.lineStart);

  const sanitized = sanitizeForTOC(content);
  const ast = unified().use(remarkParse).parse(sanitized) as Root;
  const result = toc(ast, { maxDepth: 6, tight: true });

  if (!result.map) {
    return content;
  }

  const tocMarkdown = (
    unified()
      .use(remarkStringify)
      .stringify({ type: 'root', children: [result.map] } as Root)
  ).trimEnd();

  if (end) {
    return (
      content.slice(0, start.lineEnd) +
      '\n' + tocMarkdown + '\n' +
      content.slice(end.lineStart)
    );
  }

  return (
    content.slice(0, start.lineEnd) +
    '\n' + tocMarkdown + '\n' +
    END_TAG +
    content.slice(start.lineEnd)
  );
}

/** Extracts the plain text of a heading node by concatenating its inline children. */
function headingText(node: Heading): string {
  return node.children
    .map(child => ('value' in child ? child.value : ''))
    .join('');
}

/**
 * Parse a markdown string and return a tree of MarkdownHeadingNode objects.
 * Heading nesting follows depth (H1 > H2 > H3 …).
 * The synthetic `path` for each node is `filePath + '#' + flatIndex`.
 */
export function extractHeadingTree(filePath: string, content: string): MarkdownHeadingNode[] {
  content = sanitizeForTOC(content);
  const ast = unified().use(remarkParse).parse(content) as Root;
  const headings = ast.children.filter((n): n is Heading => n.type === 'heading');

  const slugger = new GithubSlugger();

  // Build nodes in order, assign synthetic paths and rehype-slug-compatible slugs
  const nodes: MarkdownHeadingNode[] = headings.map((h, i) => {
    const text = headingText(h);
    return {
      path: `${filePath}#${i}`,
      heading: text,
      slug: slugger.slug(text),
      depth: h.depth,
      isExpanded: false,
      isLoading: false,
      children: null,
    };
  });

  // Stack-based tree assembly: stack holds ancestors by depth
  const roots: MarkdownHeadingNode[] = [];
  const stack: MarkdownHeadingNode[] = [];

  for (const node of nodes) {
    // Pop stack until top has a lower depth than current node
    let top = stack[stack.length - 1];
    while (top && top.depth >= node.depth) {
      stack.pop();
      top = stack[stack.length - 1];
    }

    if (!top) {
      roots.push(node);
    } else {
      if (!top.children) top.children = [];
      top.children.push(node);
    }

    stack.push(node);
  }

  return roots;
}
