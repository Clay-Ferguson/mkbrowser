import { memo } from 'react';
import { clsx } from 'clsx';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import type { PluggableList } from 'unified';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import 'katex/dist/katex.min.css';
import { rehypeCallouts } from '../../shared/rehypeCallouts';
import { rehypeDates } from '../../shared/rehypeDates';
import { lineAfterRemoveTOC, removeTOC, remarkTocList } from '../../shared/tocUtil';
import { preprocessMathEscapes, stripHtmlComments, preprocessWikiLinks, splitOnColumnBreaks, safeUrlTransform } from '../../shared/mkUtil';
import { BlockClickContext, blockClickComponents } from '../blockClickComponents';
import { MarkdownEntryContext } from '../markdownEntryContext';
import { CustomImage } from '../markdownImgResolver';
import { CustomAnchorWithPath } from '../CustomAnchor';
import CustomCode from '../CustomCode';
import CustomPre from '../CustomPre';

// GFM, front matter, math, and TOC lists. See: (USER_GUIDE.md#markdown-support)
const REMARK_PLUGINS: PluggableList = [remarkFrontmatter, remarkGfm, [remarkMath, { singleDollarTextMath: true }], remarkTocList];
// rehypeDates runs before rehypeKatex so math is still a `code` element it skips.
const REHYPE_PLUGINS: PluggableList = [rehypeDates, rehypeKatex, rehypeSlug, rehypeCallouts];

// Module-stable components so react-markdown reconciles in place instead of remounting the
// whole block tree each render. Per-render inputs reach them through context: onEditClick and
// the column line offset via BlockClickContext, the entry path (for resolving relative links
// and images) via MarkdownEntryContext.
const MARKDOWN_COMPONENTS: Components = {
  ...blockClickComponents,
  a: CustomAnchorWithPath,
  img: CustomImage,
  code: CustomCode,
  pre: CustomPre,
};

const PROSE_CLASS = 'prose prose-invert prose-base prose-hr:border-slate-400 prose-hr:my-2';
const ARTICLE_CLASS = `${PROSE_CLASS} max-w-none`;

// `|||` columns are a wrapping flex row, responsive to the window width: one per row below `sm`
// (a phone in portrait), two per row from `sm` (a phone in landscape, a tablet), and all in one
// row from `lg`. A flex item never shrinks below its min-content width, so a column holding a word
// too long to wrap widens just enough to fit it, and when the columns' widths can't all fit in the
// row, the extra columns wrap onto the next row instead of running off the right edge.
// `max-w-full` caps that minimum at the row's width, so a word wider than the whole view (a long
// URL) is broken by `break-words` as a last resort. Code blocks don't wrap, so
// `contain-inline-size` keeps a long code line from widening its column; it scrolls instead.
// The exported HTML (exportMDtoHTML.ts, htmlExport/exportStyles.ts) mirrors this in plain CSS.
//
// Dividers: wrap points depend on the content, so every column draws a top and a left border
// (centered in the gap by the matching padding) and the row is pulled up and left by a gap plus
// the border, so the borders of the first row and of each row's first column fall outside the
// scroll container, which clips them (overflow above or left of it is unreachable).
// See: (USER_GUIDE.md#column-layout-)
// See: (USER_GUIDE.md#column-layout-)
const COLUMNS_SCROLL_CLASS = 'overflow-x-auto';
const COLUMNS_CLASS = 'flex flex-wrap gap-6 -mt-[calc(1.5rem+1px)] -ml-[calc(1.5rem+1px)]';
const COLUMN_CLASS = clsx(
  'grow basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-0 max-w-full break-words',
  'border-t border-l border-slate-600 pt-6 pl-6 [&_pre]:contain-inline-size',
);

interface MarkdownViewProps {
  content: string;
  /** When false, the table-of-contents block is stripped before rendering. */
  showToc: boolean;
  /** Used to scope link/image resolution (supplied to them via MarkdownEntryContext). */
  entryPath: string;
  /** Clicking a rendered block opens the editor at that source line. */
  onEditClick: (goToLine?: number) => void | Promise<void>;
}

/**
 * Renders markdown content through the shared remark/rehype pipeline. Supports
 * multi-column documents (split on `|||`); single- and multi-column paths share
 * the same plugin and component configuration so it lives in one place.
 *
 * See: (USER_GUIDE.md#markdown-support)
 * See: (USER_GUIDE.md#column-layout-)
 */
function MarkdownView({ content, showToc, entryPath, onEditClick }: MarkdownViewProps) {
  const rawContent = showToc ? (content || '') : removeTOC(content || '');
  const processedContent = preprocessWikiLinks(preprocessMathEscapes(stripHtmlComments(rawContent)), true);
  const columns = splitOnColumnBreaks(processedContent);

  // Block positions are lines of rawContent, but the editor is loaded with removeTOC(content),
  // so with showToc on every line below the generated TOC must be shifted up to match.
  const handleEditClick = (goToLine?: number) =>
    onEditClick(goToLine === undefined ? undefined : lineAfterRemoveTOC(rawContent, goToLine));

  const renderColumn = (text: string, lineOffset: number) => (
    <MarkdownEntryContext.Provider value={entryPath}>
      <BlockClickContext.Provider value={{ onEditClick: handleEditClick, lineOffset }}>
        <Markdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          // react-markdown strips any URL whose scheme isn't in its default whitelist, so file://
          // links would be silently dropped. safeUrlTransform allow-lists the schemes we need
          // (incl. file://) while still blocking dangerous ones like javascript:.
          urlTransform={safeUrlTransform}
          components={MARKDOWN_COMPONENTS}
        >
          {text}
        </Markdown>
      </BlockClickContext.Provider>
    </MarkdownEntryContext.Provider>
  );

  if (columns.length > 1) {
    return (
      <div className={COLUMNS_SCROLL_CLASS}>
        <div className={COLUMNS_CLASS}>
          {columns.map((col, i) => (
            // Columns are positional (split on `|||`, never reordered), so the index *is* their
            // identity; keying on lineOffset remounted every later column when an earlier one
            // changed length.
            <article
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              className={clsx(PROSE_CLASS, COLUMN_CLASS)}
            >
              {renderColumn(col.text, col.lineOffset)}
            </article>
          ))}
        </div>
      </div>
    );
  }

  const firstColumn = columns[0];
  if (!firstColumn) {
    return (
      <article className={ARTICLE_CLASS}>
        <div className="text-red-500">Error: no content to render.</div>
      </article>
    );
  }

  return (
    <article className={ARTICLE_CLASS}>
      {renderColumn(firstColumn.text, firstColumn.lineOffset)}
    </article>
  );
}

// Props are two strings, a boolean, and onEditClick (memoized by the React Compiler in
// useEditMode on `path` alone — it reads the item from the store at call time), so memo lets
// unrelated store updates, including changes to this entry's own selection/expanded/editing
// state, skip the markdown re-parse entirely.
export default memo(MarkdownView);
