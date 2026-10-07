/**
 * "Export to Folder (HTML)": mirrors a folder tree into a new output folder that
 * can be browsed with nothing but a web browser. Every `.md` file becomes a `.html`
 * page at the same relative path, every other file is copied as is, a shared
 * `style.css` goes in the output root, and (optionally) each folder gets a
 * generated `_index.html` listing its contents.
 *
 * Two passes: a walk of the source builds the manifest (every exported file and
 * folder, plus front-matter ids for link repair), then the output is written. Link
 * and image rewriting resolve against the manifest, so a page can only link to
 * something the export actually contains.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { HtmlExportOptions, HtmlExportResult, TypeDefinitions } from '../../shared/shared';
import { buildExcludePredicate } from '../../shared/pathPattern';
import { mapWithConcurrency } from '../../shared/asyncUtil';
import { toErrorMessage } from '../../shared/logUtil';
import { getSortedDirEntries } from '../indexUtil';
import { frontMatterIdOf } from '../findById';
import { INDEX_PAGE_NAME, isInsideOrEqual, isMarkdownPath, toOutputPath } from './exportPaths';
import type { ExportManifest } from './exportPaths';
import { renderFolderIndex, renderMarkdownPage } from './renderExportPage';
import type { IndexChild } from './renderExportPage';
import { STYLE_CSS, STYLE_FILE_NAME } from './exportStyles';

/** Files converted or copied at once. */
const WRITE_CONCURRENCY = 8;

/** The source walk's result: the manifest plus each folder's children in display order. */
interface SourceTree {
  manifest: ExportManifest;
  children: Map<string, IndexChild[]>;
  warnings: string[];
}

/**
 * Walks `root` depth-first in the app's display order (getSortedDirEntries: hidden
 * entries skipped, .INDEX.yaml order honoured), also skipping the user's ignored
 * paths. Only real folders are descended into and only regular files are exported;
 * a symlink counts as whatever it points at, except that symlinked folders are
 * skipped so a link cycle can't run the walk forever.
 */
async function walkSource(root: string, ignoredPaths: string[]): Promise<SourceTree> {
  const isExcluded = buildExcludePredicate(ignoredPaths);
  const manifest: ExportManifest = { root, dirs: new Set([root]), files: new Set(), idToPath: new Map() };
  const children = new Map<string, IndexChild[]>();
  const warnings: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    const listed: IndexChild[] = [];
    children.set(dir, listed);
    // The root's readdir failing is a real error (thrown to the caller); a subfolder's is a warning.
    const entries = dir === root
      ? await getSortedDirEntries(dir)
      : await getSortedDirEntries(dir).catch((err: unknown) => {
        warnings.push(`Could not read folder ${dir}: ${toErrorMessage(err)}`);
        return [];
      });

    for (const entry of entries) {
      if (isExcluded(entry.name, entry.entryPath)) continue;
      if (entry.isDir) {
        manifest.dirs.add(entry.entryPath);
        listed.push({ name: entry.name, srcPath: entry.entryPath, isDir: true });
        await walk(entry.entryPath);
        continue;
      }
      const stat = await fs.promises.stat(entry.entryPath).catch(() => null);
      if (!stat?.isFile()) continue;
      manifest.files.add(entry.entryPath);
      listed.push({ name: entry.name, srcPath: entry.entryPath, isDir: false });
      if (isMarkdownPath(entry.name)) {
        const content = await fs.promises.readFile(entry.entryPath, 'utf-8').catch(() => '');
        const id = frontMatterIdOf(content);
        if (id && !manifest.idToPath.has(id)) manifest.idToPath.set(id, entry.entryPath);
      }
    }
  };

  await walk(root);
  return { manifest, children, warnings };
}

/** Why the export can't run with these folders, or null when it can. */
async function validateFolders(root: string, out: string): Promise<string | null> {
  const sourceStat = await fs.promises.stat(root).catch(() => null);
  if (!sourceStat?.isDirectory()) return `The folder to export does not exist: ${root}`;
  if (isInsideOrEqual(root, out)) return 'The output folder cannot be inside the folder being exported.';
  if (await fs.promises.lstat(out).then(() => true, () => false)) {
    return `The output folder already exists: ${out}\n\nChoose a new folder name; existing folders are never overwritten.`;
  }
  return null;
}

/**
 * Exports `sourceFolder` as a browsable HTML tree into `outputFolder`, which must
 * not exist yet (it is created, along with any missing parents) and must not lie
 * inside the source. A file that fails to convert or copy is reported in
 * `warnings` rather than aborting the rest of the export.
 */
export async function exportFolderToHtml(
  sourceFolder: string,
  outputFolder: string,
  { indexPages }: HtmlExportOptions,
  typeDefs: TypeDefinitions,
  ignoredPaths: string[],
): Promise<HtmlExportResult> {
  const root = path.resolve(sourceFolder);
  const out = path.resolve(outputFolder.trim());
  const fail = (error: string): HtmlExportResult => ({ success: false, error, pageCount: 0, fileCount: 0, warnings: [] });

  if (outputFolder.trim() === '') return fail('No output folder was given.');
  const invalid = await validateFolders(root, out);
  if (invalid) return fail(invalid);

  const { manifest, children, warnings } = await walkSource(root, ignoredPaths);
  const toOut = (srcPath: string) => path.join(out, path.relative(root, srcPath));

  for (const dir of manifest.dirs) {
    await fs.promises.mkdir(toOut(dir), { recursive: true });
  }

  // A page `x.md` is written as `x.html`, so a source `x.html` beside it would collide;
  // the page wins. Likewise the root stylesheet wins over a source `style.css` there.
  const reserved = new Set([path.join(root, STYLE_FILE_NAME)]);
  for (const file of manifest.files) {
    if (isMarkdownPath(file)) reserved.add(toOutputPath(file));
  }

  let pageCount = 0;
  let fileCount = 0;
  await mapWithConcurrency([...manifest.files], WRITE_CONCURRENCY, async (file) => {
    try {
      if (isMarkdownPath(file)) {
        const content = await fs.promises.readFile(file, 'utf-8');
        const html = await renderMarkdownPage(content, { manifest, mdPath: file, indexPages }, typeDefs);
        await fs.promises.writeFile(toOutputPath(toOut(file)), html, 'utf-8');
        pageCount++;
      } else if (reserved.has(file)) {
        warnings.push(`Skipped ${path.relative(root, file)}: an exported page or the stylesheet uses that name.`);
      } else {
        await fs.promises.copyFile(file, toOut(file));
        fileCount++;
      }
    } catch (err) {
      warnings.push(`Failed to export ${path.relative(root, file)}: ${toErrorMessage(err)}`);
    }
  });

  await fs.promises.writeFile(path.join(out, STYLE_FILE_NAME), STYLE_CSS, 'utf-8');

  if (indexPages) {
    for (const [dir, listed] of children) {
      const indexSrc = path.join(dir, INDEX_PAGE_NAME);
      // A page or file of the same name already sits there (`_index.md` / `_index.html`).
      if (reserved.has(indexSrc) || manifest.files.has(indexSrc)) {
        warnings.push(`No index page for ${path.relative(root, dir) || path.basename(root)}: it already has a file named ${INDEX_PAGE_NAME}.`);
        continue;
      }
      await fs.promises.writeFile(toOut(indexSrc), renderFolderIndex(manifest, dir, listed), 'utf-8');
    }
  }

  const rootIndex = path.join(out, INDEX_PAGE_NAME);
  const entryPage = indexPages && await fs.promises.access(rootIndex).then(() => true, () => false) ? rootIndex : undefined;
  return { success: true, outputPath: out, entryPage, pageCount, fileCount, warnings };
}
