import { useEffect, useCallback, useRef, useState } from 'react';
import { MinusIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ListBulletIcon, DocumentTextIcon, DocumentIcon, PhotoIcon } from '@heroicons/react/24/outline';
import { FolderIcon, FolderOpenIcon } from '@heroicons/react/24/solid';
import { getIconForFileExtension } from '../../utils/fileUtil';
import type { FileIconType } from '../../utils/fileUtil';
import BookmarksPopupMenu from '../menus/BookmarksPopupMenu';
import IndexTreeContextMenu from '../menus/IndexTreeContextMenu';
import {
  useRootPath,
  useCurrentPath,
  useIndexTreeRoot,
  useSettings,
  usePendingIndexTreeReveal,
  useHasCutItems,
  useHighlightItem,
  useEditingMarkdownPath,
  setIndexTreeRoot,
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
  getSettings,
  setPendingScrollToHeadingSlug,
} from '../../store';
import type { TreeNode, FileNode, MarkdownFileNode, MarkdownHeadingNode } from '../../store';
import { pasteCutItems } from '../../edit';
import {
  ENTRY_DND_MIME,
  parseDragPayload,
  canDropInto,
  moveEntryIntoFolder,
  makeEntryDragStartHandler,
  reloadExpandedTreeFolder,
  makeTreeNodes as makeNodes,
  findTreeNodeByPath as findNodeByPath,
} from '../../utils/dragAndDrop';
import { extractHeadingTree } from '../../utils/tocUtil';
import { scrollElementIntoView } from '../../utils/entryDom';
import { getActiveMarkdownEditor } from '../../utils/activeMarkdownEditor';

const INDENT_SIZE = 20;

function extractFrontMatterId(rawContent: string): string | null {
  if (!rawContent.startsWith('---')) return null;
  const afterOpen = rawContent.slice(3);
  const closingIdx = afterOpen.search(/\n(---|\.\.\.)\s*(\n|$)/);
  if (closingIdx === -1) return null;
  const yamlBlock = afterOpen.slice(0, closingIdx);
  const match = yamlBlock.match(/^id:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function computeRelativePath(fromDir: string, toFile: string): string {
  const fromParts = fromDir.split('/').filter(Boolean);
  const toParts = toFile.split('/').filter(Boolean);
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const ups = fromParts.length - i;
  const downs = toParts.slice(i);
  const rel = [...Array(ups).fill('..'), ...downs].join('/');
  return rel || './';
}

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

function renderFileIcon(iconType: FileIconType) {
  switch (iconType) {
    case 'markdown': return <DocumentTextIcon className="w-5 h-5 text-blue-400 shrink-0" />;
    case 'text':     return <DocumentTextIcon className="w-5 h-5 text-emerald-400 shrink-0" />;
    case 'image':    return <PhotoIcon className="w-5 h-5 text-green-500 shrink-0" />;
    default:         return <DocumentIcon className="w-5 h-5 text-slate-300 shrink-0" />;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAnyExpanded(nodes: TreeNode[]): boolean {
  return nodes.some(n => n.isExpanded);
}

function flattenVisible(
  nodes: TreeNode[],
  cutPaths: Set<string>,
  foldersOnTop: boolean,
  depth = 0
): Array<{ node: TreeNode; depth: number }> {
  // Heading nodes and Document Mode (indexed) nodes must preserve their existing order.
  const isHeadings = nodes.length > 0 && isMarkdownHeadingNode(nodes[0]);
  const hasIndexOrder = !isHeadings && nodes.some(n => isFileNode(n) && (n as FileNode).indexOrder !== undefined);
  const sorted = (isHeadings || hasIndexOrder) ? nodes : [...nodes].sort((a, b) => {
    const aIsDir = isFileNode(a) && a.isDirectory;
    const bIsDir = isFileNode(b) && b.isDirectory;
    if (foldersOnTop && aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    const aName = isFileNode(a) ? a.name : '';
    const bName = isFileNode(b) ? b.name : '';
    return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
  });
  const result: Array<{ node: TreeNode; depth: number }> = [];
  for (const node of sorted) {
    if (isFileNode(node) && cutPaths.has(node.path)) continue;
    result.push({ node, depth });
    if (node.isExpanded && node.children) {
      result.push(...flattenVisible(node.children, cutPaths, foldersOnTop, depth + 1));
    }
  }
  return result;
}

function isParentOf(candidatePath: string, currentPath: string): boolean {
  return currentPath.startsWith(candidatePath + '/');
}

// ── Component ────────────────────────────────────────────────────────────────

function IndexTreeView({ onRefreshDirectory }: { onRefreshDirectory?: () => void }) {
  const rootPath = useRootPath();
  const currentPath = useCurrentPath();
  const treeRoot = useIndexTreeRoot();
  const settings = useSettings();
  const pendingReveal = usePendingIndexTreeReveal();
  const hasCutItems = useHasCutItems();
  const highlightItem = useHighlightItem();
  const editingMarkdownPath = useEditingMarkdownPath();
  const containerRef = useRef<HTMLDivElement>(null);
  const bookmarksButtonRef = useRef<HTMLButtonElement>(null);
  const [showBookmarksMenu, setShowBookmarksMenu] = useState<boolean>(false);
  const [runningScript, setRunningScript] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    isDirectory: boolean;
    onBrowse: () => void;
    onPaste?: () => void;
    onPasteLink?: () => void;
  } | null>(null);
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
        try {
          const entries = await window.electronAPI.readDirectory(ancestorPath);
          expandIndexTreeNode(ancestorPath, makeNodes(entries));
        } catch {
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
      try {
        const content = await window.electronAPI.readFile(node.path);
        const headings = extractHeadingTree(node.path, content);
        expandIndexTreeNode(node.path, headings);
      } catch {
        // leave node collapsed on error
      }
      return;
    }

    if (!node.isDirectory) return;

    if (node.isExpanded) {
      collapseIndexTreeNode(node.path);
      return;
    }

    try {
      const entries = await window.electronAPI.readDirectory(node.path);
      expandIndexTreeNode(node.path, makeNodes(entries));
    } catch {
      // leave node collapsed on error
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

    // If the browse view is currently showing this folder, refresh it
    if (node.path === currentPath) {
      onRefreshDirectory?.();
    }

    // Refresh both the destination and source folders if they are expanded.
    await reloadExpandedTreeFolder(node.path);
    await reloadExpandedTreeFolder(sourceFolder);
  }, [currentPath, onRefreshDirectory]);

  const handleDropOnFolder = useCallback(async (node: FileNode, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);

    const payload = parseDragPayload(e.dataTransfer.getData(ENTRY_DND_MIME));
    if (!payload || !node.isDirectory) return;
    if (!canDropInto(payload, node.path)) return;

    const result = await moveEntryIntoFolder(payload, node.path);
    if (!result.success) return;

    // Drop the moved item from the store so the browse view stops showing it.
    deleteItems([payload.path]);

    // Refresh the browse view if it is showing either affected folder.
    if (node.path === currentPath || result.sourceFolder === currentPath) {
      onRefreshDirectory?.();
    }

    await reloadExpandedTreeFolder(node.path);
    await reloadExpandedTreeFolder(result.sourceFolder);
  }, [currentPath, onRefreshDirectory]);

  const handleDragOverFolder = useCallback((node: FileNode, e: React.DragEvent) => {
    if (!node.isDirectory) return;
    if (!e.dataTransfer.types.includes(ENTRY_DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverPath !== node.path) setDragOverPath(node.path);
  }, [dragOverPath]);

  const handleRunScript = useCallback((node: FileNode) => {
    if (runningScript) return;
    setRunningScript(node.path);
    window.electronAPI.runShellScript(node.path);
    setTimeout(() => setRunningScript(null), 3000);
  }, [runningScript]);

  const toggleBookmarksMenu = () => setShowBookmarksMenu(prev => !prev);
  const closeBookmarksMenu = () => setShowBookmarksMenu(false);
  const saveTreeWidth = async (width: typeof settings.indexTreeWidth) => {
    setIndexTreeWidth(width);
    const config = await window.electronAPI.getConfig();
    await window.electronAPI.saveConfig({ ...config, settings: getSettings() });
  };
  const handleNarrowTree = () => saveTreeWidth(settings.indexTreeWidth === 'wide' ? 'medium' : 'narrow');
  const handleWidenTree = () => saveTreeWidth(settings.indexTreeWidth === 'narrow' ? 'medium' : 'wide');

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
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      isDirectory: false,
      onBrowse: () => {
        const filePath = node.path.substring(0, node.path.lastIndexOf('#'));
        const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
        setHighlightItem(filePath);
        if (document.getElementById(node.slug)) {
          scrollElementIntoView(node.slug, true);
        } else {
          setPendingScrollToHeadingSlug(node.slug);
          navigateToBrowserPath(folderPath, filePath);
        }
      },
    });
  };

  const handleFileNodeContextMenu = (node: FileNode, e: React.MouseEvent) => {
    e.preventDefault();
    const activeEditor = editingMarkdownPath ? getActiveMarkdownEditor() : null;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      isDirectory: node.isDirectory,
      onBrowse: () => {
        if (node.isDirectory) {
          navigateToBrowserPath(node.path);
        } else {
          const folderPath = node.path.substring(0, node.path.lastIndexOf('/'));
          setHighlightItem(node.path);
          navigateToBrowserPath(folderPath, node.path);
        }
      },
      ...(hasCutItems && node.isDirectory ? {
        onPaste: () => void handlePasteIntoFolder(node, e),
      } : {}),
      ...(activeEditor && !node.isDirectory ? {
        onPasteLink: () => {
          const editorDir = activeEditor.path.substring(0, activeEditor.path.lastIndexOf('/'));
          const relPath = computeRelativePath(editorDir, node.path);
          const label = node.path.substring(node.path.lastIndexOf('/') + 1).replace(/\.md$/, '');
          if (node.path.endsWith('.md')) {
            window.electronAPI.readFile(node.path).then((raw) => {
              const id = extractFrontMatterId(raw);
              const suffix = id ? `<!-- id:${id} -->` : '';
              activeEditor.handle.insertAtCursor(`[${label}](${relPath})${suffix}`);
            });
          } else {
            activeEditor.handle.insertAtCursor(`[${label}](${relPath})`);
          }
        },
      } : {}),
    });
  };

  if (!treeRoot?.children) {
    return (
      <div className={`flex flex-col ${widthClass} shrink-0 border-r border-slate-700 bg-slate-800 items-center justify-center`}>
        <span className="text-slate-500">Loading…</span>
      </div>
    );
  }

  const cutPaths = new Set(getCutItems().map(item => item.path));
  const rows = flattenVisible(treeRoot.children, cutPaths, settings.foldersOnTop);
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
      {contextMenu && (
        <IndexTreeContextMenu
          mousePosition={{ x: contextMenu.x, y: contextMenu.y }}
          isDirectory={contextMenu.isDirectory}
          onClose={() => setContextMenu(null)}
          onBrowse={contextMenu.onBrowse}
          onPaste={contextMenu.onPaste}
          onPasteLink={contextMenu.onPasteLink}
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
                style={{ paddingLeft: `${8 + depth * INDENT_SIZE}px` }}
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
          const isDragOver = node.isDirectory && dragOverPath === node.path;
          const rowStyle: React.CSSProperties = {
            paddingLeft: `${8 + depth * INDENT_SIZE}px`,
            ...(isRunning ? { animation: 'scriptRunFlash 3s ease-in forwards' } : {}),
          };

          return (
            <div
              key={node.path}
              data-tree-path={node.path}
              className={`${className}${isDragOver ? ' bg-blue-600/40 outline outline-1 outline-blue-400' : ''}`}
              style={rowStyle}
              onClick={e => {
                if (isSh && e.ctrlKey) { handleRunScript(node); return; }
                if (isClickable) void handleNodeClick(node);
              }}
              onContextMenu={e => handleFileNodeContextMenu(node, e)}
              {...(node.isDirectory ? {
                onDragOver: (e: React.DragEvent) => handleDragOverFolder(node, e),
                onDragLeave: () => setDragOverPath(prev => (prev === node.path ? null : prev)),
                onDrop: (e: React.DragEvent) => void handleDropOnFolder(node, e),
              } : {})}
            >
              <span
                className="shrink-0 flex items-center mr-1 cursor-grab"
                draggable
                onDragStart={makeEntryDragStartHandler({ path: node.path, name: node.name, isDirectory: node.isDirectory })}
              >
                {node.isDirectory
                  ? (node.isExpanded
                      ? <FolderOpenIcon className="w-5 h-5 text-amber-500" />
                      : <FolderIcon className="w-5 h-5 text-amber-500" />)
                  : renderFileIcon(getIconForFileExtension(node.name))
                }
              </span>
              <span>{node.name}</span>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

export default IndexTreeView;
