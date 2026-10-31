/**
 * "Export to Folder (HTML)": mirrors a folder tree into a new output folder that
 * can be browsed with nothing but a web browser. Every `.md` file becomes a `.html`
 * page at the same relative path (with the stylesheet embedded, so each page
 * renders on its own), every other file is copied as is, and (optionally) each folder gets a
 * generated `_index.html` listing its contents.
 *
 * Document Mode folders (those with an `.INDEX.yaml`) are exported in their
 * document order, and each of their entries gets an ordinal prefix (`0001_`,
 * `0002_`, …) so that a plain directory listing (a file manager, Google Drive)
 * shows them in that order too. Pages, index pages and breadcrumbs still show the
 * original names; only the file and folder names on disk change.
 * See: (docs/technical_notes/document_mode.md)
 *
 * Two passes: a walk of the source builds the manifest (every exported file and
 * folder, plus front-matter ids for link repair), then the output is written. Link
 * and image rewriting resolve against the manifest, so a page can only link to
 * something the export actually contains.
 *
 * See: (USER_GUIDE.md#export-to-folder-html)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HtmlExportOptions, HtmlExportResult, HtmlExportTargetCheck, TypeDefinitions } from '../../shared/shared';
import { EXPORTS_FOLDER_ERROR, isUnderExportsFolder } from '../../shared/shared';
import { buildExcludePredicate } from '../../shared/pathPattern';
import { mapWithConcurrency } from '../../shared/asyncUtil';
import { toErrorMessage } from '../../shared/logUtil';
import { getSortedDirEntries, readIndexYaml } from '../indexUtil';
import { frontMatterIdOf } from '../findById';
import { INDEX_PAGE_NAME, isInsideOrEqual, isMarkdownPath, outputSegments, toOutputPath } from './exportPaths';
import type { ExportManifest } from './exportPaths';
import { renderFolderIndex, renderMarkdownPage } from './renderExportPage';
import type { IndexChild } from './renderExportPage';

/** Files converted or copied at once. */
const WRITE_CONCURRENCY = 8;

/**
 * Minimum digits of a Document Mode ordinal prefix (`0001_`); more are used past 9999 entries.
 *
 * See: (USER_GUIDE.md#export-to-folder-html)
 */
const ORDINAL_MIN_DIGITS = 4;

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
 *
 * In a Document Mode folder every exported entry is recorded in `manifest.renamed`
 * under its ordinal-prefixed name. Numbering counts only what is exported, so the
 * prefixes run without gaps even when ignored or unreadable entries are skipped.
 */
async function walkSource(root: string, ignoredPaths: string[]): Promise<SourceTree> {
  const isExcluded = buildExcludePredicate(ignoredPaths);
  const manifest: ExportManifest = { root, dirs: new Set([root]), files: new Set(), idToPath: new Map(), renamed: new Map() };
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

    // The same test getSortedDirEntries orders by, so prefixes always follow the listed order.
    const isDocument = ((await readIndexYaml(dir))?.files.length ?? 0) > 0;
    if (isDocument) {
      const width = Math.max(ORDINAL_MIN_DIGITS, String(listed.length).length);
      listed.forEach((child, i) => {
        manifest.renamed.set(child.srcPath, `${String(i + 1).padStart(width, '0')}_${child.name}`);
      });
    }
  };

  await walk(root);
  return { manifest, children, warnings };
}

/**
 * `p` with every symlink resolved, so two spellings of the same folder compare equal.
 * A path that doesn't exist yet resolves its nearest existing ancestor and keeps the
 * missing tail, so a new folder reached through a symlink is still placed correctly.
 */
async function realPathOf(p: string): Promise<string> {
  const real = await fs.promises.realpath(p).catch(() => null);
  if (real) return real;
  const parent = path.dirname(p);
  return parent === p ? p : path.join(await realPathOf(parent), path.basename(p));
}

/**
 * Checks `out` (already absolute) as the output folder for exporting `root`, before
 * the user is ever asked to overwrite it. It can never be the source itself or a
 * folder inside it, and must lie below a folder named `exports`. When it exists, it
 * is emptied first, so it must also be a real folder (not a file or a symlink) that
 * doesn't contain the source and isn't the filesystem root or the home folder. Paths are compared both as given and with
 * symlinks resolved, so no alias of the source folder gets through.
 *
 * See: (USER_GUIDE.md#export-to-folder-html)
 */
export async function checkExportTarget(root: string, out: string): Promise<HtmlExportTargetCheck> {
  const refuse = (error: string): HtmlExportTargetCheck => ({ error, exists: false });
  const sourceStat = await fs.promises.stat(root).catch(() => null);
  if (!sourceStat?.isDirectory()) return refuse(`The folder to export does not exist: ${root}`);

  const realRoot = await realPathOf(root);
  const realOut = await realPathOf(out);
  if (out === root || realOut === realRoot) return refuse('The output folder is the folder being exported. Choose a different output folder.');
  if (isInsideOrEqual(root, out) || isInsideOrEqual(realRoot, realOut)) {
    return refuse('The output folder cannot be inside the folder being exported.');
  }

  const outStat = await fs.promises.lstat(out).catch(() => null);
  if (outStat && !outStat.isDirectory()) return refuse(`The output path exists but is not a folder: ${out}`);
  if (outStat && (isInsideOrEqual(out, root) || isInsideOrEqual(realOut, realRoot))) {
    return refuse('The output folder cannot contain the folder being exported.');
  }
  if (!isUnderExportsFolder(out)) return refuse(EXPORTS_FOLDER_ERROR);
  if (!outStat) return { error: null, exists: false };
  const home = await realPathOf(os.homedir());
  if (realOut === path.parse(realOut).root || realOut === home) {
    return refuse(`Refusing to overwrite ${out}: choose a dedicated output folder.`);
  }
  return { error: null, exists: true };
}

/**
 * Why the export can't run with these folders, or null when it can. Repeats the
 * dialog's checkExportTarget at export time, so nothing is ever deleted on the
 * strength of an earlier check; an existing folder also needs `overwrite`.
 */
async function validateFolders(root: string, out: string, overwrite: boolean): Promise<string | null> {
  const { error, exists } = await checkExportTarget(root, out);
  if (error) return error;
  if (exists && !overwrite) return `The output folder already exists: ${out}`;
  return null;
}

/** Deletes everything inside `dir` (recursively), keeping the folder itself. Symlinks are removed, never followed. */
async function emptyFolder(dir: string): Promise<void> {
  const entries = await fs.promises.readdir(dir);
  await Promise.all(entries.map((name) => fs.promises.rm(path.join(dir, name), { recursive: true, force: true })));
}

/**
 * Exports `sourceFolder` as a browsable HTML tree into `outputFolder`, which must
 * not lie inside the source. A missing output folder is created (along with any
 * missing parents); an existing one is emptied first when `overwrite` is set, and
 * is an error otherwise. A file that fails to convert or copy is reported in
 * `warnings` rather than aborting the rest of the export.
 *
 * See: (USER_GUIDE.md#export-to-folder-html)
 */
export async function exportFolderToHtml(
  sourceFolder: string,
  outputFolder: string,
  { indexPages, collapsibleObjects, overwrite }: HtmlExportOptions,
  typeDefs: TypeDefinitions,
  ignoredPaths: string[],
): Promise<HtmlExportResult> {
  const root = path.resolve(sourceFolder);
  const out = path.resolve(outputFolder.trim());
  const fail = (error: string): HtmlExportResult => ({ success: false, error, pageCount: 0, fileCount: 0, warnings: [] });

  if (outputFolder.trim() === '') return fail('No output folder was given.');
  const invalid = await validateFolders(root, out, overwrite);
  if (invalid) return fail(invalid);
  if (overwrite && await fs.promises.lstat(out).then(() => true, () => false)) await emptyFolder(out);

  const { manifest, children, warnings } = await walkSource(root, ignoredPaths);
  const toOut = (srcPath: string) => path.join(out, ...outputSegments(manifest, srcPath));
  const outFileOf = (file: string) => (isMarkdownPath(file) ? toOutputPath(toOut(file)) : toOut(file));

  for (const dir of manifest.dirs) {
    await fs.promises.mkdir(toOut(dir), { recursive: true });
  }

  // A page `x.md` is written as `x.html`, so a source `x.html` beside it would collide;
  // the page wins. Compared as output paths, since Document Mode prefixes can rename either side.
  const reserved = new Set<string>();
  for (const file of manifest.files) {
    if (isMarkdownPath(file)) reserved.add(outFileOf(file));
  }

  let pageCount = 0;
  let fileCount = 0;
  await mapWithConcurrency([...manifest.files], WRITE_CONCURRENCY, async (file) => {
    try {
      if (isMarkdownPath(file)) {
        const content = await fs.promises.readFile(file, 'utf-8');
        const html = await renderMarkdownPage(content, { manifest, mdPath: file, indexPages }, typeDefs, collapsibleObjects);
        await fs.promises.writeFile(outFileOf(file), html, 'utf-8');
        pageCount++;
      } else if (reserved.has(toOut(file))) {
        warnings.push(`Skipped ${path.relative(root, file)}: an exported page uses that name.`);
      } else {
        await fs.promises.copyFile(file, toOut(file));
        fileCount++;
      }
    } catch (err) {
      warnings.push(`Failed to export ${path.relative(root, file)}: ${toErrorMessage(err)}`);
    }
  });

  if (indexPages) {
    const outFiles = new Set([...manifest.files].map(outFileOf));
    for (const [dir, listed] of children) {
      const indexOut = path.join(toOut(dir), INDEX_PAGE_NAME);
      // A page or file of the same name already sits there (`_index.md` / `_index.html`).
      if (outFiles.has(indexOut)) {
        warnings.push(`No index page for ${path.relative(root, dir) || path.basename(root)}: it already has a file named ${INDEX_PAGE_NAME}.`);
        continue;
      }
      await fs.promises.writeFile(indexOut, renderFolderIndex(manifest, dir, listed), 'utf-8');
    }
  }

  const rootIndex = path.join(out, INDEX_PAGE_NAME);
  const entryPage = indexPages && await fs.promises.access(rootIndex).then(() => true, () => false) ? rootIndex : undefined;
  return { success: true, outputPath: out, entryPage, pageCount, fileCount, warnings };
}
