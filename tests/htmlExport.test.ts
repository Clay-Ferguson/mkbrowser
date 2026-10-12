/**
 * Folder HTML export ("Export to Folder (HTML)") tests: the pure link/image
 * rewriting, the page renderer, and full exports of a temp folder tree.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { TypeDefinitions } from '../src/shared/shared';
import { isUnderExportsFolder } from '../src/shared/shared';
import {
  hrefBetween,
  resolveExportImage,
  resolveExportLink,
  type ExportManifest,
  type PageLinkContext,
} from '../src/main/htmlExport/exportPaths';
import { renderMarkdownPage } from '../src/main/htmlExport/renderExportPage';
import { checkExportTarget, exportFolderToHtml } from '../src/main/htmlExport/folderHtmlExport';
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
    renamed: new Map(),
  };
}

/** A page's <body>, without the embedded stylesheet (whose selectors name the very elements tests look for). */
function bodyOf(html: string): string {
  return html.slice(html.indexOf('<body>'));
}

function ctx(mdPath: string, indexPages = true): PageLinkContext {
  return { manifest: manifest(), mdPath, indexPages };
}

describe('isUnderExportsFolder', () => {
  it('needs a parent folder named exactly "exports"', () => {
    expect(isUnderExportsFolder('/home/me/exports/notes')).toBe(true);
    expect(isUnderExportsFolder('/home/me/exports/a/b/')).toBe(true);
    expect(isUnderExportsFolder('C:\\Users\\me\\exports\\notes')).toBe(true);
    expect(isUnderExportsFolder('/home/me/exports')).toBe(false);
    expect(isUnderExportsFolder('/home/me/exports/')).toBe(false);
    expect(isUnderExportsFolder('/home/me/notes')).toBe(false);
    expect(isUnderExportsFolder('/home/me/my-exports/notes')).toBe(false);
    expect(isUnderExportsFolder('/home/me/Exports/notes')).toBe(false);
    expect(isUnderExportsFolder('')).toBe(false);
  });
});

describe('hrefBetween', () => {
  it('links .md targets as .html and percent-encodes each segment', () => {
    expect(hrefBetween(manifest(), p('docs', 'guide.md'), p('my notes.md'), 'file', true)).toBe('../my%20notes.html');
  });

  it('links folders to their index page, or to the folder itself without index pages', () => {
    expect(hrefBetween(manifest(), p('index.md'), p('docs'), 'dir', true)).toBe('docs/_index.html');
    expect(hrefBetween(manifest(), p('index.md'), p('docs'), 'dir', false)).toBe('docs/');
    expect(hrefBetween(manifest(), p('index.md'), ROOT, 'dir', false)).toBe('./');
  });

  it('links renamed folders and files by their output names, from either side', () => {
    const m = manifest();
    m.renamed.set(p('docs'), '0001_docs');
    m.renamed.set(p('docs', 'guide.md'), '0002_guide.md');
    expect(hrefBetween(m, p('index.md'), p('docs', 'guide.md'), 'file', true)).toBe('0001_docs/0002_guide.html');
    expect(hrefBetween(m, p('docs', 'deep', 'leaf.md'), p('docs', 'guide.md'), 'file', true)).toBe('../0002_guide.html');
    expect(hrefBetween(m, p('docs', 'guide.md'), p('index.md'), 'file', true)).toBe('../index.html');
    expect(hrefBetween(m, p('index.md'), p('docs'), 'dir', true)).toBe('0001_docs/_index.html');
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
  it('renders the front matter\'s object as a card at the top of the page, with linked values', async () => {
    const md = '---\nid: X1\ntype: person\nname: Ada Lovelace\nemail: ada@example.com\nphone: +1 (555) 123-4567\nnickname: Ada\n---\n# Heading\n';
    const html = await renderMarkdownPage(md, ctx(p('index.md')), TYPE_DEFS);
    expect(html).toContain('class="object-block"');
    expect(html).toContain('data-object-type="person"');
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('<a class="object-value" href="mailto:ada@example.com" title="Work email">ada@example.com</a>');
    expect(html).toContain('<a class="object-value" href="tel:+15551234567" title="phone">+1 (555) 123-4567</a>');
    // Front-matter keys the type doesn't define are not part of the object.
    expect(html).not.toContain('nickname');
    expect(html).not.toContain('X1');
    // The card comes before the body.
    expect(bodyOf(html).indexOf('object-block')).toBeLessThan(bodyOf(html).indexOf('<h1'));
    // No inline SVG: rows are marked with a plain bullet and laid out one per source line.
    expect(html).not.toContain('<svg');
    expect(html).toContain('\n<div class="object-row"><span class="object-bullet">•</span><span class="object-label" title="Work email">email</span>');
  });

  it('draws the card once, in the first column only', async () => {
    const md = '---\ntype: person\nname: Ada\n---\nleft\n|||\nright\n';
    const html = await renderMarkdownPage(md, ctx(p('index.md')), TYPE_DEFS);
    const body = bodyOf(html);
    expect(body.match(/class="object-block"/g)).toHaveLength(1);
    expect(body.indexOf('object-block')).toBeLessThan(body.indexOf('<p>left'));
  });

  it('wraps a collapsible object\'s title and rows in details/summary inside the card', async () => {
    const md = '---\ntype: person\nname: Ada Lovelace\nemail: ada@example.com\n---\n';
    const html = await renderMarkdownPage(md, ctx(p('index.md')), TYPE_DEFS, true);
    expect(html).toMatch(/<div class="object-block" data-object-type="person">\n<div class="object-type">person<\/div>\n<details>\n<summary class="object-title" title="name">Ada Lovelace<\/summary>\n<div class="object-rows">[\s\S]*ada@example\.com[\s\S]*<\/div>\n<\/details>\n<\/div>/);
  });

  it('keeps a collapsible object with no other properties as a plain card', async () => {
    const html = await renderMarkdownPage('---\ntype: person\nname: Ada\n---\n', ctx(p('index.md')), TYPE_DEFS, true);
    expect(html).toContain('<div class="object-title" title="name">Ada</div>');
    expect(bodyOf(html)).not.toContain('<details>');
  });

  it('renders no details/summary when objects are not collapsible', async () => {
    const md = '---\ntype: person\nname: Ada Lovelace\nemail: ada@example.com\n---\n';
    const html = await renderMarkdownPage(md, ctx(p('index.md')), TYPE_DEFS, false);
    expect(bodyOf(html)).not.toContain('<details>');
    expect(bodyOf(html)).not.toContain('<summary');
  });

  it('shows the hint instead of a card for an invalid object', async () => {
    const html = await renderMarkdownPage('---\ntype: person\nname: [1, 2]\n---\nBody\n', ctx(p('index.md')), TYPE_DEFS);
    expect(bodyOf(html)).not.toContain('object-block');
    expect(html).toContain('class="invalid-object-hint"');
    expect(html).toContain('Invalid person: name must be text');
  });

  it('draws no card for front matter of an undefined type', async () => {
    const html = await renderMarkdownPage('---\ntype: robot\nname: R2\n---\nBody\n', ctx(p('index.md')), TYPE_DEFS);
    expect(bodyOf(html)).not.toContain('object-block');
  });

  it('leaves a typed yaml block in the body as an ordinary code block', async () => {
    const html = await renderMarkdownPage('```yaml\ntype: person\nname: Ada\n```\n', ctx(p('index.md')), TYPE_DEFS);
    expect(html).toContain('<pre><code class="language-yaml">');
    expect(bodyOf(html)).not.toContain('object-block');
  });

  it('gives headings the same slugs the generated TOC links to', async () => {
    const md = await processTOC('<!-- TOC -->\n\n# Getting Started\n\n## Q & A\n\n## Q & A\n');
    const html = await renderMarkdownPage(md, ctx(p('index.md')), {});
    for (const [, slug] of md.matchAll(/\]\(#([^)]+)\)/g)) {
      expect(html).toContain(`id="${slug}"`);
    }
    expect(html).toContain('id="q--a-1"');
  });

  it('splits ||| pages into columns and embeds the stylesheet', async () => {
    const html = await renderMarkdownPage('left\n|||\nright\n', ctx(p('docs', 'deep', 'leaf.md')), {});
    expect(html).toContain('class="columns"');
    expect(html.match(/class="col"/g)).toHaveLength(2);
    expect(html).toMatch(/<head>[\s\S]*<style>[\s\S]*\.object-block \{[\s\S]*<\/style>[\s\S]*<\/head>/);
    expect(html).not.toContain('<link rel="stylesheet"');
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
    expect(bodyOf(without)).not.toContain('breadcrumb');
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

  it('mirrors the tree: pages as .html, other files copied, no separate stylesheet', async () => {
    const out = path.join(tmpDir, 'exports', 'out');
    const result = await exportFolderToHtml(src, out, { indexPages: false, collapsibleObjects: false, overwrite: false }, {}, []);
    expect(result).toMatchObject({ success: true, outputPath: out, pageCount: 3, fileCount: 3, warnings: [] });
    expect(result.entryPage).toBeUndefined();

    const exists = (...parts: string[]) => fs.existsSync(path.join(out, ...parts));
    expect(exists('style.css')).toBe(false);
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
    // Links to other files/folders in the export are tagged for the folder-amber color.
    expect(home).toContain('href="sub/page.html" class="file-link"');
    expect(home).toContain('src="logo.png"');
    expect(home).toContain('href="notes.txt"');
    expect(home).toContain('href="sub/"');

    // The walk-up resolver finds ../logo.png for the bare `logo.png` in sub/page.md.
    const page = fs.readFileSync(path.join(out, 'sub', 'page.html'), 'utf8');
    expect(page).toContain('href="../home.html"');
    expect(page).toContain('src="../logo.png"');
  });

  it('writes an index page per folder when asked', async () => {
    const out = path.join(tmpDir, 'exports', 'out');
    const result = await exportFolderToHtml(src, out, { indexPages: true, collapsibleObjects: false, overwrite: false }, {}, []);
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
    const out = path.join(tmpDir, 'exports', 'out');
    const result = await exportFolderToHtml(src, out, { indexPages: false, collapsibleObjects: false, overwrite: false }, {}, ['deeper']);
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(out, 'sub', 'deeper'))).toBe(false);
  });

  it('refuses an output folder that already exists', async () => {
    const out = path.join(tmpDir, 'exports', 'existing');
    await fs.promises.mkdir(out, { recursive: true });
    const result = await exportFolderToHtml(src, out, { indexPages: true, collapsibleObjects: false, overwrite: false }, {}, []);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exists/);
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it('with overwrite, empties an existing output folder before exporting', async () => {
    const out = path.join(tmpDir, 'exports', 'existing');
    await fs.promises.mkdir(path.join(out, 'old', 'nested'), { recursive: true });
    await fs.promises.writeFile(path.join(out, 'old', 'nested', 'stale.html'), 'old');
    await fs.promises.writeFile(path.join(out, 'stale.txt'), 'old');
    const result = await exportFolderToHtml(src, out, { indexPages: false, collapsibleObjects: false, overwrite: true }, {}, []);
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(out, 'old'))).toBe(false);
    expect(fs.existsSync(path.join(out, 'stale.txt'))).toBe(false);
    expect(fs.existsSync(path.join(out, 'home.html'))).toBe(true);
  });

  it('with overwrite, still creates a missing output folder', async () => {
    const out = path.join(tmpDir, 'exports', 'fresh');
    const result = await exportFolderToHtml(src, out, { indexPages: false, collapsibleObjects: false, overwrite: true }, {}, []);
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(out, 'home.html'))).toBe(true);
  });

  it('never overwrites a folder that contains the source, or a file', async () => {
    const byParent = await exportFolderToHtml(src, tmpDir, { indexPages: false, collapsibleObjects: false, overwrite: true }, {}, []);
    expect(byParent.success).toBe(false);
    expect(byParent.error).toMatch(/cannot contain/);
    expect(fs.existsSync(path.join(src, 'home.md'))).toBe(true);

    const file = path.join(tmpDir, 'a-file');
    await fs.promises.writeFile(file, 'keep');
    const byFile = await exportFolderToHtml(src, file, { indexPages: false, collapsibleObjects: false, overwrite: true }, {}, []);
    expect(byFile.success).toBe(false);
    expect(byFile.error).toMatch(/not a folder/);
    expect(fs.readFileSync(file, 'utf8')).toBe('keep');
  });

  it('refuses the source folder itself as the output, even with overwrite, and deletes nothing', async () => {
    const before = fs.readdirSync(src).sort();
    for (const target of [src, `${src}/`, path.join(src, 'sub', '..')]) {
      const result = await exportFolderToHtml(src, target, { indexPages: false, collapsibleObjects: false, overwrite: true }, {}, []);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/is the folder being exported/);
    }
    expect(fs.readdirSync(src).sort()).toEqual(before);
  });

  it('refuses a symlinked alias of the source, and of its parent, and deletes nothing', async () => {
    const before = fs.readdirSync(src).sort();
    const alias = path.join(tmpDir, 'alias');
    await fs.promises.symlink(src, alias);
    const parentAlias = path.join(tmpDir, 'parent-alias');
    await fs.promises.symlink(tmpDir, parentAlias);

    // The alias itself, and the source reached through a symlinked parent: both are the source.
    for (const target of [alias, path.join(parentAlias, 'src')]) {
      const check = await checkExportTarget(src, target);
      expect(check.error).toMatch(/is the folder being exported/);
      const result = await exportFolderToHtml(src, target, { indexPages: false, collapsibleObjects: false, overwrite: true }, {}, []);
      expect(result.success).toBe(false);
    }
    // A new folder inside the source, reached through the alias.
    expect((await checkExportTarget(src, path.join(alias, 'export'))).error).toMatch(/cannot be inside/);
    // The source's parent, reached through the parent alias.
    expect((await checkExportTarget(src, parentAlias)).error).toBeTruthy();
    expect(fs.readdirSync(src).sort()).toEqual(before);
  });

  it('checkExportTarget reports a usable folder and whether it exists', async () => {
    expect(await checkExportTarget(src, path.join(tmpDir, 'exports', 'new'))).toEqual({ error: null, exists: false });
    await fs.promises.mkdir(path.join(tmpDir, 'exports', 'old'), { recursive: true });
    expect(await checkExportTarget(src, path.join(tmpDir, 'exports', 'old'))).toEqual({ error: null, exists: true });
  });

  it('requires an output folder below one named "exports", at export time too', async () => {
    for (const target of [path.join(tmpDir, 'out'), path.join(tmpDir, 'exports'), path.join(tmpDir, 'my-exports', 'out')]) {
      expect((await checkExportTarget(src, target)).error).toMatch(/inside a folder named "exports"/);
      const result = await exportFolderToHtml(src, target, { indexPages: false, collapsibleObjects: false, overwrite: true }, {}, []);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/inside a folder named "exports"/);
    }
    // An existing folder outside `exports` is refused before it could be emptied.
    const keep = path.join(tmpDir, 'precious');
    await fs.promises.mkdir(keep);
    await fs.promises.writeFile(path.join(keep, 'data.txt'), 'keep');
    const result = await exportFolderToHtml(src, keep, { indexPages: false, collapsibleObjects: false, overwrite: true }, {}, []);
    expect(result.success).toBe(false);
    expect(fs.readFileSync(path.join(keep, 'data.txt'), 'utf8')).toBe('keep');
    // Any depth below `exports` is fine.
    expect((await checkExportTarget(src, path.join(tmpDir, 'exports', 'a', 'b'))).error).toBeNull();
  });

  it('refuses an output folder inside the source', async () => {
    const result = await exportFolderToHtml(src, path.join(src, 'export'), { indexPages: true, collapsibleObjects: false, overwrite: false }, {}, []);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot be inside/);
    expect(fs.existsSync(path.join(src, 'export'))).toBe(false);
  });

  it('prefixes the entries of a Document Mode folder with ordinals and links them by those names', async () => {
    const book = path.join(src, 'book');
    await fs.promises.mkdir(path.join(book, 'Intro'), { recursive: true });
    await fs.promises.writeFile(path.join(book, 'Zeta.md'), '[alpha](Alpha.md) ![cover](cover.png) [intro](Intro)\n');
    await fs.promises.writeFile(path.join(book, 'Alpha.md'), 'alpha');
    await fs.promises.writeFile(path.join(book, 'cover.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.promises.writeFile(path.join(book, 'Intro', 'inner.md'), '[zeta](../Zeta.md)\n');
    await fs.promises.writeFile(path.join(book, '.INDEX.yaml'),
      'version: 1\nfiles:\n  - name: Zeta.md\n  - name: Intro\n  - name: Alpha.md\n  - name: cover.png\n');
    await fs.promises.appendFile(path.join(src, 'home.md'), '\n[book alpha](book/Alpha.md)\n');

    const out = path.join(tmpDir, 'exports', 'out');
    const result = await exportFolderToHtml(src, out, { indexPages: true, collapsibleObjects: false, overwrite: false }, {}, []);
    expect(result).toMatchObject({ success: true, warnings: [] });

    expect(fs.readdirSync(path.join(out, 'book')).sort()).toEqual(
      ['0001_Zeta.html', '0002_Intro', '0003_Alpha.html', '0004_cover.png', '_index.html'],
    );
    // Only the Document Mode folder is renamed: the root and its other subfolders are not.
    expect(fs.existsSync(path.join(out, 'home.html'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'book', '0002_Intro', 'inner.html'))).toBe(true);

    const zeta = fs.readFileSync(path.join(out, 'book', '0001_Zeta.html'), 'utf8');
    expect(zeta).toContain('href="0003_Alpha.html"');
    expect(zeta).toContain('src="0004_cover.png"');
    expect(zeta).toContain('href="0002_Intro/_index.html"');
    expect(zeta).toContain('<title>Zeta</title>');
    expect(fs.readFileSync(path.join(out, 'book', '0002_Intro', 'inner.html'), 'utf8')).toContain('href="../0001_Zeta.html"');
    expect(fs.readFileSync(path.join(out, 'home.html'), 'utf8')).toContain('href="book/0003_Alpha.html"');

    // The index page lists the entries in document order, under their original names.
    const index = fs.readFileSync(path.join(out, 'book', '_index.html'), 'utf8');
    const positions = ['>Zeta</a>', '>Intro</a>', '>Alpha</a>'].map((label) => index.indexOf(label));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(index).toContain('href="0002_Intro/_index.html"');
    expect(fs.readFileSync(path.join(out, 'book', '0002_Intro', '_index.html'), 'utf8'))
      .toContain('<a href="../_index.html">book</a>');
  });

  it('lets a page win over a same-named .html file and reports it', async () => {
    await fs.promises.writeFile(path.join(src, 'home.html'), '<p>stale</p>');
    const out = path.join(tmpDir, 'exports', 'out');
    const result = await exportFolderToHtml(src, out, { indexPages: false, collapsibleObjects: false, overwrite: false }, {}, []);
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(fs.readFileSync(path.join(out, 'home.html'), 'utf8')).toContain('<h1 id="home">Home</h1>');
  });
});
