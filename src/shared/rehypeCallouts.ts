import type { Nodes, Element, Text } from 'hast';

/**
 * Local rehype plugin: GitHub-style callouts / alerts.
 *
 * Turns a blockquote whose first line is a `[!TYPE]` marker into a styled alert
 * box, matching the GitHub / Obsidian convention:
 *
 *   > [!NOTE]
 *   > Useful information the reader should know.
 *
 * We implement this ourselves (rather than pulling in a package) for two reasons:
 *   1. `remark-gfm` does not support callouts, and adding a dependency is gated.
 *   2. The transform is tiny and self-contained — see `rehypeTargetBlank` in
 *      `exportMDtoHTML.ts` for the same manual-tree-walk pattern.
 *
 * The plugin only *tags* the blockquote (adds `markdown-alert` +
 * `markdown-alert-<type>` classes and prepends a title row); all visual styling
 * lives in CSS (`src/index.css` for the live renderer, the embedded stylesheet
 * in `exportMDtoHTML.ts` for exports). Blockquotes that are not callouts are
 * left completely untouched, so ordinary quotes render exactly as before.
 */

/** Marker type -> human-readable title. Also the set of recognised types. */
const ALERT_TITLES: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

// Matches a leading `[!TYPE]` marker followed by optional trailing spaces and a
// single line break (or the end of the text). `[^\S\r\n]*` is horizontal
// whitespace only, so we consume exactly the marker line and preserve any
// content that follows on the next line within the same text node.
const MARKER_RE = /^\[!(note|tip|important|warning|caution)\][^\S\r\n]*(\r?\n|$)/i;

export function rehypeCallouts() {
  return (tree: Nodes) => {
    walk(tree);
  };
}

/** Post-order walk (children first) so we never re-visit the injected title. */
function walk(node: Nodes): void {
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      walk(child as Nodes);
    }
  }
  if (node.type === 'element' && node.tagName === 'blockquote') {
    applyCallout(node);
  }
}

function applyCallout(blockquote: Element): void {
  // The marker must live in the blockquote's very first element (a paragraph);
  // skip surrounding whitespace-only text nodes that remark-rehype inserts.
  const firstElement = blockquote.children.find(
    (child): child is Element => child.type === 'element',
  );
  if (!firstElement || firstElement.tagName !== 'p') return;

  const firstChild = firstElement.children[0];
  if (!firstChild || firstChild.type !== 'text') return;

  const match = MARKER_RE.exec(firstChild.value);
  if (!match) return;

  const type = match[1]!.toLowerCase();
  const title = ALERT_TITLES[type]!;

  // Strip the marker line; drop the text node entirely if nothing remains so the
  // alert body doesn't start with an empty line.
  firstChild.value = firstChild.value.slice(match[0].length);
  if (firstChild.value === '') {
    firstElement.children.shift();
  }

  // Tag the blockquote for CSS, preserving any classes already present.
  const existing = blockquote.properties.className;
  const classes = Array.isArray(existing)
    ? existing.map(String)
    : existing
      ? [String(existing)]
      : [];
  blockquote.properties.className = [...classes, 'markdown-alert', `markdown-alert-${type}`];

  // Prepend the title row. The icon is supplied by CSS (`::before`), so the
  // markup stays clean and theme-independent.
  const titleNode: Element = {
    type: 'element',
    tagName: 'div',
    properties: { className: ['markdown-alert-title'] },
    children: [{ type: 'text', value: title } as Text],
  };
  blockquote.children.unshift(titleNode);
}
