import type { Nodes, Element } from 'hast';
import { buildMapUrl } from './objects/objectUrls';
import { decodeMarkdownUrl } from './markdownLinks';

/**
 * Local rehype plugin: map links.
 *
 * Turns a Markdown link whose destination uses the app's own `map:` scheme into a map
 * search link built from `MAP_URL_TEMPLATE` (the same one the `address` property of an
 * object card uses):
 *
 *   [123 Main St, Springfield, IL](map:)                → searches for the link text
 *   [Mom's house](<map:123 Main St, Springfield, IL>)   → searches for the address after `map:`
 *
 * The document stores the address, not a map service's URL, so changing the template
 * changes every map link. The rewritten `href` is an ordinary `https:` URL, so the app's
 * link handler (CustomAnchor) and the HTML exports treat it like any other web link.
 * A `map:` link with no address at all is left alone, and the URL sanitizers (which don't
 * allow the `map:` scheme) then drop its `href`.
 *
 * Runs in every Markdown → HTML pipeline: MarkdownView, exportMDtoHTML.ts, and the folder
 * export's renderExportPage.ts (ahead of its link rewriting).
 *
 * See: (USER_GUIDE.md#map-links)
 */
export function rehypeMapLinks() {
  return (tree: Nodes) => {
    walk(tree);
  };
}

const MAP_SCHEME_RE = /^map:/i;

function walk(node: Nodes): void {
  if (node.type === 'element' && node.tagName === 'a') {
    rewriteMapLink(node);
    return;
  }
  if ('children' in node) {
    for (const child of node.children) walk(child as Nodes);
  }
}

function rewriteMapLink(link: Element): void {
  const href = link.properties.href;
  if (typeof href !== 'string' || !MAP_SCHEME_RE.test(href)) return;
  // remark-rehype percent-encodes the destination (spaces become %20), so decode it first.
  const address = decodeMarkdownUrl(href.slice('map:'.length)).trim() || textOf(link).trim();
  if (address === '') return;
  link.properties.href = buildMapUrl(address);
}

/** The concatenated text of a node and its descendants. */
function textOf(node: Nodes): string {
  if (node.type === 'text') return node.value;
  if ('children' in node) return node.children.map((child) => textOf(child as Nodes)).join('');
  return '';
}
