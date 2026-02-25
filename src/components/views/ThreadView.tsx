import { useState, useEffect, useCallback, useRef } from 'react';
import type { FileEntry } from '../../global';
import type { ThreadEntry } from '../../store';
import {
  useCurrentPath,
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
  const pendingScrollToBottom = usePendingThreadScrollToBottom();
  const pendingEditFile = usePendingEditFile();
  const pendingEditLineNumber = usePendingEditLineNumber();
  const pendingEditView = usePendingEditView();
  const [threadEntries, setThreadEntries] = useState<ThreadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isThread, setIsThread] = useState(true);

  // Scroll persistence
  const { containerRef: mainContainerRef, handleScroll: handleMainScroll } = useScrollPersistence(
    getThreadScrollPosition,
    setThreadScrollPosition,
  );

  // Fetch thread entries when the current path changes
  const loadThread = useCallback(async () => {
    if (!currentPath) {
      setIsThread(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await window.electronAPI.gatherThreadEntries(currentPath);
      setIsThread(result.isThread);
      setThreadEntries(result.entries);

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
      console.error('Failed to load thread entries:', err);
      setIsThread(false);
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
    const timer = setTimeout(() => {
      setItemExpanded(filePath, true);
      setItemEditing(filePath, true, lineNumber);
      clearPendingEditFile();

      // The editor (CodeMirror) takes up significant vertical space once it
      // mounts.  The earlier scroll-to-bottom fired before the editor existed,
      // so we need a second scroll once the editor has had time to render.
      setTimeout(() => {
        const el = mainContainerRef.current;
        if (el) {
          el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
        }
      }, 300);
    }, 100);
    return () => clearTimeout(timer);
  }, [loading, pendingEditFile, pendingEditView, pendingEditLineNumber, mainContainerRef]);

  // No-ops for actions not meaningful in thread context
  const noopInsert = useCallback((_defaultName: string) => {}, []);

  // --- Render ---

  if (loading && threadEntries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900">
        <p className="text-slate-400">Loading thread…</p>
      </div>
    );
  }

  if (!isThread) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900">
        <p className="text-slate-400">Not an AI Thread</p>
      </div>
    );
  }

  if (threadEntries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900">
        <p className="text-slate-400">Thread is empty — no HUMAN.md or AI.md files found.</p>
      </div>
    );
  }

  return (
    <main
      ref={mainContainerRef}
      onScroll={handleMainScroll}
      className="flex-1 min-h-0 overflow-y-auto pb-4"
    >
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-2">
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
                onInsertFileBelow={noopInsert}
                onInsertFolderBelow={noopInsert}
                onSaveSettings={onSaveSettings}
              />
            </div>
          );
        })}
      </div>
    </main>
  );
}

export default ThreadView;
