import { useState, type RefObject } from 'react';
import { FolderIcon, DocumentIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/solid';
import { api } from '../../renderer/api';
import { logger } from '../../shared/logUtil';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';
import AlertDialog from '../dialogs/AlertDialog';
import BookmarkDialog from '../dialogs/BookmarkDialog';
import { saveSettings } from '../../renderer/config';
import { toggleBookmark, isBookmarked, removeBookmark, updateBookmarkName, setBookmarkIsDirectory, revealInTree, type Bookmark } from '../../store';
import {
  MENU_ROW,
  MENU_ICON_BTN,
  MENU_ICON_BTN_EDIT,
  MENU_ICON_BTN_DELETE,
  MENU_ROW_LABEL,
  MENU_ROW_ACTIONS,
  MENU_ROW_ICON,
  MENU_ACTION_ICON,
  MENU_FOLDER_ICON,
  MENU_FILE_ICON,
} from '../../renderer/styles';
import { ensureTrailingSep, getFileName } from '../../renderer/pathUtil';

interface BookmarksPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Full list of bookmarks; the menu filters to those under rootPath. */
  bookmarks: Bookmark[];
  /** Current root folder; bookmarks outside this tree are hidden. */
  rootPath: string;
  /** Called with the bookmark's full path, and whether it is a folder, when the user clicks a bookmark. */
  onNavigate: (fullPath: string, isDirectory: boolean) => void;
}

/**
 * Popup menu listing bookmarks scoped to the current root folder.
 * Items are sorted alphabetically by name. Each row has inline Edit and
 * Delete icon buttons. Clicking a bookmark navigates to it, right-clicking
 * reveals it in the folder tree; if the path
 * no longer exists on disk the bookmark is removed and an alert is shown.
 *
 * See: (USER_GUIDE.md#navigating-with-bookmarks)
 * See: (USER_GUIDE.md#renaming-and-deleting-bookmarks)
 */
export default function BookmarksPopupMenu({
  anchorRef,
  onClose,
  bookmarks,
  rootPath,
  onNavigate,
}: BookmarksPopupMenuProps) {
  const [missingPath, setMissingPath] = useState<string | null>(null);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);

  // Filter to bookmarks under rootPath, then sort alphabetically by name
  const filtered = rootPath
    ? bookmarks.filter(b => b.path === rootPath || b.path.startsWith(ensureTrailingSep(rootPath)))
    : bookmarks;
  const sorted = [...filtered].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

  /** Removes a bookmark from the store and persists the change. */
  const handleDelete = (fullPath: string) => {
    removeBookmark(fullPath);
    saveSettings();
  };

  /** Saves a renamed bookmark label and closes the edit dialog. */
  const handleEditSave = (name: string) => {
    if (!editingBookmark) return;
    updateBookmarkName(editingBookmark.path, name);
    saveSettings();
    setEditingBookmark(null);
  };

  /**
   * Opens the bookmarked path: a left click (`reveal` false) browses to it, a
   * right click (`reveal` true) reveals it in the folder tree instead, exactly
   * like the entry header's "Reveal in folder tree" button. If the path no
   * longer exists on disk, the bookmark is automatically removed and an alert
   * is shown instead. A bookmark saved before `isDirectory` was recorded has
   * its type resolved from disk here and backfilled, so later clicks and its
   * icon are exact.
   */
  const handleClick = (bookmark: Bookmark, reveal: boolean) => {
    const fullPath = bookmark.path;
    void (async () => {
      try {
        const exists = await api.pathExists(fullPath);
        if (!exists) {
          if (isBookmarked(fullPath)) {
            toggleBookmark(fullPath);
            saveSettings();
          }
          setMissingPath(fullPath);
          return;
        }
        let isDirectory = bookmark.isDirectory;
        if (isDirectory === undefined) {
          isDirectory = await api.isDirectory(fullPath);
          setBookmarkIsDirectory(fullPath, isDirectory);
          saveSettings();
        }
        if (reveal) {
          revealInTree(fullPath);
        } else {
          onNavigate(fullPath, isDirectory);
        }
        onClose();
      } catch (err) {
        logger.error('Failed to open bookmark:', err);
      }
    })();
  };

  /**
   * Whether to show a bookmark as a folder. Uses the recorded `isDirectory`;
   * a legacy bookmark without it falls back to a no-extension guess for the
   * icon only (clicking it resolves and backfills the real type).
   */
  const isFolder = (bookmark: Bookmark) =>
    bookmark.isDirectory ?? !getFileName(bookmark.path).includes('.');

  return (
    <>
      {/* Lift MENU_CONTAINER's max-w-xs so the menu grows to fit the longest
          name on one line (the action icons are in-flow and never shrink, so
          their space is always reserved). Capped at the viewport minus
          PopupMenu's 8px edge margins; only beyond that does a name truncate. */}
      <PopupMenu
        anchorRef={anchorRef}
        onClose={onClose}
        disableClose={!!editingBookmark}
        style={{ maxWidth: 'calc(100vw - 16px)' }}
      >
        {sorted.length === 0 ? (
          <PopupMenuItem label="No bookmarks" disabled onClick={onClose} />
        ) : (
          sorted.map((bookmark) => {
            const { path: fullPath, name } = bookmark;
            const folder = isFolder(bookmark);
            const Icon = folder ? FolderIcon : DocumentIcon;
            const iconColorClass = folder ? MENU_FOLDER_ICON : MENU_FILE_ICON;
            return (
              // The whole row (padding and gaps included) is the click target, not
              // just the label; the label stays a <button> so keyboard activation
              // still works, its click bubbling up to this handler.
              <div
                key={fullPath}
                className={`${MENU_ROW} cursor-pointer`}
                onClick={() => handleClick(bookmark, false)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); handleClick(bookmark, true); }}
                title="Click to browse; right-click to reveal in folder tree"
              >
                <button
                  type="button"
                  className={MENU_ROW_LABEL}
                  data-testid={`bookmark-item-${name}`}
                >
                  <Icon className={`${MENU_ROW_ICON} ${iconColorClass}`} />
                  <span className="truncate">{name}</span>
                </button>
                {/* Keep clicks and right-clicks on the action icons from reaching the row. */}
                <div
                  className={`${MENU_ROW_ACTIONS} ml-6`}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className={`${MENU_ICON_BTN} ${MENU_ICON_BTN_EDIT}`}
                    title="Edit bookmark"
                    onClick={(e) => { e.stopPropagation(); setEditingBookmark(bookmark); }}
                    data-testid={`bookmark-edit-button-${name}`}
                  >
                    <PencilIcon className={MENU_ACTION_ICON} />
                  </button>
                  <button
                    type="button"
                    className={`${MENU_ICON_BTN} ${MENU_ICON_BTN_DELETE}`}
                    title="Delete bookmark"
                    onClick={(e) => { e.stopPropagation(); handleDelete(fullPath); }}
                    data-testid={`bookmark-delete-button-${name}`}
                  >
                    <TrashIcon className={MENU_ACTION_ICON} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </PopupMenu>
      {missingPath && (
        <AlertDialog
          preserveWhitespace
          title="Bookmark Not Found"
          message={`The bookmarked path no longer exists and has been removed:\n\n${missingPath}`}
          onClose={() => { setMissingPath(null); onClose(); }}
        />
      )}
      {editingBookmark && (
        <BookmarkDialog
          path={editingBookmark.path}
          isFolder={isFolder(editingBookmark)}
          initialName={editingBookmark.name}
          onSave={handleEditSave}
          onCancel={() => setEditingBookmark(null)}
        />
      )}
    </>
  );
}
