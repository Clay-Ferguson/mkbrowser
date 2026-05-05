import { useEffect, useCallback, useRef, useState } from 'react';
import { MinusIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ListBulletIcon } from '@heroicons/react/24/outline';
import { ClipboardDocumentIcon } from '@heroicons/react/24/solid';
import BookmarksPopupMenu from '../menus/BookmarksPopupMenu';
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
  setPendingScrollToHeadingSlug,
} from '../../store';
import type { TreeNode, FileNode, MarkdownFileNode, MarkdownHeadingNode } from '../../store';
import { pasteCutItems } from '../../edit';
import { extractHeadingTree } from '../../utils/tocUtils';
import { scrollElementIntoView } from '../../utils/entryDom';

// ── Type guards ──────────────────────────────────────────────────────────────

function isFileNode(node: TreeNode): node is FileNode {
  return 'isDirectory' in node;
}

function isMarkdownHeadingNode(node: TreeNode): node is MarkdownHeadingNode {
  return 'heading' in node;
}

function isMarkdownFile(node: FileNode): node is MarkdownFileNode {
  return !node.isDirectory && node.name.toLowerCase().endsWith('.md');
}

function isShellScript(node: FileNode): boolean {
  return !node.isDirectory && node.name.toLowerCase().endsWith('.sh');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function makeNodes(
  entries: Array<{ path: string; name: string; isDirectory: boolean }>
): FileNode[] {
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

function isAnyExpanded(nodes: TreeNode[]): boolean {
  return nodes.some(n => n.isExpanded);
}

function flattenVisible(
  nodes: TreeNode[],
  depth = 0
): Array<{ node: TreeNode; depth: number }> {
  const result: Array<{ node: TreeNode; depth: number }> = [];
  for (const node of nodes) {
    result.push({ node, depth });
    if (node.isExpanded && node.children) {
      result.push(...flattenVisible(node.children, depth + 1));
    }
  }
  return result;
}

function isParentOf(candidatePath: string, currentPath: string): boolean {
  return currentPath.startsWith(candidatePath + '/');
}

function findNodeByPath(root: FileNode, path: string): FileNode | null {
  if (root.path === path) return root;
  if (!root.children) return null;
  for (const child of root.children) {
    if (!isFileNode(child)) continue;
    const found = findNodeByPath(child, path);
    if (found) return found;
  }
  return null;
}

// ── Component ────────────────────────────────────────────────────────────────

function IndexTree() {
  const rootPath = useRootPath();
  const currentPath = useCurrentPath();
  const treeRoot = useIndexTreeRoot();
  const settings = useSettings();
  const pendingReveal = usePendingIndexTreeReveal();
  const hasCutItems = useHasCutItems();
  const highlightItem = useHighlightItem();
  const containerRef = useRef<HTMLDivElement>(null);
  const bookmarksButtonRef = useRef<HTMLButtonElement>(null);
  const [showBookmarksMenu, setShowBookmarksMenu] = useState<boolean>(false);
  const [runningScript, setRunningScript] = useState<string | null>(null);
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
    if (isMarkdownHeadingNode(node)) {
      // Toggle heading expansion
      if (node.isExpanded) {
        collapseIndexTreeNode(node.path);
      } else if (node.children && node.children.length > 0) {
        expandIndexTreeNode(node.path, node.children);
      }
      return;
    }

    if (!isFileNode(node)) return;

    if (isMarkdownFile(node)) {
      // Toggle markdown file expansion — load headings on first expand
      if (node.isExpanded) {
        collapseIndexTreeNode(node.path);
        return;
      }
      if (node.children !== null) {
        // Already loaded — just re-expand
        expandIndexTreeNode(node.path, node.children);
        return;
      }
      setIndexTreeNodeLoading(node.path, true);
      try {
        const content = await window.electronAPI.readFile(node.path);
        const headings = extractHeadingTree(node.path, content);
        expandIndexTreeNode(node.path, headings);
      } catch {
        setIndexTreeNodeLoading(node.path, false);
      }
      return;
    }

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

  const handlePasteIntoFolder = useCallback(async (node: FileNode, e: React.MouseEvent) => {
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

    const sourceFolder = cutItems[0].path.substring(0, cutItems[0].path.lastIndexOf('/'));
    const movedPaths = cutItems.map(item => item.path);
    deleteItems(movedPaths);
    clearAllCutItems();
    await Promise.all([
      window.electronAPI.reconcileIndexedFiles(sourceFolder, false),
      window.electronAPI.reconcileIndexedFiles(node.path, false),
    ]);

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

  const handleRunScript = useCallback((node: FileNode) => {
    if (runningScript) return;
    setRunningScript(node.path);
    window.electronAPI.runShellScript(node.path);
    setTimeout(() => setRunningScript(null), 3000);
  }, [runningScript]);

  const toggleBookmarksMenu = () => setShowBookmarksMenu(prev => !prev);
  const closeBookmarksMenu = () => setShowBookmarksMenu(false);
  const handleNarrowTree = () => setIndexTreeWidth(settings.indexTreeWidth === 'wide' ? 'medium' : 'narrow');
  const handleWidenTree = () => setIndexTreeWidth(settings.indexTreeWidth === 'narrow' ? 'medium' : 'wide');

  const handleBookmarkNavigate = (fullPath: string) => {
    const lastName = fullPath.substring(fullPath.lastIndexOf('/') + 1);
    if (lastName.includes('.')) {
      const folderPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
      setHighlightItem(fullPath);
      navigateToBrowserPath(folderPath, fullPath);
    } else {
      navigateToBrowserPath(fullPath);
    }
  };

  const handleHeadingClick = (node: MarkdownHeadingNode) => {
    const hasChildren = node.children && node.children.length > 0;
    if (hasChildren) void handleNodeClick(node);
  };

  const handleHeadingContextMenu = (node: MarkdownHeadingNode, e: React.MouseEvent) => {
    e.preventDefault();
    const filePath = node.path.substring(0, node.path.lastIndexOf('#'));
    const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
    setHighlightItem(filePath);
    if (document.getElementById(node.slug)) {
      scrollElementIntoView(node.slug, true);
    } else {
      setPendingScrollToHeadingSlug(node.slug);
      navigateToBrowserPath(folderPath, filePath);
    }
  };

  const handleFileNodeContextMenu = (node: FileNode, e: React.MouseEvent) => {
    e.preventDefault();
    if (node.isDirectory) {
      navigateToBrowserPath(node.path);
    } else {
      const folderPath = node.path.substring(0, node.path.lastIndexOf('/'));
      setHighlightItem(node.path);
      navigateToBrowserPath(folderPath, node.path);
    }
  };

  if (!treeRoot?.children) {
    return (
      <div className={`flex flex-col ${widthClass} shrink-0 border-r border-slate-700 bg-slate-800 items-center justify-center`}>
        <span className="text-slate-500">Loading…</span>
      </div>
    );
  }

  const rows = flattenVisible(treeRoot.children);
  return (
    <div data-testid="file-explorer-tree" className={`flex flex-col ${widthClass} shrink-0 border-r border-slate-700 bg-slate-800`}>
      <style>{`@keyframes scriptRunFlash { 0% { background-color: rgba(74,222,128,0.45); } 100% { background-color: transparent; } }`}</style>
      <div className="flex items-center justify-between gap-1 px-2 py-1 border-b border-slate-700 shrink-0">
        <button
          ref={bookmarksButtonRef}
          type="button"
          onClick={toggleBookmarksMenu}
          className="ml-1 p-0.5 text-slate-200 hover:text-white hover:bg-slate-700 rounded"
          title="Bookmarks menu"
          data-testid="bookmarks-menu-button"
        >
          <ListBulletIcon className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={collapseAllIndexTreeNodes}
          disabled={!isAnyExpanded(treeRoot.children)}
          className="p-0.5 text-slate-200 hover:text-white hover:bg-slate-700 rounded disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          title="Collapse All"
          data-testid="file-explorer-tree-collapse"
        >
          <span className="flex items-center justify-center w-5 h-5 border border-current rounded-sm">
            <MinusIcon className="w-3.5 h-3.5" />
          </span>
        </button>
        {settings.indexTreeWidth !== 'narrow' && (
          <button
            type="button"
            onClick={handleNarrowTree}
            className="p-0.5 text-slate-200 hover:text-white hover:bg-slate-700 rounded"
            title="Narrow tree"
          >
            <ChevronDoubleLeftIcon className="w-5 h-5" />
          </button>
        )}
        {settings.indexTreeWidth !== 'wide' && (
          <button
            type="button"
            onClick={handleWidenTree}
            className="p-0.5 text-slate-200 hover:text-white hover:bg-slate-700 rounded"
            title="Widen tree"
          >
            <ChevronDoubleRightIcon className="w-5 h-5" />
          </button>
        )}
        </div>
      </div>
      {showBookmarksMenu && (
        <BookmarksPopupMenu
          anchorRef={bookmarksButtonRef}
          onClose={closeBookmarksMenu}
          bookmarks={settings.bookmarks || []}
          rootPath={rootPath ?? ''}
          onNavigate={handleBookmarkNavigate}
        />
      )}
      <div ref={containerRef} className="flex-1 overflow-auto pl-2 pr-2 pt-2">
      <div className="py-1 min-w-max">
        {rows.map(({ node, depth }) => {
          if (isMarkdownHeadingNode(node)) {
            const hasChildren = node.children && node.children.length > 0;
            return (
              <div
                key={node.path}
                data-tree-path={node.path}
                className={`flex items-center gap-1 py-0.5 whitespace-nowrap select-none
                  text-slate-400 border-l-2 border-transparent
                  ${hasChildren ? 'cursor-pointer hover:bg-slate-700' : 'cursor-default hover:bg-slate-700'}
                `}
                style={{ paddingLeft: `${8 + depth * 12}px` }}
                onClick={() => handleHeadingClick(node)}
                onContextMenu={e => handleHeadingContextMenu(node, e)}
              >
                <span className="shrink-0 w-3 text-center mr-1 text-slate-500">
                  {hasChildren
                    ? (node.isExpanded ? '▼' : '▶')
                    : '·'
                  }
                </span>
                <span className="text-slate-300 italic">{node.heading}</span>
              </div>
            );
          }

          if (!isFileNode(node)) return null;

          const isMd = isMarkdownFile(node);
          const isSh = isShellScript(node);
          const isClickable = node.isDirectory || isMd;

          let className = 'flex items-center gap-1 py-0.5 whitespace-nowrap select-none';
          if (node.path === highlightItem) {
            className += ' text-purple-400 border-l-2 border-transparent';
            className += isClickable ? ' cursor-pointer' : ' cursor-default';
          } //
          else if (node.isDirectory && node.path === currentPath) {
            className += ' text-slate-100 bg-purple-700/50 border-l-2 border-purple-500 cursor-pointer';
          } //
          else if (node.isDirectory && isParentOf(node.path, currentPath)) {
            className += ' text-slate-200 bg-purple-700/50 border-l-2 border-purple-500 cursor-pointer';
          } //
          else if (node.isDirectory) {
            className += node.isExpanded
              ? ' text-slate-200 bg-slate-700 hover:bg-slate-700 border-l-2 border-transparent cursor-pointer'
              : ' text-slate-200 hover:bg-slate-700 border-l-2 border-transparent cursor-pointer';
          } //
          else if (isMd) {
            className += ' text-slate-400 border-l-2 border-transparent cursor-pointer hover:bg-slate-700';
          } //
          else if (isSh) {
            className += ' text-green-400 border-l-2 border-transparent cursor-pointer hover:bg-slate-300/20';
          } //
          else {
            className += ' text-slate-400 border-l-2 border-transparent cursor-default';
          }

          const isRunning = runningScript === node.path;
          const rowStyle: React.CSSProperties = {
            paddingLeft: `${8 + depth * 12}px`,
            ...(isRunning ? { animation: 'scriptRunFlash 3s ease-in forwards' } : {}),
          };

          return (
            <div
              key={node.path}
              data-tree-path={node.path}
              className={className}
              style={rowStyle}
              onClick={e => {
                if (isSh && e.ctrlKey) { handleRunScript(node); return; }
                if (isClickable) void handleNodeClick(node);
              }}
              onContextMenu={e => handleFileNodeContextMenu(node, e)}
            >
              <span
                className={
                  `shrink-0 w-3 text-center mr-1 ` +
                  (node.path === highlightItem ? 'text-purple-400' : node.isDirectory ? 'text-yellow-400' : isMd ? 'text-sky-400' : 'text-slate-400')
                }
              >
                {node.isDirectory
                  ? (node.isLoading ? '⋯' : node.isExpanded ? '▼' : '▶')
                  : isMd
                    ? (node.isLoading ? '⋯' : node.isExpanded ? '▼' : '▶')
                    : '●'
                }
              </span>
              <span>{node.name}</span>
              {hasCutItems && node.isDirectory && (
                <button
                  type="button"
                  onClick={e => void handlePasteIntoFolder(node, e)}
                  className="shrink-0 ml-auto p-1 mr-1 bg-blue-600 hover:bg-blue-700 rounded transition-colors cursor-pointer"
                  title="Paste cut items here"
                  aria-label="Paste cut items here"
                >
                  <ClipboardDocumentIcon className="w-4 h-4 text-white" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

export default IndexTree;
