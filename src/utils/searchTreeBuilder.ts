import { FolderGraphState, FolderGraphNode, FolderGraphLink, SearchResultItem } from '../store/types';

/**
 * Build a FolderGraphState (the same shape FolderGraphView consumes) from
 * a flat list of search results. Files become leaf nodes; their ancestor
 * directories up to a common root become directory nodes. No filesystem
 * access — operates purely on the path strings already in the results.
 */
export function buildFolderGraphFromSearchResults(
  results: SearchResultItem[]
): FolderGraphState {
  const sep = detectSeparator(results);

  const pathSegmentsList: string[][] = results.map(r => splitPath(r.path, sep));

  const rootSegments = longestCommonPrefix(pathSegmentsList);
  const rootId = rootSegments.length === 0 ? '' : joinPath(rootSegments, sep);

  const nodesById = new Map<string, FolderGraphNode>();
  const links: FolderGraphLink[] = [];

  nodesById.set(rootId, {
    id: rootId,
    name: rootSegments.length === 0 ? '/' : rootSegments[rootSegments.length - 1],
    isDirectory: true,
    depth: 0,
  });

  for (const segments of pathSegmentsList) {
    let parentId = rootId;
    for (let i = rootSegments.length; i < segments.length; i++) {
      const isLast = i === segments.length - 1;
      const currentSegments = segments.slice(0, i + 1);
      const currentId = joinPath(currentSegments, sep);
      if (!nodesById.has(currentId)) {
        nodesById.set(currentId, {
          id: currentId,
          name: segments[i],
          isDirectory: !isLast,
          depth: i - rootSegments.length + 1,
        });
        links.push({ source: parentId, target: currentId });
      }
      parentId = currentId;
    }
  }

  return {
    folderPath: rootId,
    nodes: [...nodesById.values()],
    links,
    truncated: false,
  };
}

function detectSeparator(results: SearchResultItem[]): string {
  for (const r of results) {
    if (r.path.includes('\\') && !r.path.includes('/')) return '\\';
  }
  return '/';
}

function splitPath(p: string, sep: string): string[] {
  const segments = p.split(sep);
  if (sep === '/' && p.startsWith('/')) {
    segments[0] = '/';
    return segments.filter((s, i) => i === 0 || s.length > 0);
  }
  return segments.filter(s => s.length > 0);
}

function joinPath(segments: string[], sep: string): string {
  if (segments.length === 0) return '';
  if (sep === '/' && segments[0] === '/') {
    return '/' + segments.slice(1).join('/');
  }
  return segments.join(sep);
}

function longestCommonPrefix(lists: string[][]): string[] {
  if (lists.length === 0) return [];
  // For files, the common ancestor must be a directory — so cap the prefix
  // at parentSegments.length - 1 of each path (exclude the file basename).
  let max = Math.min(...lists.map(l => Math.max(0, l.length - 1)));
  const prefix: string[] = [];
  for (let i = 0; i < max; i++) {
    const seg = lists[0][i];
    if (lists.every(l => l[i] === seg)) {
      prefix.push(seg);
    } else {
      break;
    }
  }
  return prefix;
}
