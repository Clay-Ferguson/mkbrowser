import { useEffect, useCallback } from 'react';
import {
  useRootPath,
  useCurrentPath,
  useIndexTreeRoot,
  useSettings,
  setIndexTreeRoot,
  setIndexTreeNodeLoading,
  expandIndexTreeNode,
  collapseIndexTreeNode,
  navigateToBrowserPath,
  setHighlightItem,
} from '../../store';
import type { TreeNode } from '../../store';

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function makeNodes(
  entries: Array<{ path: string; name: string; isDirectory: boolean }>
): TreeNode[] {
  return sortNodes(
    entries.map(e => ({
      path: e.path,
      name: e.name,
      isDirectory: e.isDirectory,
      isExpanded: false,
      isLoading: false,
      children: null,
    }))
  );
}

function flattenVisible(
  nodes: TreeNode[],
  depth = 0
): Array<{ node: TreeNode; depth: number }> {
  const result: Array<{ node: TreeNode; depth: number }> = [];
  for (const node of nodes) {
    result.push({ node, depth });
    if (node.isDirectory && node.isExpanded && node.children) {
      result.push(...flattenVisible(node.children, depth + 1));
    }
  }
  return result;
}

function IndexTree() {
  const rootPath = useRootPath();
  const currentPath = useCurrentPath();
  const treeRoot = useIndexTreeRoot();
  const settings = useSettings();
  const widthClass = settings.indexTreeWidth === 'wide' ? 'w-1/2' : settings.indexTreeWidth === 'medium' ? 'w-1/3' : 'w-1/4';

  useEffect(() => {
    if (!rootPath) return;
    if (treeRoot?.path === rootPath) return;

    const load = async () => {
      try {
        const entries = await window.electronAPI.readDirectory(rootPath);
        setIndexTreeRoot({
          path: rootPath,
          name: rootPath,
          isDirectory: true,
          isExpanded: true,
          isLoading: false,
          children: makeNodes(entries),
        });
      } catch {
        // leave tree null; a retry will happen on next rootPath change
      }
    };
    void load();
  }, [rootPath, treeRoot?.path]);

  const handleNodeClick = useCallback(async (node: TreeNode) => {
    if (!node.isDirectory) return;

    if (node.isExpanded) {
      collapseIndexTreeNode(node.path);
      return;
    }

    setIndexTreeNodeLoading(node.path, true);
    try {
      const entries = await window.electronAPI.readDirectory(node.path);
      expandIndexTreeNode(node.path, makeNodes(entries));
    } catch {
      setIndexTreeNodeLoading(node.path, false);
    }
  }, []);

  if (!treeRoot?.children) {
    return (
      <div className={`flex flex-col ${widthClass} shrink-0 border-r border-slate-700 bg-slate-800 items-center justify-center`}>
        <span className="text-sm text-slate-500">Loading…</span>
      </div>
    );
  }

  const rows = flattenVisible(treeRoot.children);

  return (
    <div className={`flex flex-col ${widthClass} shrink-0 border-r border-slate-700 bg-slate-800 overflow-y-auto`}>
      <div className="px-2 py-1 text-sm font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-700 shrink-0">
        Index
      </div>
      <div className="py-1">
        {rows.map(({ node, depth }) => (
          <div
            key={node.path}
            className={`flex items-center gap-1 py-0.5 text-sm whitespace-nowrap select-none
              ${node.isDirectory && node.path === currentPath
                ? 'text-slate-100 bg-blue-700/50 border-l-2 border-blue-500 cursor-pointer'
                : node.isDirectory
                  ? 'text-slate-200 hover:bg-slate-700 border-l-2 border-transparent cursor-pointer'
                  : 'text-slate-400 border-l-2 border-transparent cursor-default'
              }`}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            onClick={() => { if (node.isDirectory) void handleNodeClick(node); }}
            onContextMenu={e => {
              e.preventDefault();
              if (node.isDirectory) {
                navigateToBrowserPath(node.path);
              } else {
                const folderPath = node.path.substring(0, node.path.lastIndexOf('/'));
                setHighlightItem(node.path);
                navigateToBrowserPath(folderPath, node.path);
              }
            }}
          >
            <span className="shrink-0 w-3 text-center text-slate-400">
              {node.isDirectory
                ? (node.isLoading ? '⋯' : node.isExpanded ? '▾' : '▸')
                : '·'
              }
            </span>
            <span className="truncate">{node.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default IndexTree;
