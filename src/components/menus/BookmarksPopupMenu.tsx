import { useState, type RefObject } from 'react';
import { FolderIcon, DocumentIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/solid';
import { api } from '../../renderer/api';
import { logger } from '../../shared/logUtil';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';
import AlertDialog from '../dialogs/AlertDialog';
import BookmarkDialog from '../dialogs/BookmarkDialog';
import { toggleBookmark, isBookmarked, getSettings, removeBookmark, updateBookmarkName, type Bookmark } from '../../store';
import {
  MENU_ROW,
  MENU_ICON_BTN,
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
  /** Called with the bookmark's full path when the user clicks a bookmark. */
  onNavigate: (fullPath: string) => void;
}

/**
 * Popup menu listing bookmarks scoped to the current root folder.
 * Items are sorted alphabetically by name. Each row has inline Edit and
 * Delete icon buttons. Clicking a bookmark navigates to it; if the path
 * no longer exists on disk the bookmark is removed and an alert is shown.
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

  /** Writes the current settings (including bookmarks) to the config file. */
  const persistBookmarks = async () => {
    await api.updateConfig({ settings: getSettings() });
  };

  /**
   * Removes a bookmark from the store and persists the change. Fire-and-forget
   * (`() => void`) so it can be bound directly to onClick; the persist error is
   * reported here rather than leaking an unhandled rejection.
   */
  const handleDelete = (fullPath: string) => {
    removeBookmark(fullPath);
    void (async () => {
      try {
        await persistBookmarks();
      } catch (err) {
        logger.error('Failed to delete bookmark:', err);
      }
    })();
  };

  /** Saves a renamed bookmark label and closes the edit dialog. */
  const handleEditSave = (name: string) => {
    if (!editingBookmark) return;
    updateBookmarkName(editingBookmark.path, name);
    void (async () => {
      try {
        await persistBookmarks();
        setEditingBookmark(null);
      } catch (err) {
        logger.error('Failed to save bookmark name:', err);
      }
    })();
  };

  /**
   * Navigates to the bookmarked path. If the path no longer exists on disk,
   * the bookmark is automatically removed and an alert is shown instead.
   */
  const handleClick = (fullPath: string) => {
    void (async () => {
      try {
        const exists = await api.pathExists(fullPath);
        if (!exists) {
          if (isBookmarked(fullPath)) {
            toggleBookmark(fullPath);
            await api.updateConfig({ settings: getSettings() });
          }
          setMissingPath(fullPath);
          return;
        }
        onNavigate(fullPath);
        onClose();
      } catch (err) {
        logger.error('Failed to open bookmark:', err);
      }
    })();
  };

  /** Heuristic: treats a path as a folder when its filename has no extension. */
  const isFolder = (path: string) => {
    const name = getFileName(path);
    return !name.includes('.');
  };

  return (
    <>
      <PopupMenu anchorRef={anchorRef} onClose={onClose} disableClose={!!editingBookmark}>
        {sorted.length === 0 ? (
          <PopupMenuItem label="No bookmarks" disabled onClick={onClose} />
        ) : (
          sorted.map((bookmark) => {
            const { path: fullPath, name } = bookmark;
            const folder = isFolder(fullPath);
            const Icon = folder ? FolderIcon : DocumentIcon;
            const iconColorClass = folder ? MENU_FOLDER_ICON : MENU_FILE_ICON;
            return (
              <div
                key={fullPath}
                className={MENU_ROW}
              >
                <button
                  type="button"
                  className={MENU_ROW_LABEL}
                  onClick={() => handleClick(fullPath)}
                  data-testid={`bookmark-item-${name}`}
                >
                  <Icon className={`${MENU_ROW_ICON} ${iconColorClass}`} />
                  <span className="truncate">{name}</span>
                </button>
                <div className={`${MENU_ROW_ACTIONS} ml-4`}>
                  <button
                    type="button"
                    className={`${MENU_ICON_BTN} hover:text-slate-100`}
                    title="Edit bookmark"
                    onClick={(e) => { e.stopPropagation(); setEditingBookmark(bookmark); }}
                    data-testid={`bookmark-edit-button-${name}`}
                  >
                    <PencilIcon className={MENU_ACTION_ICON} />
                  </button>
                  <button
                    type="button"
                    className={`${MENU_ICON_BTN} hover:text-red-400`}
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
          isFolder={isFolder(editingBookmark.path)}
          initialName={editingBookmark.name}
          onSave={handleEditSave}
          onCancel={() => setEditingBookmark(null)}
        />
      )}
    </>
  );
}
