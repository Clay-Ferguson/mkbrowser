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
import { setAppError, setCurrentView, setFolderAnalysis, setFolderGraph } from '../store';
import type { ExportOptions } from '../components/dialogs/ExportDialog';

/** Counts the hashtags under `folderPath` and shows them in the Folder Analysis view. */
export function showFolderAnalysis(folderPath: string): void {
  runOp(async () => {
    const result = await api.analyzeFolderHashtags(folderPath);
    setFolderAnalysis({
      hashtags: result.hashtags,
      folderPath,
      totalFiles: result.totalFiles,
    });
    setCurrentView('folder-analysis');
  }, 'Failed to analyze folder: ');
}

/** Scans the tree under `folderPath` and shows it in the Folder Graph view. */
export function showFolderGraph(folderPath: string): void {
  runOp(async () => {
    const result = await api.scanFolderTree(folderPath);
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
