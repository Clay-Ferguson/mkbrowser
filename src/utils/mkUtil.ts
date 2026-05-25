export function preprocessMathEscapes(content: string): string {
  return content.replace(/\\\$/g, '&#36;');
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
