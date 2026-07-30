import { useEffect } from 'react';
import { api } from '../../renderer/api';
import type { FileEntry } from '../../global';
import MarkdownEntry from '../entries/MarkdownEntry';
import GenericEntry from '../entries/GenericEntry';
import ImageEntry from '../entries/ImageEntry';
import TextEntry from '../entries/TextEntry';
import PDFEntry from '../entries/PDFEntry';
import {
  navigateToBrowserPath,
  setItemExpanded,
  useAS,
} from '../../store';
import { isImageFile, isTextFile, isPdfFile } from '../../shared/fileTypes';
import { getContentWidthClasses } from '../../renderer/styles';
import { getFileName } from '../../renderer/pathUtil';

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
 * Deliberately renders **no breadcrumbs**, unlike BrowseView. Their absence is
 * the visual cue that this is single-file mode: with a breadcrumb header this
 * view is pixel-identical to a folder listing that happens to hold one file,
 * which reads as "where did my other files go?". In place of them a single
 * "Browse Folder" text link sits top-right — the one thing the breadcrumb was
 * actually useful for here (leave for the containing folder's listing), without
 * the path header that made the two views look alike. The other exits are the
 * index tree's "Browse" context-menu item and, in 'expanded-edit' mode, ending
 * the edit.
 *
 * Editing is always maximized here, but for one of two reasons, which
 * `browseFileMode` tells apart:
 *
 * - `'browse'` — the user asked to read this file on its own. The entry is
 *   forced expanded via `alwaysExpandedEditor` and the expand/collapse toggle
 *   is hidden, because toggling it would be a no-op. Deliberately independent
 *   of the global `expandedEditor` setting: this mode neither reads nor writes
 *   it, so the user's preference for the folder listing survives a trip here.
 * - `'expanded-edit'` — an edit started in the folder listing while the user's
 *   `expandedEditor` preference was on, and that preference is what maximizes
 *   the entry. So `alwaysExpandedEditor` is NOT passed: the toggle appears, and
 *   collapsing it (or ending the edit) returns to the listing.
 */
function BrowseFile({ entries, onRefreshDirectory, onSetError, onSaveSettings }: BrowseFileProps) {
  const currentPath = useAS(s => s.currentPath);
  const browseFileName = useAS(s => s.browseFileName);
  const browseFileMode = useAS(s => s.browseFileMode);
  const settings = useAS(s => s.settings);

  // See the two modes above. In 'expanded-edit' mode `settings.expandedEditor`
  // is true by construction, so the entry maximizes itself off the setting and
  // the toggle stays live.
  const alwaysExpandedEditor = browseFileMode === 'browse';

  // The listing for currentPath is already loaded (App.tsx's
  // loadDirectoryContents ran on the path change and pushed every item into the
  // store via syncDirectoryItems), so the entry is found here rather than
  // re-read, and its ItemData is guaranteed to exist.
  const entry = entries.find((e) => e.name === browseFileName && !e.isDirectory);

  // Is this view's one file open for editing? Drives both the maximized layout
  // (editing here is ALWAYS expanded — the entry already owns the whole pane, so
  // a non-expanded editor would just waste it) and hiding the Browse Folder
  // link. Scoped to this view's one entry, never to a "something in the store is
  // editing" scan: the items map is global and long-lived, so such a scan goes
  // stale the moment the user navigates elsewhere with a file still open for
  // editing.
  const editing = useAS(s => (entry ? (s.items.get(entry.path)?.editing ?? false) : false));

  // Plain-text files fill the pane at all times, editing or not: TextEntry's CodeMirror
  // would otherwise cap itself at ~60% of the scroll area (a sensible limit for a row in
  // the folder listing, wasted space for the one file that owns this view). Markdown keeps
  // its natural, page-scrolled height unless it is being edited.
  const fillsPane = !!entry && !entry.isMarkdown && !isImageFile(entry.name) && (isTextFile(entry.name) || isPdfFile(entry.name));
  const flexPane = editing || fillsPane;

  // The folder's images, in listing order — the fullscreen viewer's navigation set.
  const folderImages = entries.filter((e) => !e.isDirectory && isImageFile(e.name));

  // Show the content immediately — a single-file view whose one entry sits
  // collapsed would be a dead end.
  const entryPath = entry?.path;
  useEffect(() => {
    if (entryPath) {
      setItemExpanded(entryPath, true);
    }
  }, [entryPath]);

  // The containing folder, for the link's label. currentPath is the folder
  // holding the browsed file (setBrowseFile sets the two together), so its last
  // segment is the name to show — falling back to the path itself for a
  // filesystem root, whose last segment is empty.
  const folderName = getFileName(currentPath) || currentPath;

  // Leaves single-file mode for the containing folder's listing —
  // navigateToBrowserPath clears browseFileName unconditionally, so this works
  // even though currentPath is already that folder.
  const handleBrowseFolder = () => {
    navigateToBrowserPath(currentPath);
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
      {/* No breadcrumb header on purpose — see the component doc above. Just
          this one text link, outside the scroll container so it stays put while
          the file scrolls. Amber to match the folder icon color used in the
          listing and the tree.

          Hidden while the file is being edited: leaving mid-edit is not an
          offer this view should be making, and the editor is maximized then, so
          the row would only be taking space off the top of it.

          The two nested wrappers duplicate <main>'s horizontal padding and the
          width classes of the entry's own wrapper below, so `justify-end` puts
          the link exactly on the entry's right edge. Copying the chain is what
          makes that hold in every contentWidth mode: the entry is centred by
          `mx-auto` inside a max-width, so its right edge moves with the pane
          width and no fixed margin could line up with it. */}
      {!editing && (
        <div className="flex-shrink-0 pr-3 pl-3">
          <div className={flexPane ? 'w-full px-4' : getContentWidthClasses(settings.contentWidth)}>
            <div className="flex justify-end pt-1 pb-1">
              <button
                type="button"
                onClick={handleBrowseFolder}
                data-testid="browse-folder-link"
                className="text-sm text-amber-500 hover:text-amber-400 hover:underline cursor-pointer bg-transparent border-0 p-0"
                title={`Open Folder ${folderName}`}
              >
                Browse Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The flexPane class chain converts this into a nested flex column so a
          maximized CodeMirror fills the pane and owns the only scrollbar — the
          entry's own `maximized` styling expects a flexed ancestor. This view
          is the only place that chain exists; BrowseView renders a plain
          scrolling folder listing and nothing else. */}
      <main
        data-testid="browse-file-main-content"
        className={`flex-1 min-h-0 pb-4 pt-1 pr-3 pl-3 relative ${flexPane ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}
      >
        <div className={flexPane ? 'w-full px-4 flex-1 min-h-0 flex flex-col' : getContentWidthClasses(settings.contentWidth)}>
          {!entry && (
            <div className="flex items-center justify-center py-12">
              <p className="text-slate-400" data-testid="browse-file-not-found">
                {browseFileName ? `File not found: ${browseFileName}` : 'No file selected'}
              </p>
            </div>
          )}

          {entry && (
            <div className={flexPane ? 'flex-1 min-h-0 flex flex-col' : undefined}>
              {entry.isMarkdown ? (
                <MarkdownEntry entry={entry} view="browser" onRename={handleRefresh} onDelete={handleRefresh} onSaveSettings={onSaveSettings} alwaysExpandedEditor={alwaysExpandedEditor} />
              ) : isImageFile(entry.name) ? (
                /* allImages drives only the fullscreen viewer's prev/next. Only this one
                   file is on screen, but the listing for currentPath is already loaded, so
                   the folder's other images are available here — and passing them is what
                   lets Left/Right walk the folder from the fullscreen view, exactly as it
                   does from the folder listing. Passing just [entry] would make the arrow
                   keys silently do nothing. */
                <ImageEntry entry={entry} allImages={folderImages} onRename={handleRefresh} onDelete={handleRefresh} onSaveSettings={onSaveSettings} />
              ) : isTextFile(entry.name) ? (
                <TextEntry entry={entry} onRename={handleRefresh} onDelete={handleRefresh} onSaveSettings={onSaveSettings} alwaysExpandedEditor={alwaysExpandedEditor} />
              ) : isPdfFile(entry.name) ? (
                <PDFEntry entry={entry} onRename={handleRefresh} onDelete={handleRefresh} onSaveSettings={onSaveSettings} />
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
