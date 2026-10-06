/**
 * Folder graph file-to-file links - reads the Markdown files of an already
 * scanned folder graph and returns an edge for every link from one of them to
 * another node in the graph.
 *
 * Deliberately separate from folderGraph.ts: the tree scan never reads file
 * contents, and this pass runs only when the user turns on the graph's
 * "Links" toggle, so the default graph costs nothing extra. The renderer
 * hands back the graph's node ids, so no directory walk is repeated here.
 */
import path from 'node:path';
import fs from 'node:fs';
import { isMarkdownFile } from '../shared/fileTypes';
import { mapWithConcurrency } from '../shared/asyncUtil';
import { decodeMarkdownUrl, extractLinkDestinations, splitHeadingFragment } from '../shared/markdownLinks';
import { logger } from '../shared/logUtil';
import type { FolderGraphLinkData } from './folderGraph';

/** Max number of Markdown files read concurrently. Mirrors SEARCH_FILE_CONCURRENCY in search.ts. */
const LINK_SCAN_CONCURRENCY = 32;

/**
 * Files larger than this (bytes) are skipped rather than read whole into the
 * main process. Notes are tiny; anything this big is not a note worth linking.
 */
const MAX_LINK_SCAN_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Returns the file-to-file edges among `nodeIds` (the folder graph's node ids,
 * all absolute paths): one per distinct (source, target) pair where `source` is
 * a Markdown file under `folderPath` linking to `target`, another graph node
 * (file or folder). Links to anything outside the graph, and self-links, are
 * dropped. Unreadable or oversized files simply contribute no edges.
 *
 * Link resolution mirrors a click in the app (relative to the linking file,
 * percent-decoded, `.md#heading` fragment ignored), with one extension: a
 * wikilink with no extension that doesn't resolve also tries `<target>.md`.
 */
export async function scanFolderGraphLinks(folderPath: string, nodeIds: string[]): Promise<FolderGraphLinkData[]> {
  const nodeSet = new Set(nodeIds);
  // The ids come from the renderer, so only read Markdown files that are
  // actually inside the graphed folder.
  const root = folderPath.endsWith(path.sep) ? folderPath : folderPath + path.sep;
  const sources = nodeIds.filter(id => id.startsWith(root) && isMarkdownFile(id));

  const perFile = await mapWithConcurrency(sources, LINK_SCAN_CONCURRENCY, async (source) => {
    const content = await readNote(source);
    return content === null ? [] : resolveTargets(source, content, nodeSet);
  });

  const seen = new Set<string>();
  const links: FolderGraphLinkData[] = [];
  sources.forEach((source, i) => {
    for (const target of perFile[i] ?? []) {
      const key = `${source}\0${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source, target });
    }
  });
  return links;
}

/** Reads a Markdown file, or returns null if it's unreadable or over the size cap. */
async function readNote(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_LINK_SCAN_FILE_BYTES) {
      logger.debug(`[folderGraphLinks] skipping oversized file: ${filePath}`);
      return null;
    }
    return await fs.promises.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** The graph nodes `source`'s links point at (may repeat; excludes `source` itself). */
function resolveTargets(source: string, content: string, nodeSet: Set<string>): string[] {
  const dir = path.dirname(source);
  const targets: string[] = [];
  for (const { dest, wiki } of extractLinkDestinations(content)) {
    const linkPath = wiki ? dest : decodeMarkdownUrl(splitHeadingFragment(dest).path);
    let target = path.resolve(dir, linkPath);
    if (!nodeSet.has(target) && wiki && path.extname(target) === '') target += '.md';
    if (target !== source && nodeSet.has(target)) targets.push(target);
  }
  return targets;
}
