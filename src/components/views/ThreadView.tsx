import { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { FolderIcon } from '@heroicons/react/24/solid';
import { api } from '../../renderer/api';
import type { FileEntry } from '../../global';
import type { ThreadEntry, ThreadChildFolder } from '../../store';
import {
  navigateToBrowserPath,
  upsertItems,
  clearPendingThreadScrollToBottom,
  clearPendingEditFile,
  setItemExpanded,
  setItemEditing,
  useAS,
} from '../../store';
import { saveAiConfig } from '../../renderer/config';
import EditableCombobox, { type ComboboxOption } from '../EditableCombobox';
import MarkdownEntry from '../entries/MarkdownEntry';
import ThreadAvatar, { ThreadAvatarDefs } from '../ThreadAvatar';
import { logger } from '../../shared/logUtil';
import PathBreadcrumb from '../PathBreadcrumb';

const DEFAULT_PERSONA_NAME = '[Default Agent]';

interface ThreadViewProps {
  onSaveSettings: () => void;
}

/**
 * Fetches the ordered list of HUMAN.md / AI.md turn files for the given folder
 * hierarchy via IPC. Module-level (not in the component) so its try/catch
 * doesn't make the React Compiler bail out on ThreadView. Returns null when
 * the gather fails (already logged here).
 */
async function gatherThread(path: string) {
  try {
    return await api.gatherThreadEntries(path);
  } catch (err) {
    logger.error('Failed to load thread entries:', err);
    return null;
  }
}

/**
 * ThreadView displays an AI conversation thread as a vertical stack of
 * fully-interactive MarkdownEntry components.  It reads the current browser
 * path, walks up the H/A folder hierarchy via IPC, and renders each
 * HUMAN.md or AI.md turn in chronological order (oldest at top).
 */
function ThreadView({ onSaveSettings }: ThreadViewProps) {
  const currentPath = useAS(s => s.currentPath);
  const rootPath = useAS(s => s.rootPath);
  const pendingScrollToBottom = useAS(s => s.pendingThreadScrollToBottom);
  const pendingEditFile = useAS(s => s.pendingEditFile);
  const pendingEditView = useAS(s => s.pendingEditView);
  const [threadEntries, setThreadEntries] = useState<ThreadEntry[]>([]);
  const [childFolders, setChildFolders] = useState<ThreadChildFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [isThread, setIsThread] = useState(true);

  // The persona name and the list of personas both come from the store mirror,
  // so a persona created/renamed/selected in AISettingsView is reflected here
  // without a remount. `typingDraft` holds any in-progress combobox edit until
  // it's committed via onSelect.
  const { aiRewritePrompt, aiRewritePrompts } = useAS(s => s.aiConfig);
  const storedPersona = aiRewritePrompt || DEFAULT_PERSONA_NAME;
  const [typingDraft, setTypingDraft] = useState<string | null>(null);
  const personaName = typingDraft ?? storedPersona;

  /**
   * Commits a persona selection from the combobox, clears the typing draft, and
   * persists the new active persona via `saveAiConfig` so the editor's AI Rewrite
   * button (which reads the same store mirror) picks it up immediately.
   */
  const handlePersonaSelect = (name: string) => {
    setTypingDraft(null);
    void saveAiConfig({ aiRewritePrompt: name });
  };

  // Ref to the scrollable container (used for auto-scrolling to bottom / to an item)
  const mainContainerRef = useRef<HTMLElement | null>(null);

  // Bumped by refreshThread to re-run the load effect without a path change.
  const [refreshTick, setRefreshTick] = useState(0);

  /**
   * Loads the thread when the path changes (or refreshTick is bumped): fetches
   * the ordered list of HUMAN.md / AI.md turn files for the current folder
   * hierarchy via `gatherThread`, seeds the store with each entry's metadata
   * so MarkdownEntry's content loader can warm its cache, and updates the
   * `isThread` / `childFolders` state that drives the UI branches.
   */
  useEffect(() => {
    // A slow gather can resolve after the user has navigated elsewhere, so
    // every state write below (including the loading flip) is gated on the
    // loaded path still being current — otherwise this run's results are
    // stale and belong to a folder we've already left.
    const isStale = () => useAS.getState().currentPath !== currentPath;
    // React's documented pattern for async work in an effect: the body lives
    // in an inline async function rather than the effect body itself.
    void (async () => {
      if (!currentPath) {
        setIsThread(false);
        setChildFolders([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const result = await gatherThread(currentPath);
      if (isStale()) return;
      if (result) {
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
      } else {
        setIsThread(false);
        setChildFolders([]);
      }
      setLoading(false);
    })();
  }, [currentPath, refreshTick]);

  // Callback for entry rename / delete — reload the thread
  const refreshThread = () => setRefreshTick((t) => t + 1);

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

    const filePath = pendingEditFile;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      setItemExpanded(filePath, true);
      setItemEditing(filePath, true);
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
  }, [loading, pendingEditFile, pendingEditView, mainContainerRef]);

  // Navigate breadcrumb — switches to browser view at the given path
  const handleBreadcrumbNavigate = (path: string) => {
    navigateToBrowserPath(path);
  };

  /**
   * Navigates into a conversation branch folder while keeping the current view
   * set to 'thread', so the user drills deeper into the conversation tree
   * without switching to the browser tab.
   */
  const handleChildFolderClick = (folderPath: string) => {
    navigateToBrowserPath(folderPath, undefined, 'thread');
  };

  const breadcrumbHeader = (
    <header className="bg-transparent flex-shrink-0 px-4 py-1 flex flex-wrap items-center gap-y-1">
      <div className="flex items-center gap-3 min-w-0">
        <PathBreadcrumb
          rootPath={rootPath}
          currentPath={currentPath}
          onNavigate={handleBreadcrumbNavigate}
        />
      </div>
      <div className="ml-auto text-sm text-slate-400 flex items-center gap-2">
        <span className="whitespace-nowrap">Chat with Persona:</span>
        <EditableCombobox
          data-testid="thread-persona-combobox"
          value={personaName}
          onChange={setTypingDraft}
          onSelect={(option: ComboboxOption) => handlePersonaSelect(option.value)}
          options={[
            { value: DEFAULT_PERSONA_NAME, label: DEFAULT_PERSONA_NAME },
            ...[...aiRewritePrompts]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => ({ value: p.name, label: p.name })),
          ]}
          placeholder="Select a chat persona..."
          maxVisibleItems={10}
          className="w-64"
        />
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
      className="flex-1 min-h-0 overflow-y-auto pb-4"
    >
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-2">
        <ThreadAvatarDefs />
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
            <div key={entry.filePath} className="flex items-start gap-2">
              <ThreadAvatar role={entry.role} />
              <div
                className={clsx(
                  'flex-1 min-w-0 border-l-4 pl-2',
                  entry.role === 'human' ? 'border-blue-500' : 'border-emerald-500',
                )}
              >
                {/* Purple border marks the turn at the folder the browse view
                    is currently focused on — earlier turns above it came from
                    walking up the tree, later ones from drilling down. */}
                <div
                  className={clsx(entry.folderPath === currentPath && 'border-2 border-purple-500 rounded-sm')}
                >
                  <MarkdownEntry
                    entry={fileEntry}
                    view="thread"
                    onRename={refreshThread}
                    onDelete={refreshThread}
                    onSaveSettings={onSaveSettings}
                  />
                </div>
              </div>
            </div>
          );
        })}

        {/* Conversation branch folders where the thread forks (or where a
            branch folder has no turn file).  Single-child chains are already
            followed automatically by gatherThreadEntries, so these only
            appear when the user must choose which branch to drill into. */}
        {childFolders.length > 0 && (
          <div className="pt-2 space-y-1">
            {childFolders.map((folder) => (
              <div
                key={folder.path}
                className={clsx(
                  'border-l-4 pl-2',
                  folder.role === 'human' ? 'border-blue-500' : 'border-emerald-500',
                )}
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
