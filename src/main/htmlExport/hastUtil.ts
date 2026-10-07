/**
 * Minimal hast helpers for the folder HTML export's rehype plugins. Hand-rolled
 * (like rehypeCallouts.ts) rather than pulling in unist-util-visit / hastscript,
 * which the main process doesn't ship.
 */
import type { Element, ElementContent, Nodes, Properties, Root, Text } from 'hast';

/** The concatenated text of a node and its descendants (what hast-util-to-string returns). */
export function textOf(node: Nodes): string {
  if (node.type === 'text') return node.value;
  if ('children' in node) return node.children.map((c) => textOf(c as Nodes)).join('');
  return '';
}

/** A node that can hold elements. */
export type HastParent = Root | Element;

/**
 * Calls `cb` for every element below `parent`, parents before children, with the
 * element's own parent and index. `cb` may replace `parent.children[index]`; the
 * walk then descends into the replacement rather than the original.
 */
export function walkElements(parent: HastParent, cb: (el: Element, parent: HastParent, index: number) => void): void {
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child?.type !== 'element') continue;
    cb(child, parent, i);
    const current = parent.children[i];
    if (current?.type === 'element') walkElements(current, cb);
  }
}

/** The element's class list (hast stores `className` as a token list). */
export function classesOf(el: Element): string[] {
  const value = el.properties.className;
  return Array.isArray(value) ? value.map(String) : [];
}

/** Builds an element (a tiny stand-in for hastscript's `h`). */
export function h(tagName: string, properties: Properties = {}, children: Array<ElementContent | string> = []): Element {
  return {
    type: 'element',
    tagName,
    properties,
    children: children.map((c): ElementContent => (typeof c === 'string' ? ({ type: 'text', value: c } as Text) : c)),
  };
}
