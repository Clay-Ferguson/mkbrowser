import type { Root } from 'hast';
import GithubSlugger from 'github-slugger';
import { textOf, walkElements } from './hastUtil';

const HEADING_RE = /^h[1-6]$/;

/**
 * Rehype plugin for the folder HTML export: gives each heading a GitHub-style
 * slug `id`, so `#heading` and `page.md#heading` links (and generated TOCs) land
 * on it. Same slugger as rehype-slug in the app and mdast-util-toc in tocUtil.ts;
 * rehype-slug itself is a renderer-only devDependency. A fresh slugger per tree
 * numbers duplicate headings (`-1`, `-2`, …) exactly as rehype-slug does.
 */
export function rehypeHeadingIds() {
  return (tree: Root) => {
    const slugger = new GithubSlugger();
    walkElements(tree, (el) => {
      if (HEADING_RE.test(el.tagName) && el.properties.id === undefined) {
        el.properties.id = slugger.slug(textOf(el));
      }
    });
  };
}
