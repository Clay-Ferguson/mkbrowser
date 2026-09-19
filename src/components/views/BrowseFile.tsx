import { useEffect } from 'react';
import { api } from '../../renderer/api';
import type { FileEntry } from '../../global';
import MarkdownEntry from '../entries/MarkdownEntry';
import GenericEntry from '../entries/GenericEntry';
import ImageEntry from '../entries/ImageEntry';
import TextEntry from '../entries/TextEntry';
import PDFEntry from '../entries/PDFEntry';
import FolderEntry from '../entries/FolderEntry';
import ThesaurusView from '../editor/ThesaurusView';
import PathBreadcrumb from '../PathBreadcrumb';
import AttachFolderContents from './AttachFolderContents';
import {
  navigateToBrowserPath,
  setCurrentPath,
  setItemExpanded,
  useAS,
} from '../../store';
import { isImageFile, isTextFile, isPdfFile } from '../../shared/fileTypes';
import { getContentWidthClasses } from '../../renderer/styles';
import { getParentPath } from '../../renderer/pathUtil';
import { pasteIntoFolder } from '../../renderer/fileOpsUtil';
import { ATTACH_SUFFIX } from '../../shared/specialFiles';

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
 * Renders the same `PathBreadcrumb` header BrowseView does, at all times —
 * editing included. It used to render none, so that a missing path header
 * marked single-file mode apart from a folder listing that happens to hold one
 * file; in practice the breadcrumb is the fastest way to jump to any ancestor
 * folder, and that outweighs the cue. Every segment is a live exit from
 * single-file mode, including the rightmost one — `navigateToBrowserPath`
 * clears `browseFileName` unconditionally, so "go to the folder I am already
 * in" works, and that segment is the way back to the listing. The other exits
 * are the index tree's "Browse" context-menu item and, in 'expanded-edit' mode,
 * ending the edit.
 *
 * Right-aligned in the same header, a **"Listing Hidden"** badge carries what
 * the breadcrumb cannot: that this pane holds one file rather than a folder's
 * contents. It is plain, non-interactive text — it replaced a "Browse Folder"
 * link that the clickable breadcrumb made redundant — and it is always shown,
 * so the reminder never goes missing.
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
 *
 * Attachments: when the file has a sibling `<name>.attach` folder, that folder
 * row and its contents are rendered below the entry with the same components
 * and indentation BrowseView uses (`FolderEntry` + `AttachFolderContents`), so
 * a file's attachments are visible here just as they are in the listing. They
 * are hidden while editing, when the maximized editor owns the whole pane.
 */
function BrowseFile({ entries, onRefreshDirectory, onSetError, onSaveSettings }: BrowseFileProps) {
  const currentPath = useAS(s => s.currentPath);
  const rootPath = useAS(s => s.rootPath);
  const browseFileName = useAS(s => s.browseFileName);
  const browseFileMode = useAS(s => s.browseFileMode);
  const highlightItem = useAS(s => s.highlightItem);
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

  // The file's attachment folder, if it has one. readDirectory pre-loads its
  // contents into `attachments`, so like the entry itself it needs no extra read.
  // A cut attach folder is hidden, matching BrowseView's filtering of cut rows.
  const attachFolder = entry?.hasAttachFolder
    ? entries.find((e) => e.isDirectory && e.name === `${entry.name}${ATTACH_SUFFIX}`)
    : undefined;
  const attachFolderCut = useAS(s => (attachFolder ? (s.items.get(attachFolder.path)?.isCut ?? false) : false));

  // Is this view's one file open for editing? Drives the maximized layout
  // (editing here is ALWAYS expanded — the entry already owns the whole pane, so
  // a non-expanded editor would just waste it) and hides the attachments strip.
  // Scoped to this view's one entry, never to a "something in the store is
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

  // A breadcrumb segment click: go to that folder's listing. Leaving
  // single-file mode is implicit — navigateToBrowserPath always clears
  // browseFileName — so even the rightmost segment (this file's own folder) is
  // a live exit rather than a no-op. That segment is THE way back to the
  // listing; nothing else in this header is clickable any more.
  //
  // The listing is also scrolled to the highlighted file, exactly as clicking a
  // search result does: every route into single-file browsing (index tree click,
  // bookmark, an entry's "View File" action) sets highlightItem to the file it
  // opens, so going back to its folder lands on that file rather than at the top
  // of a folder the user may have scrolled deep into.
  //
  // Guarded to a highlight inside the folder being navigated to — in practice
  // only the rightmost segment matches. BrowseView consumes pendingScrollToFile
  // only once it finds the element, so a path belonging to another folder would
  // linger and hijack a later navigation there.
  const handleBreadcrumbNavigate = (path: string) => {
    const scrollToFile = highlightItem && getParentPath(highlightItem) === path
      ? highlightItem
      : undefined;
    navigateToBrowserPath(path, scrollToFile);
  };

  // Pastes cut items into a folder shown here — the attach folder or a folder
  // nested inside it. Reads the item map non-reactively: this view has no other
  // use for it, and subscribing would re-render the pane on every store write.
  const handlePasteIntoFolder = (folderPath: string) => {
    runOp(async () => {
      await pasteIntoFolder(folderPath, useAS.getState().items, onSetError, onRefreshDirectory);
    }, 'Failed to paste into folder: ', onSetError);
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
      {/* Header: breadcrumbs on the left, the "Listing Hidden" badge on the
          right — the same "path trail left, status right" shape BrowseView's
          header has, and outside the scroll container so it stays put while the
          file scrolls.

          The breadcrumb renders at ALL times, editing included, and is the only
          interactive thing up here. Clicking any segment leaves single-file mode
          for that folder's listing, because navigateToBrowserPath clears
          browseFileName unconditionally — and that includes the rightmost
          segment, which is this file's own folder, so it doubles as "back to the
          listing I came from".

          The badge beside it is plain text, deliberately NOT a link: the
          breadcrumb already does the navigating, and a second control saying the
          same thing was redundant. What is left is the one job the breadcrumb
          cannot do — telling the user that what they are looking at is one file
          and not a folder listing, which is otherwise only inferable from the
          pane holding a single entry. It is therefore shown unconditionally,
          editing included; it costs no height, since the breadcrumb keeps this
          header row on screen regardless.

          `whitespace-nowrap` keeps "Listing Hidden" on one line: the header is
          `flex-wrap` (for narrow panes and deep paths), and without it the badge
          is the thing that breaks, stacking "Hidden" under "Listing". */}
      <header className="bg-transparent flex-shrink-0 px-4 py-1 flex flex-wrap items-center gap-y-1">
        <div data-testid="browse-file-breadcrumbs" className="flex items-center gap-3 min-w-0">
          <PathBreadcrumb
            rootPath={rootPath}
            currentPath={currentPath}
            onNavigate={handleBreadcrumbNavigate}
            onRefreshDirectory={onRefreshDirectory}
          />
        </div>

        <div className="flex-1 flex items-center justify-end">
          <span
            data-testid="listing-hidden-indicator"
            className="text-amber-400 font-bold text-sm whitespace-nowrap"
            title="You are viewing a single file — the folder listing is hidden. Click a folder in the path above to go back to it."
          >
            Listing Hidden
          </span>
        </div>
      </header>

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

          {/* The file's attachments, laid out exactly as BrowseView lays them out
              under a file: the indented `*.attach` folder row, then its contents
              one level deeper. Hidden while editing (the maximized editor owns
              the pane). When the entry fills the pane (text/PDF), this strip is
              capped and scrolls on its own so the entry keeps most of the height. */}
          {entry && attachFolder && !attachFolderCut && !editing && (
            <div data-testid="browse-file-attachments" className={flexPane ? 'flex-shrink-0 max-h-[40%] overflow-y-auto pt-2' : 'pt-2'}>
              <FolderEntry entry={attachFolder} onNavigate={setCurrentPath} onRename={handleRefresh} onDelete={handleRefresh} onSaveSettings={onSaveSettings} onPasteIntoFolder={handlePasteIntoFolder} onRefreshDirectory={onRefreshDirectory} isAttachFolder={true} indentFolder={true} />
              {attachFolder.attachments && (
                <AttachFolderContents
                  entries={attachFolder.attachments}
                  level={1}
                  onNavigate={setCurrentPath}
                  onRename={handleRefresh}
                  onDelete={handleRefresh}
                  onSaveSettings={onSaveSettings}
                  onPasteIntoFolder={handlePasteIntoFolder}
                />
              )}
            </div>
          )}
        </div>
      </main>

      {/* Synonyms for the word under the editor cursor. A sibling of <main> rather than
          something inside the entry, so it sits below the editor as a fixed strip the
          maximized CodeMirror simply gets shorter by, instead of scrolling away with the
          document. Editing only: with no cursor in a document it would have nothing to
          say, and it would be taking height off a file the user is only reading. It also
          renders nothing at all unless `settings.enableThesaurus` is on (the editor's
          right-click menu toggles that), so the strip costs no height when unused. */}
      {editing && <ThesaurusView />}
    </div>
  );
}

export default BrowseFile;
