import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { MinusIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ListBulletIcon, DocumentTextIcon, DocumentIcon, PhotoIcon } from '@heroicons/react/24/outline';
import { FolderIcon, FolderOpenIcon } from '@heroicons/react/24/solid';
import { api } from '../../renderer/api';
import { logger } from '../../shared/logUtil';
import { getIconForFileExtension, isImageFile } from '../../shared/fileTypes';
import type { FileIconType } from '../../shared/fileTypes';
import BookmarksPopupMenu from '../menus/BookmarksPopupMenu';
import IndexTreeContextMenu from '../menus/IndexTreeContextMenu';
import CreateFolderDialog from '../dialogs/CreateFolderDialog';
import RenameDialog from '../dialogs/RenameDialog';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import {
  useAS,
  hasAnyCutItems,
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
import { pasteCutItems } from '../../renderer/edit';
import {
  ENTRY_DND_MIME,
  parseDragPayload,
  canDropInto,
  moveEntryIntoFolder,
  makeEntryDragStartHandler,
  reloadExpandedTreeFolder,
  makeTreeNodes as makeNodes,
  findTreeNodeByPath as findNodeByPath,
} from '../../renderer/dragAndDrop';
import { extractHeadingTree } from '../../shared/tocUtil';
import { scrollElementIntoView } from '../../renderer/entryDom';
import { getActiveMarkdownEditor } from '../../renderer/activeMarkdownEditor';
import { ensureTrailingSep, getFileName, getParentPath, isPathInside, joinPath, splitPathSegments } from '../../renderer/pathUtil';
import { parseFrontMatter } from '../../shared/frontMatterUtil';

const INDENT_SIZE = 20;

/**
 * Computes the relative path from `fromDir` to `toFile` using `..` segments,
 * matching the format expected in Markdown link hrefs (e.g. `../sibling/file.md`).
 */
function computeRelativePath(fromDir: string, toFile: string): string {
  const fromParts = splitPathSegments(fromDir);
  const toParts = splitPathSegments(toFile);
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const ups = fromParts.length - i;
  const downs = toParts.slice(i);
  const rel = [...Array<string>(ups).fill('..'), ...downs].join('/');
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

/**
 * Flattens the visible portion of the tree into a flat array of `{node, depth}`
 * pairs for virtual list rendering. Collapsed nodes are included but their
 * children are omitted; cut nodes are skipped entirely. Heading sub-trees and
 * index-ordered (document mode) nodes preserve their existing order; all other
 * nodes are sorted alphabetically with optional folders-on-top.
 */
function flattenVisible(
  nodes: TreeNode[],
  cutPaths: Set<string>,
  foldersOnTop: boolean,
  depth = 0
): Array<{ node: TreeNode; depth: number }> {
  // Heading nodes and Document Mode (indexed) nodes must preserve their existing order.
  const isHeadings = nodes.length > 0 && isMarkdownHeadingNode(nodes[0]!); 
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
  return currentPath.startsWith(ensureTrailingSep(candidatePath));
}

/**
 * Fire-and-forget runner for async context-menu / paste / drag-drop actions:
 * invokes `op` and logs a failure instead of leaking an unhandled rejection.
 * Module-level so the component's handlers don't need try/catch bodies — the
 * React Compiler bails out on value blocks (`?.`, `||`, ternaries) inside a
 * try/catch statement.
 */
function runAndLogFailure(message: string, op: () => Promise<void>): void {
  op().catch((err: unknown) => logger.error(message, err));
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Collapsible file-explorer sidebar showing the full folder tree rooted at the
 * app's root path. Supports expand/collapse (lazy-loading children on first
 * expand), drag-and-drop reordering between folders, cut/paste, rename, delete,
 * bookmarks, and a right-click context menu. Markdown files expand to reveal
 * their heading tree. Clicking a heading or file navigates the browse view to
 * that item; Ctrl+clicking a shell script runs it. The "Paste Link" context-menu
 * action inserts a relative Markdown link at the active editor's cursor.
 */
function IndexTreeView({ onRefreshDirectory }: { onRefreshDirectory?: () => void }) {
  const rootPath = useAS(s => s.rootPath);
  const currentPath = useAS(s => s.currentPath);
  const treeRoot = useAS(s => s.indexTreeRoot);
  const settings = useAS(s => s.settings);
  const pendingReveal = useAS(s => s.pendingIndexTreeReveal);
  const hasCutItems = useAS(s => hasAnyCutItems(s.items));
  const highlightItem = useAS(s => s.highlightItem);
  // Derived: the path of the markdown file currently in edit mode, if any.
  // Returns a primitive, so no useShallow is needed.
  const editingMarkdownPath = useAS(s => {
    for (const [path, item] of s.items) {
      if (item.editing && path.endsWith('.md')) return path;
    }
    return null;
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const bookmarksButtonRef = useRef<HTMLButtonElement>(null);
  const [showBookmarksMenu, setShowBookmarksMenu] = useState<boolean>(false);
  const [runningScript, setRunningScript] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    isDirectory: boolean;
    onBrowse: () => void;
    onNewFolder?: () => void;
    onRename?: () => void;
    onDelete?: () => void;
    onPaste?: () => void;
    onPasteLink?: () => void;
    onCopyPath?: () => void;
    onCopyRelativePath?: () => void;
  } | null>(null);
  const [createFolderParent, setCreateFolderParent] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ path: string; name: string; isDirectory: boolean } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string; isDirectory: boolean } | null>(null);
  const widthClass = settings.indexTreeWidth === 'wide' ? 'w-1/2' : settings.indexTreeWidth === 'medium' ? 'w-1/3' : 'w-1/4';

  useEffect(() => {
    if (!rootPath) return;
    if (treeRoot?.path === rootPath) return;

    let ignore = false;
    const load = async () => {
      try {
        const entries = await api.readDirectory(rootPath);
        if (ignore) return;
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
    return () => { ignore = true; };
  }, [rootPath, treeRoot?.path]);

  /**
   * Expands every ancestor folder from the root down to the pending-reveal
   * path, loading directory contents on demand for any node that hasn't been
   * opened yet, then scrolls the target node into the center of the tree panel.
   * `expandToPath` lives inside the effect (its only caller) so it doesn't need
   * memoization to be a valid dependency.
   */
  useEffect(() => {
    if (!pendingReveal) return;
    clearPendingIndexTreeReveal();

    const expandToPath = async (targetPath: string) => {
      if (!rootPath || !isPathInside(rootPath, targetPath)) return;

      const relative = targetPath.slice(rootPath.length).replace(/^[/\\]/, '');
      const segments = splitPathSegments(relative);

      // Expand each ancestor directory from root down to targetPath
      let ancestorPath = rootPath;
      for (const segment of segments) {
        const root = getIndexTreeRoot();
        if (!root) return;

        const node = findNodeByPath(root, ancestorPath);
        if (!node || !node.isDirectory) return;

        if (!node.isExpanded || node.children === null) {
          try {
            const entries = await api.readDirectory(ancestorPath);
            expandIndexTreeNode(ancestorPath, makeNodes(entries));
          } catch {
            return;
          }
        }

        ancestorPath = joinPath(ancestorPath, segment);
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
    };

    void expandToPath(pendingReveal);
  }, [pendingReveal, rootPath]);

  /**
   * Handles a click on any tree row. Behavior depends on node type:
   * - Heading node: toggles expansion of the heading's child headings.
   * - Markdown file: toggles expansion; loads heading children from disk on
   *   first expand.
   * - Directory: toggles expansion; reads directory contents on first expand.
   * - Other file types: no-op (non-expandable).
   */
  const handleNodeClick = async (node: TreeNode) => {
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
        const content = await api.readFile(node.path);
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
      const entries = await api.readDirectory(node.path);
      expandIndexTreeNode(node.path, makeNodes(entries));
    } catch {
      // leave node collapsed on error
    }
  };

  /**
   * Moves all cut items into `node`'s folder via rename. Applied partially on
   * disk failure — only the files that actually moved are removed from the store
   * and reconciled with .INDEX.yaml, so the UI never desyncs from disk. The cut
   * flag is cleared only when every item moved successfully.
   */
  // Fire-and-forget UI handler: sync signature so the click's synchronous work
  // runs before the event is recycled, with the async body run through
  // runAndLogFailure so failures are reported instead of leaking an unhandled
  // rejection.
  const handlePasteIntoFolder = (node: FileNode, e: React.MouseEvent) => {
    e.stopPropagation();
    const cutItems = getCutItems();
    if (cutItems.length === 0) return;

    runAndLogFailure('Failed to paste items into folder:', async () => {
      const result = await pasteCutItems(
        cutItems,
        node.path,
        api.pathExists,
        api.renameFile
      );

      // The move is not atomic: reconcile the store/index with whatever
      // actually moved on disk (movedPaths), even on partial failure, so the
      // UI never desyncs. Items that failed to move stay cut at their source.
      const sourceFolder = getParentPath(cutItems[0]!.path); 
      if (result.movedPaths.length > 0) {
        deleteItems(result.movedPaths);
        await Promise.all([
          api.reconcileIndexedFiles(sourceFolder, false),
          api.reconcileIndexedFiles(node.path, false),
        ]);

        // If the browse view is currently showing this folder, refresh it
        if (node.path === currentPath) {
          onRefreshDirectory?.();
        }

        // Refresh both the destination and source folders if they are expanded.
        await reloadExpandedTreeFolder(node.path);
        await reloadExpandedTreeFolder(sourceFolder);
      }

      if (result.success) {
        clearAllCutItems();
      }
    });
  };

  const handleCreateFolder = (folderName: string) => {
    const parentPath = createFolderParent;
    if (!parentPath) return;

    runAndLogFailure('Failed to create folder:', async () => {
      const folderPath = joinPath(parentPath, folderName);
      const result = await api.createFolder(folderPath);
      setCreateFolderParent(null);
      if (!result.success) return;

      await api.reconcileIndexedFiles(parentPath, false);

      // If the browse view is currently showing this folder, refresh it.
      if (parentPath === currentPath) {
        onRefreshDirectory?.();
      }

      // Refresh the parent folder in the tree if it is expanded.
      await reloadExpandedTreeFolder(parentPath);
    });
  };

  const handleRename = (newName: string) => {
    const target = renameTarget;
    setRenameTarget(null);
    if (!target) return;

    runAndLogFailure('Failed to rename item:', async () => {
      const parentPath = getParentPath(target.path);
      const newPath = joinPath(parentPath, newName);
      const success = await api.renameFile(target.path, newPath);
      if (!success) return;

      // If the browse view is showing the renamed item or its parent, refresh it.
      if (target.path === currentPath || parentPath === currentPath || isParentOf(target.path, currentPath)) {
        onRefreshDirectory?.();
      }

      // Refresh the parent folder in the tree if it is expanded.
      await reloadExpandedTreeFolder(parentPath);
    });
  };

  const handleDelete = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;

    runAndLogFailure('Failed to delete item:', async () => {
      const parentPath = getParentPath(target.path);
      const success = await api.deleteFile(target.path);
      if (!success) return;

      deleteItems([target.path]);
      await api.reconcileIndexedFiles(parentPath, false);

      // If the browse view is showing the deleted item or its parent, refresh it.
      if (target.path === currentPath || parentPath === currentPath || isParentOf(target.path, currentPath)) {
        onRefreshDirectory?.();
      }

      // Refresh the parent folder in the tree if it is expanded.
      await reloadExpandedTreeFolder(parentPath);
    });
  };

  /**
   * Handles a drag-and-drop of a file or folder entry onto a directory node.
   * Moves the dragged item into the target folder on disk, removes it from the
   * store, and refreshes both the source and destination folders in the tree and
   * (if visible) in the browse view.
   */
  const handleDropOnFolder = (node: FileNode, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);

    // Read the drag payload synchronously — the DataTransfer is only valid
    // during the event dispatch, before any await.
    const payload = parseDragPayload(e.dataTransfer.getData(ENTRY_DND_MIME));
    if (!payload || !node.isDirectory) return;
    if (!canDropInto(payload, node.path)) return;

    runAndLogFailure('Failed to move item into folder:', async () => {
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
    });
  };

  const handleDragOverFolder = (node: FileNode, e: React.DragEvent) => {
    if (!node.isDirectory) return;
    if (!e.dataTransfer.types.includes(ENTRY_DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverPath !== node.path) setDragOverPath(node.path);
  };

  const handleRunScript = (node: FileNode) => {
    if (runningScript) return;
    setRunningScript(node.path);
    void api.runShellScript(node.path);
    setTimeout(() => setRunningScript(null), 3000);
  };

  const toggleBookmarksMenu = () => setShowBookmarksMenu(prev => !prev);
  const closeBookmarksMenu = () => setShowBookmarksMenu(false);
  const saveTreeWidth = async (width: typeof settings.indexTreeWidth) => {
    setIndexTreeWidth(width);
    await api.updateConfig({ settings: getSettings() });
  };
  const handleNarrowTree = () => void saveTreeWidth(settings.indexTreeWidth === 'wide' ? 'medium' : 'narrow');
  const handleWidenTree = () => void saveTreeWidth(settings.indexTreeWidth === 'narrow' ? 'medium' : 'wide');

  const handleBookmarkNavigate = (fullPath: string) => {
    const lastName = getFileName(fullPath);
    if (lastName.includes('.')) {
      const folderPath = getParentPath(fullPath);
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

  /**
   * Shows the context menu for a heading row. The only available action is
   * "Browse", which scrolls the existing rendered heading into view if the
   * document is already open, or navigates to the file and queues a heading
   * scroll via `pendingScrollToHeadingSlug` otherwise.
   */
  const handleHeadingContextMenu = (node: MarkdownHeadingNode, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      path: node.path,
      isDirectory: false,
      onBrowse: () => {
        const filePath = node.path.substring(0, node.path.lastIndexOf('#'));
        const folderPath = getParentPath(filePath);
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

  /**
   * Shows the context menu for a file or directory row. Available actions depend
   * on node type: directories get Browse/New Folder/Rename/Delete and (when cut
   * items exist) Paste; files get Browse/Rename/Delete and (when a markdown file
   * is being edited) "Paste Link", which inserts a relative Markdown link at the
   * active editor's cursor — using the file's front-matter `id` field as a comment
   * suffix when present. Both directories and files also get "Copy Path" (absolute)
   * and "Copy Relative Path" (relative to the folder currently browsed in
   * BrowseView).
   */
  const handleFileNodeContextMenu = (node: FileNode, e: React.MouseEvent) => {
    e.preventDefault();
    const activeEditor = editingMarkdownPath ? getActiveMarkdownEditor() : null;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      path: node.path,
      isDirectory: node.isDirectory,
      onBrowse: () => {
        if (node.isDirectory) {
          navigateToBrowserPath(node.path);
        } else {
          const folderPath = getParentPath(node.path);
          setHighlightItem(node.path);
          navigateToBrowserPath(folderPath, node.path);
        }
      },
      onRename: () => setRenameTarget({ path: node.path, name: node.name, isDirectory: node.isDirectory }),
      onDelete: () => setDeleteTarget({ path: node.path, name: node.name, isDirectory: node.isDirectory }),
      ...(node.isDirectory ? {
        onNewFolder: () => setCreateFolderParent(node.path),
      } : {}),
      ...(hasCutItems && node.isDirectory ? {
        onPaste: () => handlePasteIntoFolder(node, e),
      } : {}),
      onCopyPath: () => void navigator.clipboard.writeText(node.path),
      onCopyRelativePath: () => void navigator.clipboard.writeText(computeRelativePath(currentPath, node.path)),
      ...(activeEditor && !node.isDirectory ? {
        onPasteLink: () => {
          const editorDir = getParentPath(activeEditor.path);
          const relPath = computeRelativePath(editorDir, node.path);
          const label = getFileName(node.path).replace(/\.md$/, '');
          if (node.path.endsWith('.md')) {
            api.readFile(node.path)
              .then((raw) => {
                const idVal = parseFrontMatter(raw).yaml?.id;
                const id = idVal !== null && idVal !== undefined ? String(idVal) : '';
                const suffix = id ? `<!-- id:${id} -->` : '';
                activeEditor.handle.insertAtCursor(`[${label}](${relPath})${suffix}`);
              })
              .catch(() => {
                // Couldn't read the target file for its id — insert a plain link
                activeEditor.handle.insertAtCursor(`[${label}](${relPath})`);
              });
          } else if (isImageFile(node.name)) {
            activeEditor.handle.insertAtCursor(`![${label}](${relPath})`);
          } else {
            activeEditor.handle.insertAtCursor(`[${label}](${relPath})`);
          }
        },
      } : {}),
    });
  };

  if (!treeRoot?.children) {
    return (
      <div className={`flex flex-col ${widthClass} shrink-0 border-r border-slate-700 bg-slate-900 items-center justify-center`}>
        <span className="text-slate-500">Loading…</span>
      </div>
    );
  }

  const cutPaths = new Set(getCutItems().map(item => item.path));
  const rows = flattenVisible(treeRoot.children, cutPaths, settings.foldersOnTop);
  return (
    <div data-testid="file-explorer-tree" className={`flex flex-col ${widthClass} shrink-0 border-r border-slate-700 bg-slate-900`}>
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
            data-testid="file-explorer-tree-narrow"
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
            data-testid="file-explorer-tree-widen"
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
          bookmarks={settings.bookmarks}
          rootPath={rootPath}
          onNavigate={handleBookmarkNavigate}
        />
      )}
      {contextMenu && (
        <IndexTreeContextMenu
          mousePosition={{ x: contextMenu.x, y: contextMenu.y }}
          isDirectory={contextMenu.isDirectory}
          onClose={() => setContextMenu(null)}
          onBrowse={contextMenu.onBrowse}
          onNewFolder={contextMenu.onNewFolder}
          onRename={contextMenu.onRename}
          onDelete={contextMenu.onDelete}
          onPaste={contextMenu.onPaste}
          onPasteLink={contextMenu.onPasteLink}
          onCopyPath={contextMenu.onCopyPath}
          onCopyRelativePath={contextMenu.onCopyRelativePath}
        />
      )}
      {createFolderParent && (
        <CreateFolderDialog
          onCreate={handleCreateFolder}
          onCancel={() => setCreateFolderParent(null)}
        />
      )}
      {renameTarget && (
        <RenameDialog
          currentName={renameTarget.name}
          isDirectory={renameTarget.isDirectory}
          onRename={handleRename}
          onCancel={() => setRenameTarget(null)}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          message={deleteTarget.isDirectory
            ? `Delete folder "${deleteTarget.name}" and all of its contents?`
            : `Delete file "${deleteTarget.name}"?`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
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
                style={{
                  paddingLeft: `${8 + depth * INDENT_SIZE}px`,
                  ...(contextMenu?.path === node.path ? { backgroundColor: '#1e40af' } : {}),
                }}
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
            className += ' text-white bg-purple-700/50 hover:bg-purple-600/50 border-l-2 border-transparent';
            className += isClickable ? ' cursor-pointer' : ' cursor-default';
          } //
          else if (node.isDirectory && node.path === currentPath) {
            className += ' text-white bg-purple-700/50 hover:bg-purple-600/50 border-l-2 border-transparent cursor-pointer';
          } //
          else if (node.isDirectory && isParentOf(node.path, currentPath)) {
            className += ' text-slate-200 bg-purple-700/50 hover:bg-purple-600/50 border-l-2 border-transparent cursor-pointer';
          } //
          else if (node.isDirectory) {
            className += node.isExpanded
              ? ' text-slate-200 hover:bg-slate-700 border-l-2 border-transparent cursor-pointer'
              : ' text-slate-200 hover:bg-slate-700 border-l-2 border-transparent cursor-pointer';
          } //
          else if (isMd) {
            className += ' text-slate-400 border-l-2 border-transparent cursor-pointer hover:bg-slate-700';
          } //
          else if (isSh) {
            className += ' text-green-400 border-l-2 border-transparent cursor-pointer hover:bg-slate-300/20';
          } //
          else {
            className += ' text-slate-400 border-l-2 border-transparent cursor-default hover:bg-slate-700';
          }

          const isRunning = runningScript === node.path;
          const isDragOver = node.isDirectory && dragOverPath === node.path;
          const isContextTarget = contextMenu?.path === node.path;
          const rowStyle: React.CSSProperties = {
            paddingLeft: `${8 + depth * INDENT_SIZE}px`,
            ...(isRunning ? { animation: 'scriptRunFlash 3s ease-in forwards' } : {}),
            ...(isContextTarget ? { backgroundColor: '#1e40af' } : {}),
          };

          return (
            <div
              key={node.path}
              data-tree-path={node.path}
              className={clsx(className, isDragOver && 'bg-blue-600/40 outline outline-1 outline-blue-400')}
              style={rowStyle}
              onClick={e => {
                if (isSh && e.ctrlKey) { handleRunScript(node); return; }
                if (isClickable) void handleNodeClick(node);
              }}
              onContextMenu={e => handleFileNodeContextMenu(node, e)}
              {...(node.isDirectory ? {
                onDragOver: (e: React.DragEvent) => handleDragOverFolder(node, e),
                onDragLeave: () => setDragOverPath(prev => (prev === node.path ? null : prev)),
                onDrop: (e: React.DragEvent) => handleDropOnFolder(node, e),
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
