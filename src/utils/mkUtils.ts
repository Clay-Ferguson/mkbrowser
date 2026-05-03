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

export function splitOnColumnBreaks(content: string): string[] {
  const lines = content.split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (/^(`{3,}|~{3,})/.test(trimmed)) {
      inFence = !inFence;
    }
    if (!inFence && trimmed === '|||') {
      chunks.push(current.join('\n').trim());
      current = [];
    } else {
      current.push(line);
    }
  }
  chunks.push(current.join('\n').trim());
  return chunks;
}
