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

/** Hard cap on recursion depth from the root folder (root = 0). */
export const MAX_DEPTH = 5;

/** Hard cap on the number of nodes (files + folders, including root). */
export const MAX_NODES = 1000;

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
}

/**
 * Build the same exclude predicate folderAnalysis uses: hidden files/folders
 * (leading dot) plus user-configured ignore patterns with `*` wildcards.
 */
function buildExcludePredicate(ignoredPaths: string[]): (name: string, fullPath: string) => boolean {
  const ignoredPatterns = ignoredPaths.map(pattern => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\/]/g, '\\$&');
    const regexPattern = escaped.replace(/\*/g, '.*');
    return new RegExp(`^${regexPattern}$`, 'i');
  });

  return (name: string, fullPath: string): boolean => {
    if (name.startsWith('.')) return true;
    return ignoredPatterns.some(p => p.test(name) || p.test(fullPath));
  };
}

/**
 * Recursively scan a folder, producing nodes and parent->child links suitable
 * for a D3 force-directed graph. Stops at MAX_DEPTH and MAX_NODES.
 *
 * Sorting (folders before files, alphabetical) is applied at each level so
 * the truncation point, when reached, is deterministic.
 */
export async function scanFolderTree(
  folderPath: string,
  ignoredPaths: string[] = [],
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
      nodes.push({ id: childPath, name: entry.name, isDirectory, depth: depth + 1 });
      links.push({ source: dirPath, target: childPath });

      if (isDirectory) {
        queue.push({ dirPath: childPath, depth: depth + 1 });
      }
    }
  }

  return { folderPath, nodes, links, truncated };
}
