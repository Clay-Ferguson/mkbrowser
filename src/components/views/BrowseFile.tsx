import { useEffect } from 'react';
import { api } from '../../renderer/api';
import type { FileEntry } from '../../global';
import MarkdownEntry from '../entries/MarkdownEntry';
import GenericEntry from '../entries/GenericEntry';
import ImageEntry from '../entries/ImageEntry';
import TextEntry from '../entries/TextEntry';
import PathBreadcrumb from '../PathBreadcrumb';
import {
  setCurrentPath,
  setItemExpanded,
  useAS,
} from '../../store';
import { isImageFile, isTextFile } from '../../shared/fileTypes';
import { getContentWidthClasses } from '../../renderer/styles';

/**
 * Fire-and-forget runner for the rename/delete refresh handler (an entry
 * `onRename`/`onDelete` prop, typed `() => void`): awaits `op` and reports a
 * failure through `onError`, prefixed, instead of leaking an unhandled
 * rejection. Module-level so the handler needs no try/catch body — the React
 * Compiler bails out on try/finally and on value blocks inside a try/catch.
 * Mirrors BrowseView's runOp.
 */
function runOp(op: () => Promise<void>, errorPrefix: string, onError: (msg: string | null) => void): void {
  op().catch((err: unknown) => onError(errorPrefix + (err instanceof Error ? err.message : String(err))));
}

interface BrowseFileProps {
  entries: FileEntry[];
  onRefreshDirectory: () => void;
  onSetError: (error: string | null) => void;
  onSaveSettings: () => void;
}

/**
 * Single-file browsing: renders exactly one file entry in place of the folder
 * listing, for focused reading of one document.
 *
 * Which file is decided by the store's `browseFileName` (a bare name, resolved
 * against `currentPath` — the two are always set together by `setBrowseFile`).
 * App.tsx swaps this in for BrowseView whenever `browseFileName` is non-null.
 *
 * The entry components are self-contained — they read their state from the
 * store by path and render their own CodeMirror editor — so click-to-edit,
 * rename, delete and the rest work here exactly as they do in the list, with
 * no extra wiring. The list-only affordances (index-order move buttons,
 * insert bars, selection toolbar) are simply not passed, and the entries hide
 * them accordingly.
 *
 * Editing is always maximized here (`alwaysExpandedEditor`), and the
 * expand/collapse toggle is hidden along with it.
 */
function BrowseFile({ entries, onRefreshDirectory, onSetError, onSaveSettings }: BrowseFileProps) {
  const rootPath = useAS(s => s.rootPath);
  const currentPath = useAS(s => s.currentPath);
  const browseFileName = useAS(s => s.browseFileName);
  const settings = useAS(s => s.settings);

  // The listing for currentPath is already loaded (App.tsx's
  // loadDirectoryContents ran on the path change and pushed every item into the
  // store via syncDirectoryItems), so the entry is found here rather than
  // re-read, and its ItemData is guaranteed to exist.
  const entry = entries.find((e) => e.name === browseFileName && !e.isDirectory);

  // Editing here is ALWAYS expanded — the entry already owns the whole pane, so
  // a non-expanded editor would just waste it. Deliberately independent of the
  // global `expandedEditor` setting: this neither reads nor writes it, so the
  // user's preference for the folder listing survives a trip through here.
  const expandedEditing = useAS(s => (entry ? (s.items.get(entry.path)?.editing ?? false) : false));

  // Show the content immediately — a single-file view whose one entry sits
  // collapsed would be a dead end.
  const entryPath = entry?.path;
  useEffect(() => {
    if (entryPath) {
      setItemExpanded(entryPath, true);
    }
  }, [entryPath]);

  // Breadcrumb navigation drops back to the folder listing: setCurrentPath
  // clears browseFileName, which is what swaps BrowseView back in.
  const navigateTo = (path: string) => {
    setCurrentPath(path);
  };

  // Rename/delete completion reconciles the index yaml (the file may be listed
  // in it) before reloading the folder, matching BrowseView's handler.
  const handleRefresh = () => {
    runOp(async () => {
      if (currentPath) {
        await api.reconcileIndexedFiles(currentPath, false);
      }
      onRefreshDirectory();
    }, 'Failed to refresh folder: ', onSetError);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Breadcrumbs live outside the scroll container, as in BrowseView, so
          they stay put while the file scrolls. */}
      <header className="bg-transparent flex-shrink-0 px-4 py-1 flex flex-wrap items-center gap-y-1">
        <div data-testid="browse-file-header-breadcrumbs" className="flex items-center gap-3 min-w-0">
          <PathBreadcrumb
            rootPath={rootPath}
            currentPath={currentPath}
            onNavigate={navigateTo}
            onRefreshDirectory={onRefreshDirectory}
          />
        </div>
      </header>

      {/* The expandedEditing class chain converts this into a nested flex
          column so a maximized CodeMirror fills the pane and owns the only
          scrollbar — the entry's own `maximized` styling expects a flexed
          ancestor. Same structure as BrowseView. */}
      <main
        data-testid="browse-file-main-content"
        className={`flex-1 min-h-0 pb-4 pt-1 pr-3 pl-3 relative ${expandedEditing ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}
      >
        <div className={expandedEditing ? 'w-full px-4 flex-1 min-h-0 flex flex-col' : getContentWidthClasses(settings.contentWidth)}>
          {!entry && (
            <div className="flex items-center justify-center py-12">
              <p className="text-slate-400" data-testid="browse-file-not-found">
                {browseFileName ? `File not found: ${browseFileName}` : 'No file selected'}
              </p>
            </div>
          )}

          {entry && (
            <div className={expandedEditing ? 'flex-1 min-h-0 flex flex-col' : undefined}>
              {entry.isMarkdown ? (
                <MarkdownEntry entry={entry} view="browser" onRename={handleRefresh} onDelete={handleRefresh} onSaveSettings={onSaveSettings} alwaysExpandedEditor />
              ) : isImageFile(entry.name) ? (
                /* allImages drives only the fullscreen viewer's prev/next; with
                   one file on screen the file itself is the whole set. */
                <ImageEntry entry={entry} allImages={[entry]} onRename={handleRefresh} onDelete={handleRefresh} onSaveSettings={onSaveSettings} />
              ) : isTextFile(entry.name) ? (
                <TextEntry entry={entry} onRename={handleRefresh} onDelete={handleRefresh} onSaveSettings={onSaveSettings} alwaysExpandedEditor />
              ) : (
                <GenericEntry entry={entry} onRename={handleRefresh} onDelete={handleRefresh} onSaveSettings={onSaveSettings} />
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default BrowseFile;
