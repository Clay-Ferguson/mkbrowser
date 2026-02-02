import { useState, useRef, useEffect } from 'react';
import { PencilIcon, ArrowTopRightOnSquareIcon, TrashIcon, DocumentPlusIcon, FolderPlusIcon, PhotoIcon, BookmarkIcon as BookmarkOutlineIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';
import type { FileEntry as FileEntryType } from '../../global';
import { buildEntryHeaderId } from '../../utils/entryDom';
import { CHECKBOX_CLASSES, RENAME_INPUT_CLASSES, INSERT_FILE_BUTTON_CLASSES, INSERT_FOLDER_BUTTON_CLASSES, RENAME_BUTTON_CLASSES, OPEN_EXTERNAL_BUTTON_CLASSES, DELETE_BUTTON_CLASSES, BOOKMARK_BUTTON_CLASSES } from '../../utils/styles';
import { useItem, useHighlightItem, useSettings, setHighlightItem, setItemRenaming, setItemSelected, toggleItemExpanded, toggleBookmark, updateBookmarkPath, setPendingScrollToFile } from '../../store';
import { hasOrdinalPrefix, getNextOrdinalPrefix } from '../../utils/ordinals';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ErrorDialog from '../dialogs/ErrorDialog';

interface ImageEntryProps {
  entry: FileEntryType;
  allImages: FileEntryType[];
  onRename: () => void;
  onDelete: () => void;
  onInsertFileBelow: (defaultName: string) => void;
  onInsertFolderBelow: (defaultName: string) => void;
  onSaveSettings: () => void;
}

function ImageEntry({ entry, allImages, onRename, onDelete, onInsertFileBelow, onInsertFolderBelow, onSaveSettings }: ImageEntryProps) {
  console.log('[ImageEntry] Rendering entry:', entry.name, 'path:', entry.path);
  
  const item = useItem(entry.path);
  const highlightItem = useHighlightItem();
  const settings = useSettings();
  const [newName, setNewName] = useState(entry.name);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenDeleteConfirm, setShowFullscreenDeleteConfirm] = useState(false);
  const [fullscreenImagePath, setFullscreenImagePath] = useState(entry.path);
  const [showEndAlert, setShowEndAlert] = useState(false);
  const [showBeginningAlert, setShowBeginningAlert] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isRenaming = item?.renaming ?? false;
  const isExpanded = item?.isExpanded ?? true;  // Default to expanded for images
  const isSelected = item?.isSelected ?? false;
  const isHighlighted = highlightItem === entry.name;
  const isBookmarked = (settings.bookmarks || []).includes(entry.path);
  const showInsertIcons = hasOrdinalPrefix(entry.name);
  const nextOrdinalPrefix = showInsertIcons ? getNextOrdinalPrefix(entry.name) : null;

  console.log('[ImageEntry] State:', { isRenaming, isExpanded, isSelected });

  // Focus input when entering rename mode
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      // Select filename without extension
      const dotIndex = entry.name.lastIndexOf('.');
      if (dotIndex > 0) {
        inputRef.current.setSelectionRange(0, dotIndex);
      } else {
        inputRef.current.select();
      }
    }
  }, [isRenaming, entry.name]);

  // Handle Escape key to close fullscreen overlay and arrow keys for navigation
  useEffect(() => {
    if (!isFullscreen) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
        setFullscreenImagePath(entry.path); // Reset to this entry's image
      } else if (e.key === 'ArrowRight') {
        const currentIndex = allImages.findIndex(img => img.path === fullscreenImagePath);
        if (currentIndex === -1 || currentIndex >= allImages.length - 1) {
          setShowEndAlert(true);
        } else {
          setFullscreenImagePath(allImages[currentIndex + 1].path);
        }
      } else if (e.key === 'ArrowLeft') {
        const currentIndex = allImages.findIndex(img => img.path === fullscreenImagePath);
        if (currentIndex === -1 || currentIndex <= 0) {
          setShowBeginningAlert(true);
        } else {
          setFullscreenImagePath(allImages[currentIndex - 1].path);
        }
      } else if (e.key === 'Delete') {
        setShowFullscreenDeleteConfirm(true);
      } else if (e.key.toLowerCase() === 'j') {
        // Jump to the current fullscreen image - close fullscreen, scroll to it, and highlight it
        const currentImage = allImages.find(img => img.path === fullscreenImagePath) || entry;
        setIsFullscreen(false);
        setFullscreenImagePath(entry.path); // Reset to this entry's image
        setHighlightItem(currentImage.name);
        setPendingScrollToFile(currentImage.name);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, entry.path, fullscreenImagePath, allImages]);

  // Get the current image being displayed in fullscreen
  const currentFullscreenImage = allImages.find(img => img.path === fullscreenImagePath) || entry;
  const fullscreenImageUrl = `local-file://${fullscreenImagePath}`;



  const handleFullscreenDeleteConfirm = async () => {
    setShowFullscreenDeleteConfirm(false);
    const currentIndex = allImages.findIndex(img => img.path === fullscreenImagePath);
    const pathToDelete = fullscreenImagePath;
    
    // Determine which image to show next
    let nextImagePath: string | null = null;
    if (allImages.length > 1) {
      if (currentIndex < allImages.length - 1) {
        // There's a next image, switch to it
        nextImagePath = allImages[currentIndex + 1].path;
      } else if (currentIndex > 0) {
        // No next image but there's a previous one
        nextImagePath = allImages[currentIndex - 1].path;
      }
    }
    
    try {
      const success = await window.electronAPI.deleteFile(pathToDelete);
      if (success) {
        if (nextImagePath) {
          setFullscreenImagePath(nextImagePath);
        } else {
          // No more images, close fullscreen
          setIsFullscreen(false);
        }
        onDelete();
      }
    } catch (error) {
      console.error('[ImageEntry] Failed to delete image:', error);
    }
  };

  const handleFullscreenDeleteCancel = () => {
    setShowFullscreenDeleteConfirm(false);
  };

  const handleRenameClick = () => {
    setNewName(entry.name);
    setItemRenaming(entry.path, true);
  };

  const handleCancel = () => {
    setNewName(entry.name);
    setItemRenaming(entry.path, false);
  };

  const handleSave = async () => {
    const trimmedName = newName.trim();
    if (!trimmedName || trimmedName === entry.name) {
      handleCancel();
      return;
    }

    setSaving(true);
    try {
      const dirPath = entry.path.substring(0, entry.path.lastIndexOf('/'));
      const newPath = `${dirPath}/${trimmedName}`;
      const success = await window.electronAPI.renameFile(entry.path, newPath);
      if (success) {
        // Update bookmark if this item was bookmarked
        if (updateBookmarkPath(entry.path, newPath)) {
          onSaveSettings();
        }
        setItemRenaming(entry.path, false);
        setHighlightItem(trimmedName);
        onRename();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    setShowDeleteConfirm(false);
    setDeleting(true);
    try {
      const success = await window.electronAPI.deleteFile(entry.path);
      if (success) {
        onDelete();
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  const handleBookmarkClick = () => {
    toggleBookmark(entry.path);
    onSaveSettings();
  };

  const handleToggleExpanded = () => {
    toggleItemExpanded(entry.path);
  };

  const handleInsertFileBelow = () => {
    if (nextOrdinalPrefix) {
      onInsertFileBelow(nextOrdinalPrefix);
    }
  };

  const handleInsertFolderBelow = () => {
    if (nextOrdinalPrefix) {
      onInsertFolderBelow(nextOrdinalPrefix);
    }
  };

  // Convert file path to local-file:// URL for the image src
  const imageUrl = `local-file://${entry.path}`;
  console.log('[ImageEntry] Image URL:', imageUrl);

  return (
    <div className={`bg-slate-800 rounded-lg border ${isHighlighted ? 'border-2 border-purple-500' : 'border-slate-700'} overflow-hidden`}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-1">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => setItemSelected(entry.path, e.target.checked)}
          className={CHECKBOX_CLASSES}
          aria-label={`Select ${entry.name}`}
        />
        {/* Image icon */}
        <PhotoIcon className="w-5 h-5 text-green-500 flex-shrink-0" />
        {isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            id={buildEntryHeaderId(entry.name)}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            disabled={saving}
            className={RENAME_INPUT_CLASSES}
          />
        ) : (
          <span
            id={buildEntryHeaderId(entry.name)}
            onClick={handleToggleExpanded}
            className="text-green-400 truncate flex-1 cursor-pointer no-underline"
            title={isExpanded ? 'Collapse image' : 'Expand image'}
          >
            {entry.name}
          </span>
        )}
        {!isRenaming && (
          <div className="flex items-center gap-1">
            {showInsertIcons && (
              <>
                <button
                  onClick={handleInsertFileBelow}
                  className={INSERT_FILE_BUTTON_CLASSES}
                  title="Insert file below"
                >
                  <DocumentPlusIcon className="w-5 h-5" />
                </button>
                <button
                  onClick={handleInsertFolderBelow}
                  className={INSERT_FOLDER_BUTTON_CLASSES}
                  title="Insert folder below"
                >
                  <FolderPlusIcon className="w-5 h-5" />
                </button>
              </>
            )}
            <button
              onClick={handleRenameClick}
              className={RENAME_BUTTON_CLASSES}
              title="Rename"
            >
              <PencilIcon className="w-5 h-5" />
            </button>
            <button
              onClick={() => window.electronAPI.openExternal(entry.path)}
              className={OPEN_EXTERNAL_BUTTON_CLASSES}
              title="Open with system default"
            >
              <ArrowTopRightOnSquareIcon className="w-5 h-5" />
            </button>
            <button
              onClick={handleDeleteClick}
              disabled={deleting}
              className={DELETE_BUTTON_CLASSES}
              title="Delete"
            >
              <TrashIcon className="w-5 h-5" />
            </button>
            <button
              onClick={handleBookmarkClick}
              className={BOOKMARK_BUTTON_CLASSES}
              title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
            >
              {isBookmarked ? (
                <BookmarkSolidIcon className="w-5 h-5 text-blue-400" />
              ) : (
                <BookmarkOutlineIcon className="w-5 h-5" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Expanded image content */}
      {isExpanded && (
        <div className="px-4 pb-4">
          <div className="bg-slate-900 rounded-lg p-4 flex items-center justify-center">
            <img
              src={imageUrl}
              alt={entry.name}
              className="max-w-full max-h-96 object-contain rounded cursor-pointer hover:opacity-90 transition-opacity"
              loading="lazy"
              onClick={() => setIsFullscreen(true)}
              title="Click to view fullscreen"
              onLoad={() => console.log('[ImageEntry] Image loaded successfully:', imageUrl)}
              onError={(e) => console.error('[ImageEntry] Image failed to load:', imageUrl, 'Error:', e)}
            />
          </div>
        </div>
      )}

      {/* Fullscreen overlay - use keyboard: Left/Right arrows to navigate, Delete to delete, Escape to close */}
      {isFullscreen && (
        <div 
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={() => {
            setIsFullscreen(false);
            setFullscreenImagePath(entry.path);
          }}
        >
          <span className="absolute top-2 left-2 text-white/60 text-xs">ESC=Close, J=Jump to Image</span>
          <img
            src={fullscreenImageUrl}
            alt={currentFullscreenImage.name}
            className="max-w-[95vw] max-h-[95vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* End of images alert */}
      {showEndAlert && (
        <ErrorDialog
          title="End of Images"
          message="You have reached the end of the images in this folder."
          onClose={() => setShowEndAlert(false)}
        />
      )}

      {/* Beginning of images alert */}
      {showBeginningAlert && (
        <ErrorDialog
          title="Beginning of Images"
          message="You have reached the beginning of the images in this folder."
          onClose={() => setShowBeginningAlert(false)}
        />
      )}

      {/* Fullscreen delete confirmation */}
      {showFullscreenDeleteConfirm && (
        <ConfirmDialog
          message={`Are you sure you want to delete "${currentFullscreenImage.name}"?`}
          onConfirm={handleFullscreenDeleteConfirm}
          onCancel={handleFullscreenDeleteCancel}
        />
      )}

      {showDeleteConfirm && (
        <ConfirmDialog
          message={`Are you sure you want to delete "${entry.name}"?`}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}
    </div>
  );
}

export default ImageEntry;
