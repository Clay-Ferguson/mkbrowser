import { useState, type RefObject } from 'react';
import { FolderIcon, DocumentIcon } from '@heroicons/react/24/solid';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';
import MessageDialog from '../dialogs/MessageDialog';
import { toggleBookmark, isBookmarked, getSettings } from '../../store';

interface BookmarksPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  bookmarks: string[];
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

  // Filter to bookmarks under rootPath
  const filtered = rootPath
    ? bookmarks.filter(b => b === rootPath || b.startsWith(rootPath + '/'))
    : bookmarks;

  // Sort alphabetically by display name (last path segment)
  const sorted = [...filtered].sort((a, b) => {
    const nameA = a.substring(a.lastIndexOf('/') + 1);
    const nameB = b.substring(b.lastIndexOf('/') + 1);
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  });

  const handleClick = async (fullPath: string) => {
    const exists = await window.electronAPI.pathExists(fullPath);
    if (!exists) {
      if (isBookmarked(fullPath)) {
        toggleBookmark(fullPath);
        const config = await window.electronAPI.getConfig();
        await window.electronAPI.saveConfig({ ...config, settings: getSettings() });
      }
      setMissingPath(fullPath);
      return;
    }
    onNavigate(fullPath);
    onClose();
  };

  const isFolder = (path: string) => {
    const name = path.substring(path.lastIndexOf('/') + 1);
    return !name.includes('.');
  };

  // Determine which file names are duplicated so we can show full paths for those
  const fileNames = sorted.map(p => p.substring(p.lastIndexOf('/') + 1));
  const duplicateNames = new Set(
    fileNames.filter((name, i) => fileNames.indexOf(name) !== i)
  );

  return (
    <>
      <PopupMenu anchorRef={anchorRef} onClose={onClose}>
        {sorted.length === 0 ? (
          <PopupMenuItem label="No bookmarks" disabled onClick={onClose} />
        ) : (
          sorted.map((fullPath) => {
            const fileName = fullPath.substring(fullPath.lastIndexOf('/') + 1);
            const folder = isFolder(fullPath);
            let displayName: string;
            if (folder) {
              // Always show full path for folders
              if (rootPath && (fullPath === rootPath || fullPath.startsWith(rootPath + '/'))) {
                displayName = fullPath.slice(rootPath.length);
                if (displayName.startsWith('/')) displayName = displayName.slice(1);
                if (!displayName) displayName = '.';
              } else {
                displayName = fullPath;
              }
            } else if (duplicateNames.has(fileName)) {
              // Show relative path for duplicate file names
              if (rootPath && (fullPath === rootPath || fullPath.startsWith(rootPath + '/'))) {
                displayName = fullPath.slice(rootPath.length);
                if (displayName.startsWith('/')) displayName = displayName.slice(1);
                if (!displayName) displayName = '.';
              } else {
                displayName = fullPath;
              }
            } else {
              displayName = fileName || '.';
            }
            const Icon = folder
              ? (props: { className?: string }) => <FolderIcon {...props} className={`${props.className ?? ''} text-amber-400`} />
              : (props: { className?: string }) => <DocumentIcon {...props} className={`${props.className ?? ''} text-blue-400`} />;
            return (
              <PopupMenuItem
                key={fullPath}
                label={displayName}
                icon={Icon}
                onClick={() => handleClick(fullPath)}
              />
            );
          })
        )}
      </PopupMenu>
      {missingPath && (
        <MessageDialog
          title="Bookmark Not Found"
          message={`The bookmarked path no longer exists and has been removed:\n\n${missingPath}`}
          onClose={() => { setMissingPath(null); onClose(); }}
        />
      )}
    </>
  );
}
