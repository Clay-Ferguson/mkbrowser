import { useState, useEffect, useCallback, useRef } from 'react';
import { FolderIcon } from '@heroicons/react/24/solid';
import type { FileEntry } from '../../global';
import type { ThreadEntry, ThreadChildFolder } from '../../store';
import type { AppConfig } from '../../types/shared';
import {
  useCurrentPath,
  useRootPath,
  navigateToBrowserPath,
  upsertItems,
  setThreadScrollPosition,
  getThreadScrollPosition,
  usePendingThreadScrollToBottom,
  clearPendingThreadScrollToBottom,
  usePendingEditFile,
  usePendingEditLineNumber,
  usePendingEditView,
  clearPendingEditFile,
  setItemExpanded,
  setItemEditing,
} from '../../store';
import { useScrollPersistence } from '../../utils/useScrollPersistence';
import MarkdownEntry from '../entries/MarkdownEntry';
import { logger } from '../../utils/logUtil';
import PathBreadcrumb from '../PathBreadcrumb';

interface ThreadViewProps {
  onSaveSettings: () => void;
}

/**
 * ThreadView displays an AI conversation thread as a vertical stack of
 * fully-interactive MarkdownEntry components.  It reads the current browser
 * path, walks up the H/A folder hierarchy via IPC, and renders each
 * HUMAN.md or AI.md turn in chronological order (oldest at top).
 */
function ThreadView({ onSaveSettings }: ThreadViewProps) {
  const currentPath = useCurrentPath();
  const rootPath = useRootPath();
  const pendingScrollToBottom = usePendingThreadScrollToBottom();
  const pendingEditFile = usePendingEditFile();
  const pendingEditLineNumber = usePendingEditLineNumber();
  const pendingEditView = usePendingEditView();
  const [threadEntries, setThreadEntries] = useState<ThreadEntry[]>([]);
  const [childFolders, setChildFolders] = useState<ThreadChildFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [isThread, setIsThread] = useState(true);
  const [personaName, setPersonaName] = useState<string>('[Default Agent]');

  useEffect(() => {
    void window.electronAPI.getConfig().then((config: AppConfig) => {
      setPersonaName(config.aiRewritePrompt || '[Default Agent]');
    });
  }, []);

  // Scroll persistence
  const { containerRef: mainContainerRef, handleScroll: handleMainScroll } = useScrollPersistence(
    getThreadScrollPosition,
    setThreadScrollPosition,
  );

  // Fetch thread entries when the current path changes
  const loadThread = useCallback(async () => {
    if (!currentPath) {
      setIsThread(false);
      setChildFolders([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await window.electronAPI.gatherThreadEntries(currentPath);
      setIsThread(result.isThread);
      setThreadEntries(result.entries);
      setChildFolders(result.childFolders);

      // Seed the store with item data for each entry so that useContentLoader
      // inside MarkdownEntry can look them up and cache content.
      if (result.entries.length > 0) {
        upsertItems(
          result.entries.map((e) => ({
            path: e.filePath,
            name: e.fileName,
            isDirectory: false,
            modifiedTime: e.modifiedTime,
            createdTime: e.createdTime,
          })),
        );
      }
    } catch (err) {
      logger.error('Failed to load thread entries:', err);
      setIsThread(false);
      setChildFolders([]);
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  // Callback for entry rename / delete — reload the thread
  const refreshThread = useCallback(() => {
    void loadThread();
  }, [loadThread]);

  // When pendingScrollToBottom becomes true, remember the intent in a ref.
  // The actual scroll happens once loading finishes (content is rendered).
  const wantScrollToBottomRef = useRef(false);

  useEffect(() => {
    if (!pendingScrollToBottom) return;
    clearPendingThreadScrollToBottom();
    wantScrollToBottomRef.current = true;
  }, [pendingScrollToBottom]);

  // Once loading finishes and we want to scroll to bottom, do it after a short
  // DOM-settle delay so the new entries are painted.
  useEffect(() => {
    if (loading || !wantScrollToBottomRef.current) return;
    wantScrollToBottomRef.current = false;

    // Short delay for the DOM to settle after React renders the new entries
    const timer = setTimeout(() => {
      const el = mainContainerRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [loading, mainContainerRef]);

  // Handle pending edit for thread view (e.g., after Reply creates a new HUMAN.md)
  useEffect(() => {
    if (loading || !pendingEditFile || pendingEditView !== 'thread') return;

    const lineNumber = pendingEditLineNumber ?? undefined;
    const filePath = pendingEditFile;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      setItemExpanded(filePath, true);
      setItemEditing(filePath, true, lineNumber);
      clearPendingEditFile();

      // The editor (CodeMirror) takes up significant vertical space once it
      // mounts.  The earlier scroll-to-bottom fired before the editor existed,
      // so we need a second scroll once the editor has had time to render.
      scrollTimer = setTimeout(() => {
        const el = mainContainerRef.current;
        if (el) {
          el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
        }
      }, 300);
    }, 100);
    return () => {
      clearTimeout(timer);
      if (scrollTimer !== undefined) clearTimeout(scrollTimer);
    };
  }, [loading, pendingEditFile, pendingEditView, pendingEditLineNumber, mainContainerRef]);

  // Navigate breadcrumb — switches to browser view at the given path
  const handleBreadcrumbNavigate = useCallback((path: string) => {
    navigateToBrowserPath(path);
  }, []);

  // Drill into a conversation branch folder while staying on the thread tab.
  // currentPath is shared with the browse view, but we keep currentView as
  // 'thread' so the user remains in the thread UI as they navigate deeper.
  const handleChildFolderClick = useCallback((folderPath: string) => {
    navigateToBrowserPath(folderPath, undefined, 'thread');
  }, []);

  const breadcrumbHeader = (
    <header className="bg-transparent flex-shrink-0 px-4 py-1 flex flex-wrap items-center gap-y-1">
      <div className="flex items-center gap-3 min-w-0">
        <PathBreadcrumb
          rootPath={rootPath}
          currentPath={currentPath}
          onNavigate={handleBreadcrumbNavigate}
        />
      </div>
      <div className="w-full text-sm text-slate-400 mt-0.5 text-center">
        Chat with Persona: <span className="text-slate-200 font-medium">{personaName}</span>
      </div>
    </header>
  );

  // --- Render ---

  if (loading && threadEntries.length === 0) {
    return (
      <>
        {breadcrumbHeader}
        <div className="flex-1 flex items-center justify-center bg-slate-900">
          <p className="text-slate-400">Loading thread…</p>
        </div>
      </>
    );
  }

  if (!isThread) {
    return (
      <>
        {breadcrumbHeader}
        <div className="flex-1 flex items-center justify-center bg-slate-900">
          <p className="text-slate-400">Not an AI Thread</p>
        </div>
      </>
    );
  }

  if (threadEntries.length === 0) {
    return (
      <>
        {breadcrumbHeader}
        <div className="flex-1 flex items-center justify-center bg-slate-900">
          <p className="text-slate-400">Thread is empty — no HUMAN.md or AI.md files found.</p>
        </div>
      </>
    );
  }

  return (
    <>
      {breadcrumbHeader}
      <main
      ref={mainContainerRef}
      onScroll={handleMainScroll}
      className="flex-1 min-h-0 overflow-y-auto pb-4"
    >
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-2">
        {threadEntries.map((entry) => {
          const fileEntry: FileEntry = {
            name: entry.fileName,
            path: entry.filePath,
            isDirectory: false,
            isMarkdown: true,
            modifiedTime: entry.modifiedTime,
            createdTime: entry.createdTime,
          };

          return (
            <div
              key={entry.filePath}
              className={`border-l-4 pl-2 ${
                entry.role === 'human'
                  ? 'border-blue-500'
                  : 'border-emerald-500'
              }`}
            >
              <MarkdownEntry
                entry={fileEntry}
                view="thread"
                onRename={refreshThread}
                onDelete={refreshThread}
                onSaveSettings={onSaveSettings}
              />
            </div>
          );
        })}

        {/* Conversation branch folders directly under the current folder.
            Their presence means we're viewing the thread mid-stream; clicking
            one drills the thread view deeper into that turn. */}
        {childFolders.length > 0 && (
          <div className="pt-2 space-y-1">
            {childFolders.map((folder) => (
              <div
                key={folder.path}
                className={`border-l-4 pl-2 ${
                  folder.role === 'human' ? 'border-blue-500' : 'border-emerald-500'
                }`}
              >
                <div
                  onClick={() => handleChildFolderClick(folder.path)}
                  className="flex items-center gap-3 px-2 py-1 bg-blue-800/50 hover:bg-blue-700/70 transition-colors cursor-pointer rounded-sm"
                >
                  <FolderIcon className="w-5 h-5 text-amber-500 flex-shrink-0" />
                  <span className="font-medium text-slate-200 flex-shrink-0">{folder.name}</span>
                  {folder.aiHint && (
                    <span
                      className="text-slate-400 italic text-sm truncate min-w-0"
                      title={folder.aiHint}
                    >
                      {folder.aiHint}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
    </>
  );
}

export default ThreadView;
