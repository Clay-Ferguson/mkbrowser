import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MinusIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ListBulletIcon } from '@heroicons/react/24/outline';
import { FolderIcon, FolderOpenIcon } from '@heroicons/react/24/solid';
import { api } from '../../renderer/api';
import { saveSettings } from '../../renderer/config';
import { refreshDirectory } from '../../renderer/directoryLoader';
import { BUTTON_CLASS_TB_NORMAL, ENTRY_DROP_TARGET } from '../../renderer/styles';
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
} from '../../store';
import type { TreeNode, FileNode, MarkdownFileNode, MarkdownHeadingNode } from '../../store';
import type { FileEntry } from '../../shared/shared';
import { pasteCutItems, runCutPasteExclusive } from '../../renderer/edit';
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
import { getActiveMarkdownEditor } from '../../renderer/activeMarkdownEditor';
import { appendLinkFragment, formatLinkDestination, formatLinkTitle } from '../../renderer/linkUtil';
import { ensureTrailingSep, getFileName, getParentPath, isPathInside, isSamePath, joinPath, splitPathSegments } from '../../renderer/pathUtil';
import { getOrAddLinkTargetId, openFileSingle } from '../../renderer/linkRepair';
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

/** The Markdown file a heading node belongs to (its synthetic path is `file#index`). */
function headingFilePath(node: MarkdownHeadingNode): string {
  return node.path.substring(0, node.path.lastIndexOf('#'));
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
 * the "Paste Link into Editor" context-menu action. Read non-reactively at menu-open time
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

/**
 * Inserts a relative link to the Markdown file `targetPath` at `editor`'s cursor —
 * `[README](../a/README.md "id:36F7385CA")`, or with `heading` (a heading row's
 * "Paste Link into Editor") `[README — Requirements](../a/README.md#requirements "id:36F7385CA")`,
 * labelled with the file name, an em dash and the heading text.
 * The target's front-matter id rides in the link title, so any Markdown parser
 * returns it with the link and a broken link can be auto-repaired (linkRepair.ts).
 * A target without an id gets one first; with no id at all (unreadable or malformed
 * front matter) this falls back to a plain link.
 *
 * The fragment is the heading's GitHub-style slug (lowercased, spaces → hyphens,
 * punctuation dropped, `-1`/`-2` suffixes on repeats) — the id rehype-slug gives the
 * rendered heading, so it is what the link click scrolls to (see CustomAnchor).
 *
 * Square brackets and backslashes in the label are backslash-escaped, since heading
 * text (and file names) may contain them and an unescaped `]` would end the label.
 */
function insertMarkdownFileLink(editor: NonNullable<ReturnType<typeof getActiveMarkdownEditor>>, targetPath: string, heading?: MarkdownHeadingNode): void {
  const dest = formatLinkDestination(computeRelativePath(getParentPath(editor.path), targetPath));
  const fileLabel = getFileName(targetPath).replace(/\.md$/, '');
  const label = (heading ? `${fileLabel} — ${heading.heading}` : fileLabel).replace(/[[\]\\]/g, '\\$&');
  void getOrAddLinkTargetId(targetPath).then((id) => {
    const title = id ? ` ${formatLinkTitle(`id:${id}`)}` : '';
    editor.handle.insertAtCursor(`[${label}](${appendLinkFragment(dest, heading?.slug ?? '')}${title})`);
  });
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
  onContextMenu: (node: MarkdownHeadingNode, e: React.MouseEvent) => void;
}

function TreeHeadingRow({ node, depth, onClick, onContextMenu }: TreeHeadingRowProps) {
  const hasChildren = node.children && node.children.length > 0;
  return (
    <div
      data-tree-path={node.path}
      className="flex items-center gap-1 py-0.5 whitespace-nowrap select-none
        text-slate-400 border-l-2 border-transparent cursor-pointer hover:bg-slate-700"
      style={{ paddingLeft: `${8 + depth * INDENT_SIZE}px` }}
      onClick={() => onClick(node)}
      onContextMenu={e => onContextMenu(node, e)}
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
  onContextMenu: (node: FileNode, e: React.MouseEvent) => void;
  onDragOverFolder: (node: FileNode, e: React.DragEvent) => void;
  onDragLeaveFolder: (path: string) => void;
  onDropOnFolder: (node: FileNode, e: React.DragEvent) => void;
}

function TreeFileRow({
  node, depth, isDragOver, isRunning, isContextTarget,
  onNodeClick, onContextMenu, onDragOverFolder, onDragLeaveFolder, onDropOnFolder,
}: TreeFileRowProps) {
  // Primitive per-row selectors: only the rows whose answer flips re-render
  // when the highlight moves or the browse view navigates.
  const isHighlighted = useAS(s => s.highlightItem === node.path);
  const relation = useAS(s => folderRelation(node, s.currentPath));

  const isSh = isShellScript(node);

  // Two independent cues, so the tree reads at a glance: a solid purple
  // background marks the folder being browsed and its ancestors, and a 2px
  // purple border marks the highlighted item (file or folder) — the same
  // border the browse view uses. The browsed folder also gets a gray border
  // so it stands out from its ancestors, unless it is itself highlighted.
  const isCurrentFolder = relation === 'current';
  const isOnBrowsedPath = relation !== 'none';

  // The row carries text color, hover and the drop highlight; the name span
  // carries the purple background / borders above. Keeping those on the
  // name (not the full row width) leaves the indentation visible, so the
  // purple path reads as a hierarchy rather than a stack of bars.
  //
  // The drop highlight replaces the row's normal colors rather than being
  // appended to them: every branch below carries a `hover:bg-…`, and a variant
  // beats a plain `bg-…` of equal specificity, so an appended drop background
  // would always lose (the pointer is over the row it is dragging across).
  let className = 'flex items-center gap-1 py-0 border-l-2 border-transparent whitespace-nowrap select-none cursor-pointer';
  if (isDragOver) {
    className += ` text-white ${ENTRY_DROP_TARGET}`;
  } //
  else if (isHighlighted || isCurrentFolder) {
    className += ' text-white hover:bg-slate-700';
  } //
  else if (node.isDirectory) {
    className += ' text-slate-200 hover:bg-slate-700';
  } //
  else if (isSh) {
    className += ' text-green-400 hover:bg-slate-300/20';
  } //
  else {
    className += ' text-slate-400 hover:bg-slate-700';
  }

  // Every name span has a 2px border (transparent unless it marks something),
  // standing in for the row's vertical padding, so all rows are the same
  // height and nothing shifts when the highlight or the current folder moves.
  // During a drag-over the row's drop highlight speaks for the row instead.
  let nameClassName = 'px-1 border-2';
  if (isOnBrowsedPath && !isDragOver) nameClassName += ' bg-purple-700/50';
  if (isDragOver) {
    nameClassName += ' border-transparent';
  } //
  else if (isHighlighted) {
    nameClassName += ' border-purple-500';
  } //
  else if (isCurrentFolder) {
    nameClassName += ' border-slate-400';
  } //
  else {
    nameClassName += ' border-transparent';
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
      onClick={() => void onNodeClick(node)}
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
      <span className={nameClassName}>{node.name}</span>
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
 * that item; a shell script's context menu has a "Run" item. The "Paste Link into
 * Editor" context-menu action inserts a relative Markdown link at the active editor's
 * cursor.
 */
function IndexTreeView() {
  const rootPath = useAS(s => s.rootPath);
  const currentPath = useAS(s => s.currentPath);
  const treeRoot = useAS(s => s.indexTreeRoot);
  const indexTreeWidth = useAS(s => s.settings.indexTreeWidth);
  const foldersOnTop = useAS(s => s.settings.foldersOnTop);
  const bookmarks = useAS(s => s.settings.bookmarks);
  const pendingReveal = useAS(s => s.pendingIndexTreeReveal);
  // Subscribing to the cut *paths* (not just "is anything cut") keeps the tree in
  // step when one pending cut replaces another: the boolean would stay true
  // across that swap and leave the newly cut node still on screen.
  const cutPaths = useAS(s => getCutPaths(s.items));
  const hasCutItems = cutPaths.size > 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const bookmarksButtonRef = useRef<HTMLButtonElement>(null);
  // Bumped per reveal, so an earlier reveal still awaiting a directory read
  // can't expand and scroll to its target after a newer reveal has started.
  const revealTokenRef = useRef(0);
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
    onBrowse?: () => void;
    onRun?: () => void;
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
  const widthClass = indexTreeWidth === 'wide' ? 'w-1/2' : indexTreeWidth === 'medium' ? 'w-1/3' : 'w-1/4';

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
    // Not an effect-cleanup `ignore` flag: clearing the pending reveal above
    // re-runs this effect, whose cleanup would cancel this very reveal.
    const token = ++revealTokenRef.current;

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
            if (token !== revealTokenRef.current) return;
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

    // Exclusive with every other cut-item paste: a second click while this one
    // is still moving the items is a no-op instead of a spurious failure.
    runOp(() => runCutPasteExclusive(async () => {
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

        // If the browse view is currently showing this folder, refresh it. Read the
        // path now, not from the render that built the menu: the user can navigate
        // while the moves above are in flight.
        if (node.path === useAS.getState().currentPath) {
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
    }), 'Failed to paste items into folder: ');
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
        // Read the path now (it may have changed during the create), before navigating.
        const alreadyCurrent = isSamePath(folderPath, useAS.getState().currentPath);
        navigateToBrowserPath(folderPath);
        if (alreadyCurrent) requestDirectoryRefresh();
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

      // If the browse view is currently showing this folder, refresh it (read after the
      // awaits: the user may have navigated meanwhile).
      if (parentPath === useAS.getState().currentPath) {
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
      if (parentPath === useAS.getState().currentPath) {
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

      // If the browse view is showing the deleted item or its parent, refresh it
      // (read after the awaits: the user may have navigated meanwhile).
      const viewedPath = useAS.getState().currentPath;
      if (target.path === viewedPath || parentPath === viewedPath || isParentOf(target.path, viewedPath)) {
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
    runOp(async () => {
      const result = await api.runShellScript(node.path);
      if (!result.success) setAppError('Failed to run script: ' + (result.error ?? 'Unknown error'));
    }, 'Failed to run script: ');
    scriptFlashTimerRef.current = setTimeout(() => {
      scriptFlashTimerRef.current = null;
      setRunningScript(null);
    }, 3000);
  };

  const toggleBookmarksMenu = () => setShowBookmarksMenu(prev => !prev);
  const closeBookmarksMenu = () => setShowBookmarksMenu(false);
  const saveTreeWidth = (width: typeof indexTreeWidth) => {
    setIndexTreeWidth(width);
    saveSettings();
  };
  const handleNarrowTree = () => saveTreeWidth(indexTreeWidth === 'wide' ? 'medium' : 'narrow');
  const handleWidenTree = () => saveTreeWidth(indexTreeWidth === 'narrow' ? 'medium' : 'wide');

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
   * Handles a click on a heading row: opens the heading's file in single-file
   * mode scrolled to the heading (openFileSingle — the same thing clicking a
   * `file.md#heading` link does) and toggles the heading's child headings.
   * Single-file rather than the folder listing because a user jumping to a
   * heading is interested in that one document. openFileSingle reads the
   * browse state at call time rather than this handler subscribing to it: the
   * handler is passed to every heading row, so closing over that state would
   * re-render all of those rows on each navigation.
   */
  const handleHeadingClick = (node: MarkdownHeadingNode) => {
    openFileSingle(headingFilePath(node), node.slug);

    const hasChildren = node.children && node.children.length > 0;
    if (hasChildren) void handleNodeClick(node);
  };

  /**
   * Shows the context menu for a heading row. Its one item is "Paste Link into
   * Editor" (disabled unless a markdown file is being edited), which inserts a
   * link to the heading's file with the heading's slug as the fragment — see
   * insertMarkdownFileLink.
   */
  const handleHeadingContextMenu = (node: MarkdownHeadingNode, e: React.MouseEvent) => {
    e.preventDefault();
    const activeEditor = isEditingMarkdown() ? getActiveMarkdownEditor() : null;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      path: node.path,
      isDirectory: false,
      ...(activeEditor ? {
        onPasteLink: () => insertMarkdownFileLink(activeEditor, headingFilePath(node), node),
      } : {}),
    });
  };

  /**
   * Shows the context menu for a file or directory row. Available actions depend
   * on node type: directories get Browse/New File/New TODO/New Folder/Rename/Delete and (when cut
   * items exist) Paste; files get Browse/Rename/Delete and (when a markdown file
   * is being edited; otherwise shown disabled) "Paste Link into Editor", which inserts a relative Markdown link (to the file or folder) at the
   * active editor's cursor — using a Markdown target's front-matter `id` field as the
   * link title (`"id:…"`), first adding an id to the target when it has none. Shell scripts (`.sh`) also get "Run". Both directories
   * and files also get "Copy Path" (absolute) and "Copy Relative Path" (relative
   * to the folder currently browsed in BrowseView).
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
      ...(isShellScript(node) ? {
        onRun: () => handleRunScript(node),
      } : {}),
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
      // Folders link too: clicking a folder link browses into that folder (see CustomAnchor).
      ...(activeEditor ? {
        onPasteLink: () => {
          const editorDir = getParentPath(activeEditor.path);
          const relPath = formatLinkDestination(computeRelativePath(editorDir, node.path));
          const name = getFileName(node.path);
          const label = node.isDirectory ? name : name.replace(/\.md$/, '');
          if (!node.isDirectory && node.path.endsWith('.md')) {
            insertMarkdownFileLink(activeEditor, node.path);
          } else if (!node.isDirectory && isImageFile(node.name)) {
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

  const rows = flattenVisible(treeRoot.children, cutPaths, foldersOnTop);
  return (
    <div data-testid="file-explorer-tree" className={`flex flex-col ${widthClass} shrink-0 border-r border-slate-700 bg-slate-900`}>
      <div className="flex items-center justify-between gap-1 px-2 py-1 border-b border-slate-700 shrink-0">
        <button
          ref={bookmarksButtonRef}
          type="button"
          onClick={toggleBookmarksMenu}
          className={`${BUTTON_CLASS_TB_NORMAL} ml-1`}
          title="Bookmarks menu"
          data-testid="bookmarks-menu-button"
        >
          <ListBulletIcon className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={collapseAllIndexTreeNodes}
          disabled={!isAnyExpanded(treeRoot.children)}
          className={BUTTON_CLASS_TB_NORMAL}
          title="Collapse All"
          data-testid="file-explorer-tree-collapse"
        >
          <span className="flex items-center justify-center w-6 h-6 border border-current rounded-sm">
            <MinusIcon className="w-4 h-4" />
          </span>
        </button>
        {indexTreeWidth !== 'narrow' && (
          <button
            type="button"
            onClick={handleNarrowTree}
            className={BUTTON_CLASS_TB_NORMAL}
            title="Narrow tree"
            data-testid="file-explorer-tree-narrow"
          >
            <ChevronDoubleLeftIcon className="w-6 h-6" />
          </button>
        )}
        {indexTreeWidth !== 'wide' && (
          <button
            type="button"
            onClick={handleWidenTree}
            className={BUTTON_CLASS_TB_NORMAL}
            title="Widen tree"
            data-testid="file-explorer-tree-widen"
          >
            <ChevronDoubleRightIcon className="w-6 h-6" />
          </button>
        )}
        </div>
      </div>
      {showBookmarksMenu && (
        <BookmarksPopupMenu
          anchorRef={bookmarksButtonRef}
          onClose={closeBookmarksMenu}
          bookmarks={bookmarks}
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
          onRun={contextMenu.onRun}
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
            return <MemoTreeHeadingRow key={node.path} node={node} depth={depth} onClick={handleHeadingClick} onContextMenu={handleHeadingContextMenu} />;
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
