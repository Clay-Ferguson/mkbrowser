// import { logger } from '../utils/logUtil';

export let globalHighlightText: string| null = null;

export function setGlobalHighlightText(text: string | null) {
  globalHighlightText = text;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA']);

export function applyGlobalHighlight(searchText: string | null): void {
  // logger.log('[globalHighlight] called, searchText:', searchText);
  // logger.log('[globalHighlight] CSS.highlights available:', typeof CSS !== 'undefined' && 'highlights' in CSS);

  CSS.highlights.delete('global-search');
  if (!searchText) return;

  const ranges: Range[] = [];
  const lower = searchText.toLowerCase();
  let nodeCount = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    nodeCount++;
    const text = node.textContent ?? '';
    const lowerText = text.toLowerCase();
    let idx = 0;
    while ((idx = lowerText.indexOf(lower, idx)) !== -1) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + searchText.length);
      ranges.push(range);
      const snippet = text.substring(Math.max(0, idx - 15), idx + searchText.length + 15);
      // logger.log('[globalHighlight] match in <' + node.parentElement?.tagName + '>:', JSON.stringify(snippet));
      idx += searchText.length;
    }
  }

  console.debug('[globalHighlight] scanned', nodeCount, 'text nodes, found', ranges.length, 'matches');

  if (ranges.length > 0) {
    CSS.highlights.set('global-search', new Highlight(...ranges));
    // logger.log('[globalHighlight] Highlight registered with', ranges.length, 'ranges');
  }
}
