import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';

// ---------------------------------------------------------------------------
// Rehype plugin: add target="_blank" to all <a> tags
// ---------------------------------------------------------------------------

import type { Root, Element } from 'hast';

function rehypeTargetBlank() {
  return (tree: Root) => {
    visitLinks(tree, node => {
      node.properties = node.properties || {};
      node.properties.target = '_blank';
      // Security best practice: add rel="noopener"
      if (typeof node.properties.rel === 'string') {
        // Merge with existing rel
        if (!node.properties.rel.includes('noopener')) {
          node.properties.rel += ' noopener';
        }
      } else {
        node.properties.rel = 'noopener';
      }
    });
  };
}

function visitLinks(tree: any, cb: (node: Element) => void) {
  if (!tree || typeof tree !== 'object') return;
  if (Array.isArray(tree.children)) {
    for (const child of tree.children) {
      visitLinks(child, cb);
    }
  }
  if (tree.type === 'element' && tree.tagName === 'a') {
    cb(tree);
  }
}

// ---------------------------------------------------------------------------
// Processor (shared instance — unified processors are stateless after build)
// ---------------------------------------------------------------------------

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])   // strip front-matter from the AST
  .use(remarkGfm)                     // GitHub-flavoured Markdown (tables, task lists, etc.)
  .use(remarkMath)                    // $...$ and $$...$$ blocks
  .use(remarkRehype)
  .use(rehypeKatex, { output: 'mathml' }) // fully self-contained — no CDN link required
  .use(rehypeTargetBlank)             // <-- add target="_blank" to all links
  .use(rehypeStringify);

// ---------------------------------------------------------------------------
// Embedded default stylesheet
// ---------------------------------------------------------------------------

const DEFAULT_CSS = `
  *, *::before, *::after { box-sizing: border-box; }


  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.65;
    color: #eaeaea;
    background: #181c20;
    margin: 0 40px;
    min-height: 100vh;
    width: calc(100vw - 80px);
    padding: 0 0 2rem 0;
    box-sizing: border-box;
    overflow-x: hidden;
  }

  h1, h2, h3, h4, h5, h6 {
    margin-top: 1.2rem;
    margin-bottom: 0.4rem;
    line-height: 1.25;
    font-weight: 600;
  }
  h1 { font-size: 1.35rem; border-bottom: 2px solid #333a40; padding-bottom: 0.2rem; }
  h2 { font-size: 1.1rem; border-bottom: 1px solid #333a40; padding-bottom: 0.15rem; }
  h3 { font-size: 1.0rem; }
  h4, h5, h6 { font-size: 0.95rem; }

  p { margin: 0 0 1rem; }

  a {
    color: #4fc3f7;
    text-decoration: none;
    transition: color 0.2s;
  }
  a:hover {
    color: #80e1ff;
    text-decoration: underline;
  }

  img { max-width: 100%; height: auto; }

  blockquote {
    margin: 1rem 0;
    padding: 0.5rem 1rem;
    color: #555;
    border-left: 4px solid #dfe2e5;
    background: #f6f8fa;
  }


  p code, li code {
    background: #f0f0f0;
    border-radius: 3px;
    padding: 0.1em 0.35em;
    font-size: 0.9em;
  }

  table {
    border-collapse: collapse;
    width: 100%;
    margin: 1rem 0;
    font-size: 0.95rem;
  }
  th, td {
    border: 1px solid #dfe2e5;
    padding: 0.5rem 0.75rem;
    text-align: left;
  }
  th { background: #f6f8fa; font-weight: 600; }
  tr:nth-child(even) { background: #fafbfc; }

  ul, ol { margin: 0 0 1rem; padding-left: 1.75rem; }
  li { margin-bottom: 0.25rem; }

  hr { border: none; border-top: 1px solid #e1e4e8; margin: 2rem 0; }

  /* |||  column layout */
  .columns {
    display: flex;
    gap: 2rem;
    align-items: flex-start;
    margin: 1rem 0;
    width: 100%;
    max-width: 100%;
    min-height: 60vh;
    box-sizing: border-box;
  }
  .col {
    flex: 1 1 0;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }
`.trim();

// ---------------------------------------------------------------------------
// Column-split delimiter  |||
// ---------------------------------------------------------------------------

/** A line containing only  |||  (optional surrounding whitespace). */
const COLUMN_DELIMITER = /^[|]{3}\s*$/m;

async function renderChunk(md: string): Promise<string> {
  const file = await processor.process(md);
  return String(file);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Converts Markdown source to a fully self-contained HTML document string.
 *
 * - GFM (tables, task lists, strikethrough) is enabled.
 * - LaTeX math ($…$ and $$…$$) is rendered as MathML (no external CSS needed).
 * - Lines containing only `|||` split the content into equal-width CSS flex columns.
 * - Front-matter YAML blocks are silently stripped.
 * - The returned string includes `<!DOCTYPE html>` and an embedded stylesheet;
 *   no external resources are referenced.
 */
export async function convertMDtoHTML(content: string): Promise<string> {
  const chunks = content.split(COLUMN_DELIMITER);

  let bodyHTML: string;

  if (chunks.length === 1) {
    const inner = await renderChunk(chunks[0]);
    bodyHTML = `<main>\n${inner}\n</main>`;
  } else {
    const rendered = await Promise.all(chunks.map(renderChunk));
    const cols = rendered.map(html => `  <div class="col">\n${html}\n  </div>`).join('\n');
    bodyHTML = `<div class="columns">\n${cols}\n</div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
${DEFAULT_CSS}
</style>
</head>
<body>
${bodyHTML}
</body>
</html>
`;
}
