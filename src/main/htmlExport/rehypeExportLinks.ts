import type { Root } from 'hast';
import { walkElements } from './hastUtil';
import { resolveExportImage, resolveExportLink, SCHEME_RE } from './exportPaths';
import type { PageLinkContext } from './exportPaths';

/**
 * Rehype plugin for the folder HTML export: rewrites every `<a href>` and
 * `<img src>` on a page so it works inside the exported tree (see
 * resolveExportLink / resolveExportImage). External links open in a new tab;
 * links to other files/folders in the export get the `file-link` class (colored
 * like folders, as in the app); images load lazily.
 */
export function rehypeExportLinks(ctx: PageLinkContext) {
  return (tree: Root) => {
    walkElements(tree, (el) => {
      if (el.tagName === 'a' && typeof el.properties.href === 'string') {
        const title = typeof el.properties.title === 'string' ? el.properties.title : undefined;
        const original = el.properties.href;
        // A path (no scheme, not an in-page #anchor) links to another file or folder.
        const isFileLink = !original.startsWith('#') && !original.startsWith('//') && !SCHEME_RE.test(original);
        const { href, external } = resolveExportLink(el.properties.href, title, ctx);
        if (href === null) {
          delete el.properties.href;
        } else {
          el.properties.href = href;
          if (isFileLink) {
            const existing = Array.isArray(el.properties.className) ? el.properties.className : [];
            el.properties.className = [...existing, 'file-link'];
          }
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
