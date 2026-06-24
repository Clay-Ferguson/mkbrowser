/**
 * Folder graph module - scans a folder recursively and produces a node/link
 * dataset for the FolderGraphView (D3 force-directed graph).
 *
 * Mirrors the exclude/ignore semantics used by folderAnalysis.ts so the
 * graph reflects what the user sees in the browser.
 *
 * Tunables: MAX_DEPTH and MAX_NODES are exported so they can be adjusted
 * later without changing call sites. The scan stops descending past
 * MAX_DEPTH and stops adding nodes once MAX_NODES is reached, in which
 * case `truncated` is set to true on the result.
 */
import path from 'node:path';
import fs from 'node:fs';
import { buildExcludePredicate } from './pathPattern';

/** Hard cap on recursion depth from the root folder (root = 0). */
export const MAX_DEPTH = 10;

/** Hard cap on the number of nodes (files + folders, including root). */
export const MAX_NODES = 2000;

export interface FolderGraphNodeData {
  /** Stable id (full absolute path) */
  id: string;
  /** Display name (basename) */
  name: string;
  /** True if directory */
  isDirectory: boolean;
  /** Depth from the root folder (root = 0) */
  depth: number;
}

export interface FolderGraphLinkData {
  /** Parent node id */
  source: string;
  /** Child node id */
  target: string;
}

export interface FolderGraphResult {
  /** The folder that was scanned (echoed for the renderer) */
  folderPath: string;
  /** All discovered nodes */
  nodes: FolderGraphNodeData[];
  /** Parent->child edges */
  links: FolderGraphLinkData[];
  /** True if the scan hit MAX_NODES and was cut short */
  truncated: boolean;
  /**
   * True if the full (files + folders) scan exceeded MAX_NODES and we fell
   * back to a folders-only scan. Lets the renderer flag the partial view.
   */
  foldersOnly: boolean;
}

/**
 * Build a folder graph for the renderer.
 *
 * We never want to show a partial graph. So we try the richest graph first
 * (files + folders); if that would exceed MAX_NODES we throw it away and
 * retry folders-only; if even that exceeds MAX_NODES we give up and throw,
 * rather than hand back something incomplete.
 *
 * The net effect: the user gets everything if it fits, otherwise a complete
 * folders-only graph if that fits, otherwise nothing.
 */
export async function scanFolderTree(
  folderPath: string,
  ignoredPaths: string[] = [],
): Promise<FolderGraphResult> {
  const full = await scanFolderTreeInternal(folderPath, ignoredPaths, false);
  if (!full.truncated) return full;

  const foldersOnly = await scanFolderTreeInternal(folderPath, ignoredPaths, true);
  if (!foldersOnly.truncated) return foldersOnly;

  throw new Error(
    `Folder graph for "${folderPath}" exceeds the ${MAX_NODES}-node limit even with files excluded.`,
  );
}

/**
 * Recursively scan a folder, producing nodes and parent->child links suitable
 * for a D3 force-directed graph. Stops at MAX_DEPTH and MAX_NODES.
 *
 * When `foldersOnly` is true, files are skipped entirely (no nodes or links).
 *
 * Sorting (folders before files, alphabetical) is applied at each level so
 * the truncation point, when reached, is deterministic.
 */
async function scanFolderTreeInternal(
  folderPath: string,
  ignoredPaths: string[],
  foldersOnly: boolean,
): Promise<FolderGraphResult> {
  const shouldExclude = buildExcludePredicate(ignoredPaths);

  const nodes: FolderGraphNodeData[] = [];
  const links: FolderGraphLinkData[] = [];
  let truncated = false;

  const rootName = path.basename(folderPath) || folderPath;
  nodes.push({ id: folderPath, name: rootName, isDirectory: true, depth: 0 });

  // Iterative BFS so MAX_NODES truncation is breadth-fair (closer nodes win
  // over deeper ones once the cap is reached).
  const queue: Array<{ dirPath: string; depth: number }> = [{ dirPath: folderPath, depth: 0 }];

  while (queue.length > 0) {
    if (nodes.length >= MAX_NODES) {
      truncated = true;
      break;
    }
    const next = queue.shift();
    if (!next) break;
    const { dirPath, depth } = next;
    if (depth >= MAX_DEPTH) continue;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    for (const entry of entries) {
      if (nodes.length >= MAX_NODES) {
        truncated = true;
        break;
      }
      const childPath = path.join(dirPath, entry.name);
      if (shouldExclude(entry.name, childPath)) continue;

      const isDirectory = entry.isDirectory();
      if (foldersOnly && !isDirectory) continue;
      nodes.push({ id: childPath, name: entry.name, isDirectory, depth: depth + 1 });
      links.push({ source: dirPath, target: childPath });

      if (isDirectory) {
        queue.push({ dirPath: childPath, depth: depth + 1 });
      }
    }
  }

  return { folderPath, nodes, links, truncated, foldersOnly };
}
