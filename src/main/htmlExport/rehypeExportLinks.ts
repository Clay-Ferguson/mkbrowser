import type { Root } from 'hast';
import { walkElements } from './hastUtil';
import { resolveExportImage, resolveExportLink } from './exportPaths';
import type { PageLinkContext } from './exportPaths';

/**
 * Rehype plugin for the folder HTML export: rewrites every `<a href>` and
 * `<img src>` on a page so it works inside the exported tree (see
 * resolveExportLink / resolveExportImage). External links open in a new tab;
 * images load lazily.
 */
export function rehypeExportLinks(ctx: PageLinkContext) {
  return (tree: Root) => {
    walkElements(tree, (el) => {
      if (el.tagName === 'a' && typeof el.properties.href === 'string') {
        const title = typeof el.properties.title === 'string' ? el.properties.title : undefined;
        const { href, external } = resolveExportLink(el.properties.href, title, ctx);
        if (href === null) {
          delete el.properties.href;
        } else {
          el.properties.href = href;
        }
        if (external) {
          el.properties.target = '_blank';
          el.properties.rel = ['noopener'];
        }
      } else if (el.tagName === 'img' && typeof el.properties.src === 'string') {
        el.properties.src = resolveExportImage(el.properties.src, ctx);
        el.properties.loading = 'lazy';
      }
    });
  };
}
