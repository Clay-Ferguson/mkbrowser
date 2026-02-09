import { useState, useEffect } from 'react';
import { PhotoIcon } from '@heroicons/react/24/outline';
import type { FileEntry as FileEntryType } from '../../global';
import { buildEntryHeaderId } from '../../utils/entryDom';
import { setHighlightItem, setPendingScrollToFile, toggleItemExpanded, deleteItems } from '../../store';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ErrorDialog from '../dialogs/ErrorDialog';
import {
  useEntryCore,
  useRename,
  useDelete,
  EntryActionBar,
  RenameInput,
  SelectionCheckbox,
  type BaseEntryProps,
} from './common';

interface ImageEntryProps extends BaseEntryProps {
  allImages: FileEntryType[];
}

function ImageEntry({ entry, allImages, onRename, onDelete, onInsertFileBelow, onInsertFolderBelow, onSaveSettings }: ImageEntryProps) {
  console.log('[ImageEntry] Rendering entry:', entry.name, 'path:', entry.path);
  
  const {
    isRenaming,
    isExpanded,
    isSelected,
    isHighlighted,
    isBookmarked,
    showInsertIcons,
    nextOrdinalPrefix,
  } = useEntryCore({ path: entry.path, name: entry.name, defaultExpanded: true });

  const rename = useRename({
    path: entry.path,
    name: entry.name,
    isRenaming,
    onRename,
    onSaveSettings,
  });

  const del = useDelete({
    path: entry.path,
    onDelete,
  });

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenDeleteConfirm, setShowFullscreenDeleteConfirm] = useState(false);
  const [fullscreenImagePath, setFullscreenImagePath] = useState(entry.path);
  const [showEndAlert, setShowEndAlert] = useState(false);
  const [showBeginningAlert, setShowBeginningAlert] = useState(false);

  console.log('[ImageEntry] State:', { isRenaming, isExpanded, isSelected });

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
  }, [isFullscreen, entry.path, fullscreenImagePath, allImages, entry.name]);

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
        // Remove the deleted item from the store so it no longer appears
        // as selected or referenced in memory
        deleteItems([pathToDelete]);
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

  const handleToggleExpanded = () => {
    toggleItemExpanded(entry.path);
  };

  // Convert file path to local-file:// URL for the image src
  const imageUrl = `local-file://${entry.path}`;
  console.log('[ImageEntry] Image URL:', imageUrl);

  return (
    <div className={`bg-slate-800 rounded-lg border ${isHighlighted ? 'border-2 border-purple-500' : 'border-slate-700'} overflow-hidden`}>
      {/* Header row */}
      <div className="flex items-center gap-3 pl-4 pr-2 py-1">
        <SelectionCheckbox
          path={entry.path}
          name={entry.name}
          isSelected={isSelected}
        />
        {/* Image icon */}
        <PhotoIcon className="w-5 h-5 text-green-500 flex-shrink-0" />
        {isRenaming ? (
          <RenameInput
            ref={rename.inputRef}
            name={entry.name}
            value={rename.newName}
            onChange={rename.setNewName}
            onKeyDown={rename.handleKeyDown}
            onBlur={rename.handleSave}
            disabled={rename.saving}
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
          <EntryActionBar
            path={entry.path}
            showInsertIcons={showInsertIcons}
            nextOrdinalPrefix={nextOrdinalPrefix}
            isBookmarked={isBookmarked}
            deleting={del.deleting}
            onRenameClick={rename.handleRenameClick}
            onDeleteClick={del.handleDeleteClick}
            onInsertFileBelow={onInsertFileBelow}
            onInsertFolderBelow={onInsertFolderBelow}
            onSaveSettings={onSaveSettings}
            className="-mr-1.5"
          />
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

      {del.showDeleteConfirm && (
        <ConfirmDialog
          message={`Are you sure you want to delete "${entry.name}"?`}
          onConfirm={del.handleDeleteConfirm}
          onCancel={del.handleDeleteCancel}
        />
      )}
    </div>
  );
}

export default ImageEntry;
