/**
 * Folder HTML export ("Export to Folder (HTML)") tests: the pure link/image
 * rewriting, the page renderer, and full exports of a temp folder tree.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { TypeDefinitions } from '../src/shared/shared';
import {
  hrefBetween,
  resolveExportImage,
  resolveExportLink,
  type ExportManifest,
  type PageLinkContext,
} from '../src/main/htmlExport/exportPaths';
import { renderMarkdownPage } from '../src/main/htmlExport/renderExportPage';
import { exportFolderToHtml } from '../src/main/htmlExport/folderHtmlExport';
import { processTOC } from '../src/shared/tocUtil';

const ROOT = path.resolve('/notes');
const p = (...parts: string[]) => path.join(ROOT, ...parts);

function manifest(): ExportManifest {
  return {
    root: ROOT,
    dirs: new Set([ROOT, p('docs'), p('docs', 'deep'), p('img')]),
    files: new Set([
      p('index.md'),
      p('my notes.md'),
      p('docs', 'guide.md'),
      p('docs', 'deep', 'leaf.md'),
      p('docs', 'manual.pdf'),
      p('img', 'logo.png'),
      p('docs', 'pic.png'),
    ]),
    idToPath: new Map([['ABC123', p('docs', 'deep', 'leaf.md')]]),
  };
}

function ctx(mdPath: string, indexPages = true): PageLinkContext {
  return { manifest: manifest(), mdPath, indexPages };
}

describe('hrefBetween', () => {
  it('links .md targets as .html and percent-encodes each segment', () => {
    expect(hrefBetween(p('docs', 'guide.md'), p('my notes.md'), 'file', true)).toBe('../my%20notes.html');
  });

  it('links folders to their index page, or to the folder itself without index pages', () => {
    expect(hrefBetween(p('index.md'), p('docs'), 'dir', true)).toBe('docs/_index.html');
    expect(hrefBetween(p('index.md'), p('docs'), 'dir', false)).toBe('docs/');
    expect(hrefBetween(p('index.md'), ROOT, 'dir', false)).toBe('./');
  });
});

describe('resolveExportLink', () => {
  it('keeps in-page anchors', () => {
    expect(resolveExportLink('#intro', undefined, ctx(p('index.md')))).toEqual({ href: '#intro', external: false });
  });

  it('rewrites relative .md links, keeping a heading fragment', () => {
    expect(resolveExportLink('docs/guide.md#setup', undefined, ctx(p('index.md'))).href).toBe('docs/guide.html#setup');
    expect(resolveExportLink('../index.md', undefined, ctx(p('docs', 'guide.md'))).href).toBe('../index.html');
  });

  it('decodes percent-encoded destinations before resolving', () => {
    expect(resolveExportLink('my%20notes.md', undefined, ctx(p('index.md'))).href).toBe('my%20notes.html');
  });

  it('links folders according to the index-pages option', () => {
    expect(resolveExportLink('docs', undefined, ctx(p('index.md'), true)).href).toBe('docs/_index.html');
    expect(resolveExportLink('docs/', undefined, ctx(p('index.md'), false)).href).toBe('docs/');
  });

  it('links other copied files as they are', () => {
    expect(resolveExportLink('docs/manual.pdf', undefined, ctx(p('index.md'))).href).toBe('docs/manual.pdf');
  });

  it('repairs a moved target through its id: title', () => {
    expect(resolveExportLink('old/place.md', 'id:ABC123', ctx(p('index.md'))).href).toBe('docs/deep/leaf.html');
  });

  it('finds the .md file of an extension-less wikilink target', () => {
    expect(resolveExportLink('docs/guide', undefined, ctx(p('index.md'))).href).toBe('docs/guide.html');
  });

  it('leaves missing and outside-the-export targets unchanged', () => {
    expect(resolveExportLink('missing.md', undefined, ctx(p('index.md'))).href).toBe('missing.md');
    expect(resolveExportLink('../elsewhere/x.md', undefined, ctx(p('index.md'))).href).toBe('../elsewhere/x.md');
  });

  it('opens web links in a new tab, keeps mailto:/tel: in place, and drops dangerous schemes', () => {
    expect(resolveExportLink('https://example.com', undefined, ctx(p('index.md')))).toEqual({ href: 'https://example.com', external: true });
    expect(resolveExportLink('mailto:a@b.c', undefined, ctx(p('index.md')))).toEqual({ href: 'mailto:a@b.c', external: false });
    expect(resolveExportLink('javascript:alert(1)', undefined, ctx(p('index.md'))).href).toBeNull();
    expect(resolveExportLink('tel:+15551234567', undefined, ctx(p('index.md')))).toEqual({ href: 'tel:+15551234567', external: false });
  });
});

describe('resolveExportImage', () => {
  it('resolves relative to the page folder', () => {
    expect(resolveExportImage('pic.png', ctx(p('docs', 'guide.md')))).toBe('pic.png');
    expect(resolveExportImage('../img/logo.png', ctx(p('docs', 'guide.md')))).toBe('../img/logo.png');
  });

  it('walks up ancestor folders like the in-app resolver', () => {
    expect(resolveExportImage('img/logo.png', ctx(p('docs', 'deep', 'leaf.md')))).toBe('../../img/logo.png');
  });

  it('passes through URLs and leaves missing images unchanged', () => {
    expect(resolveExportImage('https://x.test/a.png', ctx(p('index.md')))).toBe('https://x.test/a.png');
    expect(resolveExportImage('data:image/png;base64,AAAA', ctx(p('index.md')))).toBe('data:image/png;base64,AAAA');
    expect(resolveExportImage('nope.png', ctx(p('index.md')))).toBe('nope.png');
  });
});

const TYPE_DEFS: TypeDefinitions = {
  person: {
    description: 'A person',
    properties: {
      name: { type: 'text', description: '' },
      email: { type: 'email', description: 'Work email' },
      phone: { type: 'phone', description: '' },
    },
  },
} as unknown as TypeDefinitions;

describe('renderMarkdownPage', () => {
  it('renders a typed object block as a card with linked values', async () => {
    const md = '```yaml\ntype: person\nname: Ada Lovelace\nemail: ada@example.com\nphone: +1 (555) 123-4567\nnickname: Ada\n```\n';
    const html = await renderMarkdownPage(md, ctx(p('index.md')), TYPE_DEFS);
    expect(html).toContain('class="object-block"');
    expect(html).toContain('data-object-type="person"');
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('<a class="object-value" href="mailto:ada@example.com" title="Work email">ada@example.com</a>');
    expect(html).toContain('class="object-label object-unknown"');
    expect(html).toContain('<a class="object-value" href="tel:+15551234567" title="phone">+1 (555) 123-4567</a>');
    expect(html).not.toContain('<pre>');
  });

  it('keeps an invalid object as code and adds the hint', async () => {
    const md = '```yaml\ntype: person\nname: [1, 2]\n```\n';
    const html = await renderMarkdownPage(md, ctx(p('index.md')), TYPE_DEFS);
    expect(html).toContain('<pre>');
    expect(html).toContain('class="invalid-object-hint"');
    expect(html).toContain('Invalid person:');
  });

  it('leaves a block of an undefined type as an ordinary code block', async () => {
    const html = await renderMarkdownPage('```yaml\ntype: robot\nname: R2\n```\n', ctx(p('index.md')), TYPE_DEFS);
    expect(html).toContain('<pre><code class="language-yaml">');
    expect(html).not.toContain('object-block');
  });

  it('gives headings the same slugs the generated TOC links to', async () => {
    const md = await processTOC('<!-- TOC -->\n\n# Getting Started\n\n## Q & A\n\n## Q & A\n');
    const html = await renderMarkdownPage(md, ctx(p('index.md')), {});
    for (const [, slug] of md.matchAll(/\]\(#([^)]+)\)/g)) {
      expect(html).toContain(`id="${slug}"`);
    }
    expect(html).toContain('id="q--a-1"');
  });

  it('splits ||| pages into columns and links the stylesheet at the right depth', async () => {
    const html = await renderMarkdownPage('left\n|||\nright\n', ctx(p('docs', 'deep', 'leaf.md')), {});
    expect(html).toContain('class="columns"');
    expect(html.match(/class="col"/g)).toHaveLength(2);
    expect(html).toContain('<link rel="stylesheet" href="../../style.css">');
  });

  it('strips front matter and HTML comments and renders math as MathML', async () => {
    const html = await renderMarkdownPage('---\nid: X\n---\n<!-- secret -->\nInline $x^2$ math\n', ctx(p('index.md')), {});
    expect(html).not.toContain('id: X');
    expect(html).not.toContain('secret');
    expect(html).toContain('<math');
  });

  it('adds a breadcrumb only when index pages are on', async () => {
    const withNav = await renderMarkdownPage('# Hi\n', ctx(p('docs', 'guide.md'), true), {});
    expect(withNav).toContain('<nav class="breadcrumb"><a href="../_index.html">notes</a>');
    expect(withNav).toContain('<a href="_index.html">docs</a>');
    expect(withNav).toContain('<span class="current">guide</span>');
    const without = await renderMarkdownPage('# Hi\n', ctx(p('docs', 'guide.md'), false), {});
    expect(without).not.toContain('breadcrumb');
  });
});

describe('exportFolderToHtml', () => {
  let tmpDir: string;
  let src: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'html-export-test-'));
    src = path.join(tmpDir, 'src');
    await fs.promises.mkdir(path.join(src, 'sub', 'deeper'), { recursive: true });
    await fs.promises.writeFile(path.join(src, 'home.md'), '# Home\n\n[Sub page](sub/page.md) ![logo](logo.png) [notes](notes.txt) [folder](sub)\n');
    await fs.promises.writeFile(path.join(src, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    await fs.promises.writeFile(path.join(src, 'notes.txt'), 'plain text');
    await fs.promises.writeFile(path.join(src, '.hidden.md'), 'secret');
    await fs.promises.writeFile(path.join(src, 'sub', 'page.md'), '[home](../home.md) ![logo](logo.png)\n');
    await fs.promises.writeFile(path.join(src, 'sub', 'doc.pdf'), '%PDF-1.4');
    await fs.promises.writeFile(path.join(src, 'sub', 'deeper', 'leaf.md'), 'leaf');
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('mirrors the tree: pages as .html, other files copied, style.css at the root', async () => {
    const out = path.join(tmpDir, 'out');
    const result = await exportFolderToHtml(src, out, { indexPages: false }, {}, []);
    expect(result).toMatchObject({ success: true, outputPath: out, pageCount: 3, fileCount: 3, warnings: [] });
    expect(result.entryPage).toBeUndefined();

    const exists = (...parts: string[]) => fs.existsSync(path.join(out, ...parts));
    expect(exists('style.css')).toBe(true);
    expect(exists('home.html')).toBe(true);
    expect(exists('home.md')).toBe(false);
    expect(exists('sub', 'page.html')).toBe(true);
    expect(exists('sub', 'deeper', 'leaf.html')).toBe(true);
    expect(exists('.hidden.md')).toBe(false);
    expect(exists('.hidden.html')).toBe(false);
    expect(exists('_index.html')).toBe(false);

    expect(fs.readFileSync(path.join(out, 'logo.png'))).toEqual(fs.readFileSync(path.join(src, 'logo.png')));
    expect(fs.readFileSync(path.join(out, 'notes.txt'), 'utf8')).toBe('plain text');
    expect(fs.readFileSync(path.join(out, 'sub', 'doc.pdf'), 'utf8')).toBe('%PDF-1.4');

    const home = fs.readFileSync(path.join(out, 'home.html'), 'utf8');
    expect(home).toContain('href="sub/page.html"');
    expect(home).toContain('src="logo.png"');
    expect(home).toContain('href="notes.txt"');
    expect(home).toContain('href="sub/"');
    expect(home).toContain('href="style.css"');

    // The walk-up resolver finds ../logo.png for the bare `logo.png` in sub/page.md.
    const page = fs.readFileSync(path.join(out, 'sub', 'page.html'), 'utf8');
    expect(page).toContain('href="../home.html"');
    expect(page).toContain('src="../logo.png"');
    expect(page).toContain('href="../style.css"');
  });

  it('writes an index page per folder when asked', async () => {
    const out = path.join(tmpDir, 'out');
    const result = await exportFolderToHtml(src, out, { indexPages: true }, {}, []);
    expect(result.entryPage).toBe(path.join(out, '_index.html'));
    for (const dir of ['', 'sub', path.join('sub', 'deeper')]) {
      expect(fs.existsSync(path.join(out, dir, '_index.html'))).toBe(true);
    }
    const rootIndex = fs.readFileSync(path.join(out, '_index.html'), 'utf8');
    expect(rootIndex).toContain('href="sub/_index.html"');
    expect(rootIndex).toContain('href="home.html"');
    expect(rootIndex).toContain('href="notes.txt"');
    expect(rootIndex).not.toContain('logo.png');
    expect(fs.readFileSync(path.join(out, 'home.html'), 'utf8')).toContain('href="sub/_index.html"');
  });

  it('skips ignored paths', async () => {
    const out = path.join(tmpDir, 'out');
    const result = await exportFolderToHtml(src, out, { indexPages: false }, {}, ['deeper']);
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(out, 'sub', 'deeper'))).toBe(false);
  });

  it('refuses an output folder that already exists', async () => {
    const out = path.join(tmpDir, 'existing');
    await fs.promises.mkdir(out);
    const result = await exportFolderToHtml(src, out, { indexPages: true }, {}, []);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exists/);
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it('refuses an output folder inside the source', async () => {
    const result = await exportFolderToHtml(src, path.join(src, 'export'), { indexPages: true }, {}, []);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot be inside/);
    expect(fs.existsSync(path.join(src, 'export'))).toBe(false);
  });

  it('lets a page win over a same-named .html file and reports it', async () => {
    await fs.promises.writeFile(path.join(src, 'home.html'), '<p>stale</p>');
    const out = path.join(tmpDir, 'out');
    const result = await exportFolderToHtml(src, out, { indexPages: false }, {}, []);
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(fs.readFileSync(path.join(out, 'home.html'), 'utf8')).toContain('<h1 id="home">Home</h1>');
  });
});
