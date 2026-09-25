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
import { removeTOC } from '../../shared/tocUtil';
import { preprocessMathEscapes, stripHtmlComments, preprocessWikiLinks, splitOnColumnBreaks, safeUrlTransform } from '../../shared/mkUtil';
import { BlockClickContext, blockClickComponents } from '../blockClickComponents';
import { MarkdownEntryContext } from '../markdownEntryContext';
import { CustomImage } from '../markdownImgResolver';
import { CustomAnchorWithPath } from '../CustomAnchor';
import CustomCode from '../CustomCode';
import CustomPre from '../CustomPre';

const REMARK_PLUGINS: PluggableList = [remarkFrontmatter, remarkGfm, [remarkMath, { singleDollarTextMath: true }]];
const REHYPE_PLUGINS: PluggableList = [rehypeKatex, rehypeSlug, rehypeCallouts];

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

const ARTICLE_CLASS = 'prose prose-invert prose-base max-w-none prose-hr:border-slate-400 prose-hr:my-2';

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
 */
function MarkdownView({ content, showToc, entryPath, onEditClick }: MarkdownViewProps) {
  const rawContent = showToc ? (content || '') : removeTOC(content || '');
  const processedContent = preprocessWikiLinks(preprocessMathEscapes(stripHtmlComments(rawContent)));
  const columns = splitOnColumnBreaks(processedContent);

  const renderColumn = (text: string, lineOffset: number) => (
    <MarkdownEntryContext.Provider value={entryPath}>
      <BlockClickContext.Provider value={{ onEditClick, lineOffset }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, 1fr)`, gap: '1.5rem' }}>
        {columns.map((col, i) => (
          <article
            key={col.lineOffset}
            className={clsx(ARTICLE_CLASS, i > 0 && 'border-l border-slate-600 pl-6')}
          >
            {renderColumn(col.text, col.lineOffset)}
          </article>
        ))}
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
// useEditMode, so it only changes when this entry's item changes), so memo lets unrelated
// store updates skip the markdown re-parse entirely.
export default memo(MarkdownView);
