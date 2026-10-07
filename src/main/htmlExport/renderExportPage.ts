import path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import type { TypeDefinitions } from '../../shared/shared';
import { preprocessMathEscapes, preprocessWikiLinks, splitOnColumnBreaks, stripHtmlComments } from '../../shared/mkUtil';
import { rehypeCallouts } from '../../shared/rehypeCallouts';
import { isImageFile } from '../../shared/fileTypes';
import { hrefBetween, isMarkdownPath, INDEX_PAGE_NAME } from './exportPaths';
import type { ExportManifest, PageLinkContext } from './exportPaths';
import { rehypeHeadingIds } from './rehypeHeadingIds';
import { rehypeObjectBlocks } from './rehypeObjectBlocks';
import { rehypeExportLinks } from './rehypeExportLinks';
import { STYLE_FILE_NAME } from './exportStyles';

/**
 * Page rendering for the folder HTML export. Markdown goes through the same
 * preprocessing as the app's MarkdownView and a remark/rehype chain mirroring its
 * plugins (GFM, math, callouts, heading slugs, typed object cards), but as a
 * standalone Node pipeline: the React renderer itself is untouched. Math is
 * rendered as MathML, so pages need no KaTeX stylesheet or fonts.
 */

/** A folder's children as the export lists them, in the app's display order. */
export interface IndexChild {
  name: string;
  /** Absolute source path. */
  srcPath: string;
  isDir: boolean;
}

/** One step of a page's breadcrumb trail. */
interface Crumb {
  label: string;
  /** Omitted for the current page itself. */
  href?: string;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/** The relative href from a page (any file in `fromDir`) to the stylesheet at the export root. */
function styleHref(root: string, fromDir: string): string {
  const rel = path.relative(fromDir, root);
  return rel === '' ? STYLE_FILE_NAME : `${rel.split(path.sep).join('/')}/${STYLE_FILE_NAME}`;
}

/**
 * The breadcrumb from the export root down to `srcPath` (a page, or a folder for
 * its index page). Every folder links to its index page; the last step is the
 * current page and has no link.
 */
function breadcrumb(manifest: ExportManifest, srcPath: string, isDir: boolean): Crumb[] {
  const pageFile = isDir ? path.join(srcPath, INDEX_PAGE_NAME) : srcPath;
  const rel = path.relative(manifest.root, srcPath);
  const names = rel === '' ? [] : rel.split(path.sep);
  const crumbs: Crumb[] = [];
  let dir = manifest.root;
  const folderCount = isDir ? names.length : names.length - 1;
  crumbs.push({ label: path.basename(manifest.root), href: hrefBetween(pageFile, dir, 'dir', true) });
  for (let i = 0; i < folderCount; i++) {
    dir = path.join(dir, names[i]!);
    crumbs.push({ label: names[i]!, href: hrefBetween(pageFile, dir, 'dir', true) });
  }
  if (!isDir) crumbs.push({ label: pageTitle(srcPath) });
  // The current folder's own crumb (an index page) is not a link to itself.
  const last = crumbs[crumbs.length - 1]!;
  if (isDir) delete last.href;
  return crumbs;
}

function breadcrumbHtml(crumbs: Crumb[]): string {
  const parts = crumbs.map((c) =>
    c.href ? `<a href="${escapeHtml(c.href)}">${escapeHtml(c.label)}</a>` : `<span class="current">${escapeHtml(c.label)}</span>`,
  );
  return `<nav class="breadcrumb">${parts.join('<span class="sep">/</span>')}</nav>\n`;
}

/** A page's title: its file name without the `.md` extension. */
function pageTitle(srcPath: string): string {
  return path.basename(srcPath).replace(/\.md$/i, '');
}

function htmlDocument(title: string, cssHref: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${escapeHtml(cssHref)}">
</head>
<body>
${body}</body>
</html>
`;
}

async function renderChunk(markdown: string, ctx: PageLinkContext, typeDefs: TypeDefinitions): Promise<string> {
  // Built per chunk: the link plugin is bound to this page, and a fresh tree gets a
  // fresh heading slugger (as rehype-slug does per react-markdown instance in the app).
  const file = await unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .use(remarkMath, { singleDollarTextMath: true })
    .use(remarkRehype)
    .use(rehypeKatex, { output: 'mathml' })
    .use(rehypeHeadingIds)
    .use(rehypeCallouts)
    .use(rehypeObjectBlocks, typeDefs)
    .use(rehypeExportLinks, ctx)
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

/**
 * Converts one Markdown file to a complete HTML page for the export. Preprocessing
 * matches MarkdownView (HTML comments stripped, `\$` escapes, wikilinks, `|||`
 * columns); a generated TOC is kept, and its links land on the slugged headings.
 */
export async function renderMarkdownPage(
  content: string,
  ctx: PageLinkContext,
  typeDefs: TypeDefinitions,
): Promise<string> {
  const { manifest, mdPath, indexPages } = ctx;
  const processed = preprocessWikiLinks(preprocessMathEscapes(stripHtmlComments(content)));
  const chunks = splitOnColumnBreaks(processed);
  const rendered = await Promise.all(chunks.map((c) => renderChunk(c.text, ctx, typeDefs)));

  const inner = rendered.length > 1
    ? `<div class="columns" style="grid-template-columns: repeat(${rendered.length}, minmax(0, 1fr))">\n${rendered.map((html) => `<div class="col">\n${html}\n</div>`).join('\n')}\n</div>`
    : (rendered[0] ?? '');

  const nav = indexPages ? breadcrumbHtml(breadcrumb(manifest, mdPath, false)) : '';
  const body = `${nav}<main>\n${inner}\n</main>\n`;
  return htmlDocument(pageTitle(mdPath), styleHref(manifest.root, path.dirname(mdPath)), body);
}

/**
 * The generated `_index.html` for a folder: a breadcrumb, then its subfolders and
 * pages in the app's order (.INDEX.yaml or natural name order), then the other
 * copied files. Images are not listed — they appear on the pages that show them.
 */
export function renderFolderIndex(manifest: ExportManifest, dir: string, children: IndexChild[]): string {
  const indexFile = path.join(dir, INDEX_PAGE_NAME);
  const item = (icon: string, href: string, label: string) =>
    `<li><span class="entry-icon">${icon}</span><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`;

  const listed: string[] = [];
  const others: string[] = [];
  for (const child of children) {
    if (child.isDir) {
      listed.push(item('📁', hrefBetween(indexFile, child.srcPath, 'dir', true), child.name));
    } else if (isMarkdownPath(child.name)) {
      listed.push(item('📄', hrefBetween(indexFile, child.srcPath, 'file', true), pageTitle(child.srcPath)));
    } else if (!isImageFile(child.name)) {
      others.push(item('📎', hrefBetween(indexFile, child.srcPath, 'file', true), child.name));
    }
  }

  const sections = listed.length + others.length === 0
    ? '<p class="empty">This folder has no pages.</p>'
    : [listed, others].filter((l) => l.length > 0).map((l) => `<ul>\n${l.join('\n')}\n</ul>`).join('\n');

  const title = path.basename(dir);
  const body = `${breadcrumbHtml(breadcrumb(manifest, dir, true))}<main class="folder-index">\n<h1>${escapeHtml(title)}</h1>\n${sections}\n</main>\n`;
  return htmlDocument(title, styleHref(manifest.root, dir), body);
}
