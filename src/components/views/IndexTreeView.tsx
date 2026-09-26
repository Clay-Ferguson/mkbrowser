import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MinusIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ListBulletIcon } from '@heroicons/react/24/outline';
import { FolderIcon, FolderOpenIcon } from '@heroicons/react/24/solid';
import { api } from '../../renderer/api';
import { saveSettings } from '../../renderer/config';
import { refreshDirectory } from '../../renderer/directoryLoader';
import { BUTTON_CLASS_XS, ENTRY_DROP_TARGET } from '../../renderer/styles';
import { runOp } from '../../renderer/runOp';
import { isImageFile } from '../../shared/fileTypes';
import FileTypeIcon from '../FileTypeIcon';
import BookmarksPopupMenu from '../menus/BookmarksPopupMenu';
import IndexTreeContextMenu from '../menus/IndexTreeContextMenu';
import CreateFileDialog from '../dialogs/CreateFileDialog';
import CreateFolderDialog from '../dialogs/CreateFolderDialog';
import RenameDialog from '../dialogs/RenameDialog';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import {
  useAS,
  getCutPaths,
  setIndexTreeRoot,
  expandIndexTreeNode,
  collapseIndexTreeNode,
  collapseAllIndexTreeNodes,
  clearPendingIndexTreeReveal,
  getIndexTreeRoot,
  getCutItems,
  cutSingleItem,
  deleteItems,
  renameItem,
  clearAllCutItems,
  navigateToBrowserPath,
  requestDirectoryRefresh,
  setAppError,
  setBrowseFile,
  setHighlightItem,
  setIndexTreeWidth,
  setPendingScrollToHeadingSlug,
} from '../../store';
import type { TreeNode, FileNode, MarkdownFileNode, MarkdownHeadingNode } from '../../store';
import type { FileEntry } from '../../shared/shared';
import { pasteCutItems } from '../../renderer/edit';
import {
  ENTRY_DND_MIME,
  parseDragPayload,
  canDropInto,
  completeEntryDrop,
  makeEntryDragStartHandler,
} from '../../renderer/dragAndDrop';
import {
  reloadExpandedTreeFolder,
  makeTreeNodes as makeNodes,
  mergeTreeNodes as mergeNodes,
  findTreeNodeByPath as findNodeByPath,
} from '../../renderer/treeNodes';
import { createFileOp } from '../../renderer/fileOpsUtil';
import { injectCalendarFrontMatter } from '../../shared/calendarUtil';
import { insertTagIntoText } from '../../shared/tagUtil';
import { generateTimestampFileName } from '../../shared/timeUtil';
import { extractHeadingTree } from '../../shared/tocUtil';
import { scrollElementIntoView } from '../../renderer/entryDom';
import { getActiveMarkdownEditor } from '../../renderer/activeMarkdownEditor';
import { ensureTrailingSep, getFileName, getParentPath, isPathInside, isSamePath, joinPath, splitPathSegments } from '../../renderer/pathUtil';
import { parseFrontMatter } from '../../shared/frontMatterUtil';
import { ATTACH_SUFFIX } from '../../shared/specialFiles';

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAnyExpanded(nodes: TreeNode[]): boolean {
  return nodes.some(n => n.isExpanded);
}

/** The single hashtag a "New TODO" file is born with. */
const TODO_TAG = 'todo';

/**
 * Seed content for a "New TODO": front matter that makes the file both a calendar
 * entry (a `due` property, plus the `start`/`duration` that accompany it) and a
 * tagged todo. Both halves are produced by the same helpers the editor's own
 * "add calendar info" and tag-insert actions use, so a TODO created here is
 * indistinguishable from one assembled by hand. The tag block is built first and
 * the calendar keys prepended above it — that order is a plain text splice, where
 * the reverse would round-trip the calendar values through a YAML re-dump.
 */
function buildTodoContent(): string {
  return injectCalendarFrontMatter(insertTagIntoText('', TODO_TAG), false);
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
  cutPaths: ReadonlySet<string>,
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
 * Whether any markdown file is currently open in edit mode, which is what gates
 * the "Paste Link" context-menu action. Read non-reactively at menu-open time
 * rather than through a `useAS` selector: Zustand evaluates every subscriber's
 * selector on every store write, so subscribing would scan the whole item map
 * on each write (e.g. per debounced keystroke while editing inline) to feed a
 * value only ever read inside an event handler.
 */
function isEditingMarkdown(): boolean {
  for (const [path, item] of useAS.getState().items) {
    if (item.editing && path.endsWith('.md')) return true;
  }
  return false;
}


// ── Rows ─────────────────────────────────────────────────────────────────────
//
// Each visible tree row is its own module-level, memo()'d component so a tree
// render re-executes only the rows whose props changed. The compiler doesn't
// memoize per `.map()` iteration, so with the rows inlined every tree render
// (a highlight move, each dragover target change, a context-menu open) rebuilt
// every row's className chain and handlers. Rows select their own per-row
// booleans (highlighted, current/ancestor folder) so those global values never
// pass through the parent. memo() is justified under the DEVELOPER_GUIDE rule:
// large .map() list, and every prop is stable — `node` keeps its identity until
// that node changes, the flags are primitives, and the handlers are compiled
// in IndexTreeView on inputs that change only on navigation or a cut.

interface TreeHeadingRowProps {
  node: MarkdownHeadingNode;
  depth: number;
  onClick: (node: MarkdownHeadingNode) => void;
}

function TreeHeadingRow({ node, depth, onClick }: TreeHeadingRowProps) {
  const hasChildren = node.children && node.children.length > 0;
  return (
    <div
      data-tree-path={node.path}
      className="flex items-center gap-1 py-0.5 whitespace-nowrap select-none
        text-slate-400 border-l-2 border-transparent cursor-pointer hover:bg-slate-700"
      style={{ paddingLeft: `${8 + depth * INDENT_SIZE}px` }}
      onClick={() => onClick(node)}
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

const MemoTreeHeadingRow = memo(TreeHeadingRow);

/** How a directory row relates to the folder the browse view is showing. */
type FolderRelation = 'current' | 'ancestor' | 'none';

function folderRelation(node: FileNode, currentPath: string): FolderRelation {
  if (!node.isDirectory) return 'none';
  if (node.path === currentPath) return 'current';
  return isParentOf(node.path, currentPath) ? 'ancestor' : 'none';
}

interface TreeFileRowProps {
  node: FileNode;
  depth: number;
  isDragOver: boolean;
  isRunning: boolean;
  isContextTarget: boolean;
  onNodeClick: (node: TreeNode) => Promise<void>;
  onRunScript: (node: FileNode) => void;
  onContextMenu: (node: FileNode, e: React.MouseEvent) => void;
  onDragOverFolder: (node: FileNode, e: React.DragEvent) => void;
  onDragLeaveFolder: (path: string) => void;
  onDropOnFolder: (node: FileNode, e: React.DragEvent) => void;
}

function TreeFileRow({
  node, depth, isDragOver, isRunning, isContextTarget,
  onNodeClick, onRunScript, onContextMenu, onDragOverFolder, onDragLeaveFolder, onDropOnFolder,
}: TreeFileRowProps) {
  // Primitive per-row selectors: only the rows whose answer flips re-render
  // when the highlight moves or the browse view navigates.
  const isHighlighted = useAS(s => s.highlightItem === node.path);
  const relation = useAS(s => folderRelation(node, s.currentPath));

  const isMd = isMarkdownFile(node);
  const isSh = isShellScript(node);

  // The highlighted FILE gets a 2px purple border instead of the solid
  // purple background the folders wear, so the tree reads at a glance:
  // solid purple = the folders on the way to what is on screen, purple
  // outline = the file itself. A highlighted *folder* keeps the solid
  // background — it is still a folder.
  const isHighlightedFile = isHighlighted && !node.isDirectory;

  // That border replaces the row's vertical padding rather than adding to
  // it (2px a side either way), so the highlighted row is exactly as tall
  // as every other row and the tree does not shift when the highlight
  // moves.
  let className = `flex items-center gap-1 ${isHighlightedFile ? 'py-0' : 'py-0.5'} whitespace-nowrap select-none`;
  // The drop highlight replaces the row's normal colors rather than being
  // appended to them: every branch below carries a `hover:bg-…`, and a variant
  // beats a plain `bg-…` of equal specificity, so an appended drop background
  // would always lose (the pointer is over the row it is dragging across).
  // `border-l-2 border-transparent` is kept because it occupies layout space.
  if (isDragOver) {
    className += ` text-white border-l-2 border-transparent cursor-pointer ${ENTRY_DROP_TARGET}`;
  } //
  else if (isHighlightedFile) {
    // `border-2` on all four sides, so no separate `border-l-2` here.
    className += ' text-white border-2 border-purple-500 hover:bg-slate-700 cursor-pointer';
  } //
  else if (isHighlighted) {
    className += ' text-white bg-purple-700/50 hover:bg-purple-600/50 border-l-2 border-transparent cursor-pointer';
  } //
  else if (relation === 'current') {
    className += ' text-white bg-purple-700/50 hover:bg-purple-600/50 border-l-2 border-transparent cursor-pointer';
  } //
  else if (relation === 'ancestor') {
    className += ' text-slate-200 bg-purple-700/50 hover:bg-purple-600/50 border-l-2 border-transparent cursor-pointer';
  } //
  else if (node.isDirectory) {
    className += ' text-slate-200 hover:bg-slate-700 border-l-2 border-transparent cursor-pointer';
  } //
  else if (isMd) {
    className += ' text-slate-400 border-l-2 border-transparent cursor-pointer hover:bg-slate-700';
  } //
  else if (isSh) {
    className += ' text-green-400 border-l-2 border-transparent cursor-pointer hover:bg-slate-300/20';
  } //
  else {
    className += ' text-slate-400 border-l-2 border-transparent cursor-pointer hover:bg-slate-700';
  }

  const rowStyle: React.CSSProperties = {
    paddingLeft: `${8 + depth * INDENT_SIZE}px`,
    ...(isRunning ? { animation: 'scriptRunFlash 3s ease-in forwards' } : {}),
    ...(isContextTarget ? { backgroundColor: '#1e40af' } : {}),
  };

  return (
    <div
      data-tree-path={node.path}
      className={className}
      style={rowStyle}
      onClick={e => {
        // Ctrl+click on a shell script runs it instead of opening it.
        if (isSh && e.ctrlKey) { onRunScript(node); return; }
        void onNodeClick(node);
      }}
      onContextMenu={e => onContextMenu(node, e)}
      {...(node.isDirectory ? {
        onDragOver: (e: React.DragEvent) => onDragOverFolder(node, e),
        onDragLeave: () => onDragLeaveFolder(node.path),
        onDrop: (e: React.DragEvent) => onDropOnFolder(node, e),
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
          : <FileTypeIcon fileName={node.name} />
        }
      </span>
      <span>{node.name}</span>
    </div>
  );
}

const MemoTreeFileRow = memo(TreeFileRow);

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
function IndexTreeView() {
  const rootPath = useAS(s => s.rootPath);
  const currentPath = useAS(s => s.currentPath);
  const treeRoot = useAS(s => s.indexTreeRoot);
  const settings = useAS(s => s.settings);
  const pendingReveal = useAS(s => s.pendingIndexTreeReveal);
  // Subscribing to the cut *paths* (not just "is anything cut") keeps the tree in
  // step when one pending cut replaces another: the boolean would stay true
  // across that swap and leave the newly cut node still on screen.
  const cutPaths = useAS(s => getCutPaths(s.items));
  const hasCutItems = cutPaths.size > 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const bookmarksButtonRef = useRef<HTMLButtonElement>(null);
  // Pending timer, tracked so it can be cancelled when superseded or on unmount.
  const scriptFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showBookmarksMenu, setShowBookmarksMenu] = useState<boolean>(false);
  // Path whose row a reveal has expanded the tree to, awaiting its scroll.
  const [revealScrollTarget, setRevealScrollTarget] = useState<string | null>(null);
  const [runningScript, setRunningScript] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    isDirectory: boolean;
    onBrowse: () => void;
    onNewFile?: () => void;
    onNewTodo?: () => void;
    onNewFolder?: () => void;
    onRename?: () => void;
    onDelete?: () => void;
    onCut?: () => void;
    onPaste?: () => void;
    onPasteLink?: () => void;
    onCopyPath?: () => void;
    onCopyRelativePath?: () => void;
  } | null>(null);
  // Folder awaiting a name for a new file, together with the content that file
  // will be seeded with (empty for "New File", TODO front matter for "New TODO").
  const [createFileParent, setCreateFileParent] = useState<{ folderPath: string; initialContent: string } | null>(null);
  const [createFolderParent, setCreateFolderParent] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ path: string; name: string; isDirectory: boolean } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string; isDirectory: boolean } | null>(null);
  // File whose cut would strand an attachments folder, held while the user confirms.
  const [cutOrphanAttachTarget, setCutOrphanAttachTarget] = useState<FileEntry | null>(null);
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
    // Returns the useEffect cleanup (an unsubscribe-style teardown): sets the ignore flag so the pending load() promise can't set state after unmount/re-run.
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
            expandIndexTreeNode(ancestorPath, mergeNodes(entries, node.children));
          } catch {
            return;
          }
        }

        ancestorPath = joinPath(ancestorPath, segment);
      }

      // Scroll once the expanded tree has rendered — see the layout effect below.
      setRevealScrollTarget(targetPath);
    };

    void expandToPath(pendingReveal);
  }, [pendingReveal, rootPath]);

  // Scrolls the revealed node into view on the first commit that renders it.
  // Its row exists as soon as the last `expandIndexTreeNode` above has
  // committed, and `treeRoot` changing is what re-renders the tree, so keying
  // on it catches exactly that commit — before paint, with no guessed delay.
  // The target stays pending until its row appears; a newer reveal replaces it.
  useLayoutEffect(() => {
    if (!revealScrollTarget) return;
    const el = containerRef.current?.querySelector(`[data-tree-path="${CSS.escape(revealScrollTarget)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    setRevealScrollTarget(null);
  }, [revealScrollTarget, treeRoot]);

  // Cancel a still-pending timer on unmount.
  useEffect(() => () => {
    if (scriptFlashTimerRef.current) clearTimeout(scriptFlashTimerRef.current);
  }, []);

  /**
   * Handles a click on any tree row. Behavior depends on node type:
   * - Heading node: toggles expansion of the heading's child headings.
   * - Any file: opens it on its own in the right-hand pane (see BrowseFile).
   * - Markdown file: additionally toggles its heading children in the tree,
   *   loading them from disk on first expand — so one click both opens the
   *   document and reveals its structure.
   * - Directory: toggles expansion; reads directory contents on first expand.
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

    // Every file — markdown or not — opens in single-file browsing. For
    // markdown this runs alongside the heading toggle below.
    if (!node.isDirectory) {
      setHighlightItem(node.path);
      setBrowseFile(getParentPath(node.path), node.name);
    }

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
        const result = await api.readFile(node.path);
        if (result.ok) {
          const headings = extractHeadingTree(node.path, result.content);
          expandIndexTreeNode(node.path, headings);
        }
        // leave node collapsed if the file couldn't be read
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
      // mergeNodes, not makeNodes: a collapsed folder keeps its loaded children, so
      // re-expanding it restores whatever was open underneath instead of flattening it.
      expandIndexTreeNode(node.path, mergeNodes(entries, node.children));
    } catch {
      // leave node collapsed on error
    }
  };

  /**
   * Moves all cut items into `node`'s folder via rename. Applied partially on
   * disk failure — only the files that actually moved are removed from the store
   * and reconciled with .INDEX.yaml, so the UI never desyncs from disk. The cut
   * flag is cleared only when every item moved successfully, and any failure is
   * reported.
   */
  // Fire-and-forget UI handler: sync signature with the async body run through
  // runOp so failures are reported instead of leaking an unhandled
  // rejection.
  const handlePasteIntoFolder = (node: FileNode) => {
    const cutItems = getCutItems();
    if (cutItems.length === 0) return;

    runOp(async () => {
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
          refreshDirectory();
        }

        // Refresh both the destination and source folders if they are expanded.
        await reloadExpandedTreeFolder(node.path);
        await reloadExpandedTreeFolder(sourceFolder);
      }

      if (result.success) {
        clearAllCutItems();
        return;
      }

      // Rejected outright (pasting into the item's own folder or a subfolder of
      // itself, a name collision) or only partly applied — either way the reason
      // has to reach the user, who is otherwise left with a menu click that did
      // nothing. Items that failed to move stay cut at their source.
      setAppError(result.error || 'Failed to paste items');
    }, 'Failed to paste items into folder: ');
  };

  /**
   * Cuts the right-clicked node, arming the paste actions everywhere else in the
   * app. The tree has no multi-select, so this is always a single item and always
   * starts a fresh pending move (see cutSingleItem).
   *
   * The item is taken from its parent's directory listing rather than built from
   * the tree node, for two reasons: the store entry needs the file's real
   * mtime/birthtime (a placeholder would look like a different file to the next
   * directory load, which would drop the pending cut), and the tree node may not
   * be in the items Map at all when its folder was never browsed. The same
   * listing also reveals an attachments folder — never shown in the tree — that a
   * cut would leave behind, which the user confirms first, as BrowseView does.
   */
  // Fire-and-forget UI handler: sync signature with the async body run through
  // runOp so failures are reported instead of leaking an unhandled
  // rejection.
  const handleCutNode = (node: FileNode) => {
    runOp(async () => {
      const parentPath = getParentPath(node.path);
      const entries = await api.readDirectory(parentPath);
      const entry = entries.find(e => isSamePath(e.path, node.path));
      if (!entry) {
        setAppError(`Cannot cut "${node.name}" because it no longer exists.`);
        return;
      }

      const attachName = `${node.name}${ATTACH_SUFFIX}`;
      if (!node.isDirectory && entries.some(e => e.isDirectory && e.name === attachName)) {
        setCutOrphanAttachTarget(entry);
        return;
      }

      cutSingleItem(entry);
    }, 'Failed to cut item: ');
  };

  /**
   * Creates a file in `folderPath` and leaves the browse view showing that folder
   * with the new file in it (opened for editing, courtesy of createFileOp).
   *
   * The create runs *before* the navigation on purpose: navigating is what makes
   * App load the folder, so by the time that single load happens the file (and its
   * .INDEX.yaml entry) already exist — the listing never renders without it, and no
   * second refresh is needed. Navigating is still worth doing when the folder is
   * already the current one (it drops single-file mode back to the listing, so the
   * new file is actually on screen), but it leaves `currentPath` untouched and so
   * triggers no load — hence the explicit reload request in that case.
   *
   * @param insertAtIndex - Document Mode position for the new file, or null in an
   *   ordinary folder (where the index isn't involved at all).
   * @param initialContent - Seed content for the file ('' for a plain new file).
   */
  const createFileInFolder = async (fileName: string, folderPath: string, insertAtIndex: number | null, initialContent: string) => {
    await createFileOp(
      fileName,
      folderPath,
      insertAtIndex,
      // Only read when insertAtIndex > 0, to name the entry to insert after; we
      // only ever insert at the top, so there is no sibling to resolve.
      [],
      () => setCreateFileParent(null),
      initialContent,
      () => {
        navigateToBrowserPath(folderPath);
        if (isSamePath(folderPath, currentPath)) requestDirectoryRefresh();
      },
    );

    // Show the new file in the tree too, if its folder is expanded there.
    await reloadExpandedTreeFolder(folderPath);
  };

  /**
   * Backs the "New File" and "New TODO" context-menu items, which differ only in
   * what the new file is seeded with. A Document Mode folder (one with an
   * .INDEX.yaml) gets the file immediately, timestamp-named and spliced in at
   * ordinal 0 — the same thing BrowseView's topmost "Insert File Here" bar does.
   * Any other folder gets the name prompt that BrowseView's "Create File" button
   * shows, and is navigated to first so the dialog is confirmed over the folder it
   * writes into.
   */
  const startNewFile = (folderPath: string, initialContent: string) => {
    runOp(async () => {
      const indexYaml = await api.readIndexYaml(folderPath);
      if (!indexYaml) {
        navigateToBrowserPath(folderPath);
        setCreateFileParent({ folderPath, initialContent });
        return;
      }
      await createFileInFolder(generateTimestampFileName(), folderPath, 0, initialContent);
    }, 'Failed to create file: ');
  };

  const handleCreateFile = (fileName: string) => {
    const pending = createFileParent;
    if (!pending) return;
    runOp(() =>
      createFileInFolder(fileName, pending.folderPath, null, pending.initialContent), 'Failed to create file: ');
  };

  const handleCreateFolder = (folderName: string) => {
    const parentPath = createFolderParent;
    if (!parentPath) return;

    runOp(async () => {
      const folderPath = joinPath(parentPath, folderName);
      const result = await api.createFolder(folderPath);
      setCreateFolderParent(null);
      if (!result.success) {
        setAppError(result.error || `Could not create folder "${folderName}".`);
        return;
      }

      await api.reconcileIndexedFiles(parentPath, false);

      // If the browse view is currently showing this folder, refresh it.
      if (parentPath === currentPath) {
        refreshDirectory();
      }

      // Refresh the parent folder in the tree if it is expanded.
      await reloadExpandedTreeFolder(parentPath);
    }, 'Failed to create folder: ');
  };

  const handleRename = (newName: string) => {
    const target = renameTarget;
    setRenameTarget(null);
    if (!target) return;

    runOp(async () => {
      const parentPath = getParentPath(target.path);
      const newPath = joinPath(parentPath, newName);
      const success = await api.renameFile(target.path, newPath);
      if (!success) {
        setAppError(`Could not rename "${target.name}" to "${newName}". An item with that name may already exist.`);
        return;
      }

      // Re-key the cached item (and descendants) and remap the other slices
      // holding paths (bookmarks, calendar events, copied links); persist the
      // settings when a bookmark path changed.
      if (renameItem(target.path, newPath, newName)) {
        saveSettings();
      }

      // If the browse view is showing the renamed item's parent, refresh it. When
      // it is showing the renamed folder itself (or something inside it),
      // renameItem already moved currentPath, and App reloads the new path.
      if (parentPath === currentPath) {
        refreshDirectory();
      }

      // Refresh the parent folder in the tree if it is expanded.
      await reloadExpandedTreeFolder(parentPath);
    }, 'Failed to rename item: ');
  };

  const handleDelete = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;

    runOp(async () => {
      const parentPath = getParentPath(target.path);
      const success = await api.deleteFile(target.path);
      if (!success) {
        setAppError(`Could not delete "${target.name}".`);
        return;
      }

      deleteItems([target.path]);
      await api.reconcileIndexedFiles(parentPath, false);

      // If the browse view is showing the deleted item or its parent, refresh it.
      if (target.path === currentPath || parentPath === currentPath || isParentOf(target.path, currentPath)) {
        refreshDirectory();
      }

      // Refresh the parent folder in the tree if it is expanded.
      await reloadExpandedTreeFolder(parentPath);
    }, 'Failed to delete item: ');
  };

  /**
   * Handles a drag-and-drop of a file or folder entry onto a directory node.
   * Validates the drop here, then hands the move and all the follow-up view
   * refreshes to the shared completeEntryDrop.
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

    runOp(async () => {
      await completeEntryDrop(payload, node.path);
    }, 'Failed to move item into folder: ');
  };

  const handleDragOverFolder = (node: FileNode, e: React.DragEvent) => {
    if (!node.isDirectory) return;
    if (!e.dataTransfer.types.includes(ENTRY_DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Unconditional (no `dragOverPath !== node.path` check): React skips the
    // re-render when the value is unchanged, and not reading dragOverPath keeps
    // this handler stable, so the memo'd rows don't all re-render while dragging.
    setDragOverPath(node.path);
  };

  const handleDragLeaveFolder = (path: string) => {
    setDragOverPath(prev => (prev === path ? null : prev));
  };

  const handleRunScript = (node: FileNode) => {
    if (runningScript) return;
    setRunningScript(node.path);
    void api.runShellScript(node.path);
    scriptFlashTimerRef.current = setTimeout(() => {
      scriptFlashTimerRef.current = null;
      setRunningScript(null);
    }, 3000);
  };

  const toggleBookmarksMenu = () => setShowBookmarksMenu(prev => !prev);
  const closeBookmarksMenu = () => setShowBookmarksMenu(false);
  const saveTreeWidth = (width: typeof settings.indexTreeWidth) => {
    setIndexTreeWidth(width);
    saveSettings();
  };
  const handleNarrowTree = () => saveTreeWidth(settings.indexTreeWidth === 'wide' ? 'medium' : 'narrow');
  const handleWidenTree = () => saveTreeWidth(settings.indexTreeWidth === 'narrow' ? 'medium' : 'wide');

  /**
   * Opens a bookmark. A bookmarked file opens in single-file browsing (same as
   * clicking it in the tree) — a bookmark names one specific document, so
   * showing it alone is what the click meant; no scroll-to-file is needed since
   * it is the only thing on screen. A bookmarked folder browses its listing.
   */
  const handleBookmarkNavigate = (fullPath: string, isDirectory: boolean) => {
    if (isDirectory) {
      navigateToBrowserPath(fullPath);
    } else {
      setHighlightItem(fullPath);
      setBrowseFile(getParentPath(fullPath), getFileName(fullPath));
    }
  };

  /**
   * Handles a click on a heading row: browses to the heading — scrolling the
   * already-rendered heading into view when its document is on screen,
   * otherwise navigating to the file and queueing a heading scroll via
   * `pendingScrollToHeadingSlug` — and toggles the heading's child headings.
   * (Headings have no context menu; this click is the whole interaction.)
   */
  const handleHeadingClick = (node: MarkdownHeadingNode) => {
    // Read at call time, not subscribed: this handler is passed to every
    // heading row, so closing over them would re-render all of those rows on
    // each navigation.
    const { currentPath, browseFileName } = useAS.getState();
    const filePath = node.path.substring(0, node.path.lastIndexOf('#'));
    const folderPath = getParentPath(filePath);
    setHighlightItem(filePath);
    // Scrolling in place keeps single-file mode intact, so hopping between a
    // document's headings never kicks the user back to the folder listing.
    // browseFileName has to be checked as well as the slug: two documents can
    // yield the same slug, and in single-file mode only the one open file is
    // rendered, so a slug hit for any other file is a false positive.
    const showingThisFile = browseFileName === null || joinPath(currentPath, browseFileName) === filePath;
    if (showingThisFile && document.getElementById(node.slug)) {
      scrollElementIntoView(node.slug, true);
    } else {
      setPendingScrollToHeadingSlug(node.slug);
      navigateToBrowserPath(folderPath, filePath);
    }

    const hasChildren = node.children && node.children.length > 0;
    if (hasChildren) void handleNodeClick(node);
  };

  /**
   * Shows the context menu for a file or directory row. Available actions depend
   * on node type: directories get Browse/New File/New TODO/New Folder/Rename/Delete and (when cut
   * items exist) Paste; files get Browse/Rename/Delete and (when a markdown file
   * is being edited) "Paste Link", which inserts a relative Markdown link at the
   * active editor's cursor — using the file's front-matter `id` field as a comment
   * suffix when present. Both directories and files also get "Copy Path" (absolute)
   * and "Copy Relative Path" (relative to the folder currently browsed in
   * BrowseView).
   */
  const handleFileNodeContextMenu = (node: FileNode, e: React.MouseEvent) => {
    e.preventDefault();
    const activeEditor = isEditingMarkdown() ? getActiveMarkdownEditor() : null;
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
        onNewFile: () => startNewFile(node.path, ''),
        onNewTodo: () => startNewFile(node.path, buildTodoContent()),
        onNewFolder: () => setCreateFolderParent(node.path),
      } : {}),
      onCut: () => handleCutNode(node),
      ...(hasCutItems && node.isDirectory ? {
        onPaste: () => handlePasteIntoFolder(node),
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
              .then((result) => {
                // On a failed read, fall back to a plain link (no id suffix),
                // matching the .catch() path below.
                const raw = result.ok ? result.content : '';
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

  const rows = flattenVisible(treeRoot.children, cutPaths, settings.foldersOnTop);
  return (
    <div data-testid="file-explorer-tree" className={`flex flex-col ${widthClass} shrink-0 border-r border-slate-700 bg-slate-900`}>
      <div className="flex items-center justify-between gap-1 px-2 py-1 border-b border-slate-700 shrink-0">
        <button
          ref={bookmarksButtonRef}
          type="button"
          onClick={toggleBookmarksMenu}
          className={`${BUTTON_CLASS_XS} ml-1`}
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
          className={BUTTON_CLASS_XS}
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
            className={BUTTON_CLASS_XS}
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
            className={BUTTON_CLASS_XS}
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
          onNewFile={contextMenu.onNewFile}
          onNewTodo={contextMenu.onNewTodo}
          onNewFolder={contextMenu.onNewFolder}
          onRename={contextMenu.onRename}
          onDelete={contextMenu.onDelete}
          onCut={contextMenu.onCut}
          onPaste={contextMenu.onPaste}
          onPasteLink={contextMenu.onPasteLink}
          onCopyPath={contextMenu.onCopyPath}
          onCopyRelativePath={contextMenu.onCopyRelativePath}
        />
      )}
      {createFileParent && (
        <CreateFileDialog
          onCreate={handleCreateFile}
          onCancel={() => setCreateFileParent(null)}
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
      {cutOrphanAttachTarget && (
        <ConfirmDialog
          message={`"${cutOrphanAttachTarget.name}" has an attachments folder, which the tree does not show and a cut leaves behind. Cut the file without its attachments?`}
          onConfirm={() => {
            const entry = cutOrphanAttachTarget;
            setCutOrphanAttachTarget(null);
            cutSingleItem(entry);
          }}
          onCancel={() => setCutOrphanAttachTarget(null)}
        />
      )}
      <div ref={containerRef} className="flex-1 overflow-auto pl-2 pr-2 pt-2">
      <div className="py-1 min-w-max">
        {rows.map(({ node, depth }) => {
          if (isMarkdownHeadingNode(node)) {
            return <MemoTreeHeadingRow key={node.path} node={node} depth={depth} onClick={handleHeadingClick} />;
          }
          if (!isFileNode(node)) return null;
          return (
            <MemoTreeFileRow
              key={node.path}
              node={node}
              depth={depth}
              isDragOver={node.isDirectory && dragOverPath === node.path}
              isRunning={runningScript === node.path}
              isContextTarget={contextMenu?.path === node.path}
              onNodeClick={handleNodeClick}
              onRunScript={handleRunScript}
              onContextMenu={handleFileNodeContextMenu}
              onDragOverFolder={handleDragOverFolder}
              onDragLeaveFolder={handleDragLeaveFolder}
              onDropOnFolder={handleDropOnFolder}
            />
          );
        })}
      </div>
      </div>
    </div>
  );
}

export default IndexTreeView;
