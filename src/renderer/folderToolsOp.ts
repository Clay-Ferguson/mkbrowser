/**
 * The folder-level tools behind BrowseView's toolbar and dialogs: hashtag
 * analysis, the folder graph, export, and search-and-replace.
 *
 * Each is a fire-and-forget workflow for a user action (`void`, run through
 * {@link runOp}), so a component only wires a button to it: failures reach the
 * app-wide error dialog, and nothing here needs React state.
 */

import { api } from './api';
import { runOp } from './runOp';
import { refreshDirectory } from './directoryLoader';
import { buildReplaceResultMessage } from '../shared/searchHelpers';
import { setAppError, setCurrentView, setFolderAnalysis, setFolderGraph, setFolderGraphFileLinks, useAS } from '../store';
import type { FolderGraphState } from '../store';
import type { ExportOptions } from '../components/dialogs/ExportDialog';
import type { HtmlExportOptions, HtmlExportResult } from '../shared/shared';
import { getParentPath } from './pathUtil';

/**
 * Ids of the most recently started analysis / graph scan. Both scans can take
 * seconds on a large tree, and the user can start another one (on a different
 * folder) meanwhile; only the latest may publish, or the slower, older scan
 * lands last and replaces the newer results.
 */
let latestAnalysisId = 0;
let latestGraphId = 0;

/** Counts the hashtags under `folderPath` and shows them in the Folder Analysis view. */
export function showFolderAnalysis(folderPath: string): void {
  const id = ++latestAnalysisId;
  runOp(async () => {
    const result = await api.analyzeFolderHashtags(folderPath);
    if (id !== latestAnalysisId) return;
    setFolderAnalysis({
      hashtags: result.hashtags,
      folderPath,
      totalFiles: result.totalFiles,
    });
    setCurrentView('folder-analysis');
  }, 'Failed to analyze folder: ');
}

/**
 * Scans the tree under `folderPath` and shows it in the Folder Graph view.
 * With `markdownOnly`, only `.md` files (and the folders leading to them) are graphed.
 */
export function showFolderGraph(folderPath: string, markdownOnly = false): void {
  const id = ++latestGraphId;
  runOp(async () => {
    const result = await api.scanFolderTree(folderPath, markdownOnly);
    if (id !== latestGraphId) return;
    setFolderGraph({
      folderPath: result.folderPath,
      nodes: result.nodes.map(n => ({ ...n })),
      links: result.links.map(l => ({ ...l })),
      truncated: result.truncated,
      foldersOnly: result.foldersOnly,
    });
    setCurrentView('folder-graph');
  }, 'Failed to scan folder graph: ');
}

/**
 * Scans `graph`'s Markdown files for links to other graph nodes and stores the
 * edges for the Folder Graph view's file-link overlay. Dropped if the graph was
 * replaced (a new scan) while this one ran, since the edges belong to `graph`.
 */
export function loadFolderGraphFileLinks(graph: FolderGraphState): void {
  runOp(async () => {
    const links = await api.scanFolderGraphLinks(graph.folderPath, graph.nodes.map(n => n.id));
    if (useAS.getState().folderGraph !== graph) return;
    setFolderGraphFileLinks(links);
  }, 'Failed to scan folder graph links: ');
}

/**
 * Exports `folderPath`'s contents as one Markdown file (and optionally a PDF of
 * it), then opens the Markdown file when no PDF was asked for. The chosen
 * output folder is remembered, both through `onOutputFolderChosen` and in the
 * persisted config, before the export itself runs.
 */
export function exportFolder(
  folderPath: string,
  { outputFolder, fileName, includeSubfolders, includeFilenames, includeDividers, exportToPdf }: ExportOptions,
  onOutputFolderChosen: (folder: string) => void,
): void {
  setAppError(null);

  runOp(async () => {
    onOutputFolderChosen(outputFolder);
    await api.updateConfig({ lastExportFolder: outputFolder });

    const result = await api.exportFolderContents(folderPath, outputFolder, fileName, includeSubfolders, includeFilenames, includeDividers);

    if (!result.success) {
      setAppError(result.error || 'Failed to export folder contents');
      return;
    }

    if (exportToPdf && result.outputPath) {
      const pdfPath = result.outputPath.replace(/\.md$/i, '.pdf');
      const pdfResult = await api.exportToPdf(result.outputPath, pdfPath, folderPath);

      if (!pdfResult.success) {
        setAppError(pdfResult.error || 'Failed to launch PDF export');
      }
    } else if (result.outputPath) {
      await api.openExternal(result.outputPath);
    }
  }, 'Failed to export folder contents: ');
}

/** Most warnings listed in the export summary; any beyond are only counted. */
const MAX_LISTED_WARNINGS = 10;

/** The summary shown after a successful HTML folder export. */
function buildHtmlExportMessage(result: HtmlExportResult): string {
  const pages = `${result.pageCount} page${result.pageCount === 1 ? '' : 's'}`;
  const files = `${result.fileCount} other file${result.fileCount === 1 ? '' : 's'}`;
  let message = `Exported ${pages} and ${files} to:\n${result.outputPath ?? ''}`;
  const { warnings } = result;
  if (warnings.length > 0) {
    const listed = warnings.slice(0, MAX_LISTED_WARNINGS).map((w) => `• ${w}`).join('\n');
    const more = warnings.length > MAX_LISTED_WARNINGS ? `\n…and ${warnings.length - MAX_LISTED_WARNINGS} more.` : '';
    message += `\n\n${warnings.length} problem${warnings.length === 1 ? '' : 's'}:\n${listed}${more}`;
  }
  return message;
}

/**
 * "Export to Folder (HTML)": exports `folderPath` as a browsable HTML tree into
 * the new folder `outputFolder`, then reports the outcome through `onResult` and,
 * when index pages were generated, opens the root index page in the browser.
 * The output's parent folder is remembered as the last export folder, both
 * through `onOutputFolderChosen` and in the persisted config.
 */
export function exportFolderHtml(
  folderPath: string,
  outputFolder: string,
  options: HtmlExportOptions,
  onOutputFolderChosen: (folder: string) => void,
  onResult: (message: string) => void,
): void {
  setAppError(null);

  runOp(async () => {
    const parentFolder = getParentPath(outputFolder);
    onOutputFolderChosen(parentFolder);
    await api.updateConfig({ lastExportFolder: parentFolder });

    const result = await api.exportFolderToHtml(folderPath, outputFolder, options);
    if (!result.success) {
      setAppError(result.error || 'Failed to export folder to HTML');
      return;
    }

    onResult(buildHtmlExportMessage(result));
    if (result.entryPage) {
      await api.openExternal(result.entryPage);
    }
  }, 'Failed to export folder to HTML: ');
}

/**
 * Replaces `searchText` with `replaceText` in every file under `folderPath`,
 * then reports the per-file outcome (or the failure) through `onResult` and
 * reloads the listing if anything changed.
 */
export function replaceInFolder(
  folderPath: string,
  searchText: string,
  replaceText: string,
  onResult: (message: string) => void,
): void {
  runOp(async () => {
    const results = await api.searchAndReplace(folderPath, searchText, replaceText);
    onResult(buildReplaceResultMessage(results));
    const totalReplacements = results.filter((r) => r.success).reduce((sum, r) => sum + r.replacementCount, 0);
    if (totalReplacements > 0) {
      refreshDirectory();
    }
  }, 'Replace failed: ', onResult);
}
