import { useState, type RefObject } from 'react';
import { FolderIcon, DocumentIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/solid';
import { api } from '../../services/api';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';
import AlertDialog from '../dialogs/AlertDialog';
import BookmarkDialog from '../dialogs/BookmarkDialog';
import { toggleBookmark, isBookmarked, getSettings, removeBookmark, updateBookmarkName, type Bookmark } from '../../store';
import { MENU_ROW, MENU_ICON_BTN } from '../../utils/styles';
import { ensureTrailingSep, getFileName } from '../../utils/pathUtil';

interface BookmarksPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  bookmarks: Bookmark[];
  rootPath: string;
  onNavigate: (fullPath: string) => void;
}

export default function BookmarksPopupMenu({
  anchorRef,
  onClose,
  bookmarks,
  rootPath,
  onNavigate,
}: BookmarksPopupMenuProps) {
  const [missingPath, setMissingPath] = useState<string | null>(null);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);

  // Filter to bookmarks under rootPath
  const filtered = rootPath
    ? bookmarks.filter(b => b.path === rootPath || b.path.startsWith(ensureTrailingSep(rootPath)))
    : bookmarks;

  // Sort alphabetically by bookmark name
  const sorted = [...filtered].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

  const persistBookmarks = async () => {
    await api.updateConfig({ settings: getSettings() });
  };

  const handleDelete = async (fullPath: string) => {
    removeBookmark(fullPath);
    await persistBookmarks();
  };

  const handleEditSave = async (name: string) => {
    if (!editingBookmark) return;
    updateBookmarkName(editingBookmark.path, name);
    await persistBookmarks();
    setEditingBookmark(null);
  };

  const handleClick = async (fullPath: string) => {
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
  };

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
            const iconColorClass = folder ? 'text-amber-400' : 'text-blue-400';
            return (
              <div
                key={fullPath}
                className={MENU_ROW}
              >
                <button
                  className="flex items-center gap-2 flex-1 text-left text-sm text-slate-200 cursor-pointer min-w-0"
                  onClick={() => handleClick(fullPath)}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${iconColorClass}`} />
                  <span className="truncate">{name}</span>
                </button>
                <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity pl-2">
                  <button
                    className={`${MENU_ICON_BTN} hover:text-slate-100`}
                    title="Edit bookmark"
                    onClick={(e) => { e.stopPropagation(); setEditingBookmark(bookmark); }}
                  >
                    <PencilIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className={`${MENU_ICON_BTN} hover:text-red-400`}
                    title="Delete bookmark"
                    onClick={(e) => { e.stopPropagation(); void handleDelete(fullPath); }}
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
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
