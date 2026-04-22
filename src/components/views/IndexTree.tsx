import { useEffect, useCallback, useRef } from 'react';
import { ClipboardDocumentIcon, MinusSmallIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon } from '@heroicons/react/24/outline';
import {
  useRootPath,
  useCurrentPath,
  useIndexTreeRoot,
  useSettings,
  usePendingIndexTreeReveal,
  useHasCutItems,
  useHighlightItem,
  setIndexTreeRoot,
  setIndexTreeNodeLoading,
  expandIndexTreeNode,
  collapseIndexTreeNode,
  collapseAllIndexTreeNodes,
  clearPendingIndexTreeReveal,
  getIndexTreeRoot,
  getCutItems,
  deleteItems,
  clearAllCutItems,
  navigateToBrowserPath,
  setHighlightItem,
  setIndexTreeWidth,
} from '../../store';
import type { TreeNode } from '../../store';
import { pasteCutItems } from '../../edit';

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

function isParentOf(candidatePath: string, currentPath: string): boolean {
  return currentPath.startsWith(candidatePath + '/');
}

function findNodeByPath(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path) return root;
  if (!root.children) return null;
  for (const child of root.children) {
    const found = findNodeByPath(child, path);
    if (found) return found;
  }
  return null;
}

function IndexTree() {
  const rootPath = useRootPath();
  const currentPath = useCurrentPath();
  const treeRoot = useIndexTreeRoot();
  const settings = useSettings();
  const pendingReveal = usePendingIndexTreeReveal();
  const hasCutItems = useHasCutItems();
  const highlightItem = useHighlightItem();
  const containerRef = useRef<HTMLDivElement>(null);
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

  const expandToPath = useCallback(async (targetPath: string) => {
    if (!rootPath || !targetPath.startsWith(rootPath)) return;

    const relative = targetPath.slice(rootPath.length).replace(/^\//, '');
    const segments = relative ? relative.split('/') : [];

    // Expand each ancestor directory from root down to targetPath
    let ancestorPath = rootPath;
    for (const segment of segments) {
      const root = getIndexTreeRoot();
      if (!root) return;

      const node = findNodeByPath(root, ancestorPath);
      if (!node || !node.isDirectory) return;

      if (!node.isExpanded || node.children === null) {
        setIndexTreeNodeLoading(ancestorPath, true);
        try {
          const entries = await window.electronAPI.readDirectory(ancestorPath);
          expandIndexTreeNode(ancestorPath, makeNodes(entries));
        } catch {
          setIndexTreeNodeLoading(ancestorPath, false);
          return;
        }
      }

      ancestorPath = ancestorPath + '/' + segment;
    }

    // Scroll to the target node after React has rendered the expanded tree
    setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const el = container.querySelector(`[data-tree-path="${CSS.escape(targetPath)}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
      }
    }, 750);
  }, [rootPath]);

  useEffect(() => {
    if (!pendingReveal) return;
    clearPendingIndexTreeReveal();
    void expandToPath(pendingReveal);
  }, [pendingReveal, expandToPath]);

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

  const handlePasteIntoFolder = useCallback(async (node: TreeNode, e: React.MouseEvent) => {
    e.stopPropagation();
    const cutItems = getCutItems();
    if (cutItems.length === 0) return;

    const result = await pasteCutItems(
      cutItems,
      node.path,
      window.electronAPI.pathExists,
      window.electronAPI.renameFile
    );

    if (!result.success) return;

    const movedPaths = cutItems.map(item => item.path);
    deleteItems(movedPaths);
    clearAllCutItems();

    // Refresh children only if the folder is already expanded
    if (node.isExpanded) {
      try {
        const entries = await window.electronAPI.readDirectory(node.path);
        expandIndexTreeNode(node.path, makeNodes(entries));
      } catch {
        // leave tree as-is
      }
    }
  }, []);

  if (!treeRoot?.children) {
    return (
      <div className={`flex flex-col ${widthClass} shrink-0 border-r border-slate-700 bg-slate-800 items-center justify-center`}>
        <span className="text-slate-500">Loading…</span>
      </div>
    );
  }

  const rows = flattenVisible(treeRoot.children);

  return (
    <div className={`flex flex-col ${widthClass} shrink-0 border-r border-slate-700 bg-slate-800`}>
      <div className="flex items-center justify-end gap-1 px-2 py-1 border-b border-slate-700 shrink-0">
        <button
          type="button"
          onClick={collapseAllIndexTreeNodes}
          className="p-0.5 text-slate-200 hover:text-white hover:bg-slate-700 rounded"
          title="Collapse All"
        >
          <span className="flex items-center justify-center w-5 h-5 border border-current rounded-sm">
            <MinusSmallIcon className="w-3.5 h-3.5" />
          </span>
        </button>
        {settings.indexTreeWidth !== 'narrow' && (
          <button
            type="button"
            onClick={() => setIndexTreeWidth(settings.indexTreeWidth === 'wide' ? 'medium' : 'narrow')}
            className="p-0.5 text-slate-200 hover:text-white hover:bg-slate-700 rounded"
            title="Narrow tree"
          >
            <ChevronDoubleLeftIcon className="w-5 h-5" />
          </button>
        )}
        {settings.indexTreeWidth !== 'wide' && (
          <button
            type="button"
            onClick={() => setIndexTreeWidth(settings.indexTreeWidth === 'narrow' ? 'medium' : 'wide')}
            className="p-0.5 text-slate-200 hover:text-white hover:bg-slate-700 rounded"
            title="Widen tree"
          >
            <ChevronDoubleRightIcon className="w-5 h-5" />
          </button>
        )}
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto pl-2 pt-2">
      <div className="py-1">
        {rows.map(({ node, depth }) => (
          <div
            key={node.path}
            data-tree-path={node.path}
            className={`flex items-center gap-1 py-0.5 whitespace-nowrap select-none
              ${node.path === highlightItem
                ? 'text-purple-400 border-l-2 border-transparent ' + (node.isDirectory ? 'cursor-pointer' : 'cursor-default')
                : node.isDirectory && node.path === currentPath
                  ? 'text-slate-100 bg-blue-700/50 border-l-2 border-blue-500 cursor-pointer'
                  : node.isDirectory && isParentOf(node.path, currentPath)
                    ? 'text-slate-200 bg-slate-600/50 border-l-2 border-transparent cursor-pointer'
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
            <span
              className={
                `shrink-0 w-3 text-center mr-1 ` +
                (node.path === highlightItem ? 'text-purple-400' : node.isDirectory && node.isExpanded ? 'text-purple-400' : node.isDirectory ? 'text-yellow-400' : 'text-slate-400')
              }
            >
              {node.isDirectory
                ? (node.isLoading ? '⋯' : node.isExpanded ? '▼' : '▶')
                : '●'
              }
            </span>
            <span className="truncate flex-1 min-w-0">{node.name}</span>
            {hasCutItems && node.isDirectory && (
              <button
                type="button"
                onClick={e => void handlePasteIntoFolder(node, e)}
                className="shrink-0 p-0.5 mr-1 text-slate-500 hover:text-slate-100 hover:bg-slate-600 rounded"
                title="Paste cut items here"
              >
                <ClipboardDocumentIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

export default IndexTree;
