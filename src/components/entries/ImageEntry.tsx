import { useState, useEffect } from 'react';
import { PhotoIcon, InformationCircleIcon, MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon } from '@heroicons/react/24/outline';
import { logger } from '../../utils/logUtil';
import type { FileEntry as FileEntryType } from '../../global';
import { buildEntryHeaderId } from '../../utils/entryDom';
import { makeEntryDragStartHandler } from '../../utils/dragAndDrop';
import { setHighlightItem, setPendingScrollToFile, toggleItemExpanded, deleteItems, useItem, setItemSelected, useHasIndexFile, useImageSize, setImageSizeTransitioning, setImageSizeWithTransition } from '../../store';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ErrorDialog from '../dialogs/ErrorDialog';
import ExifDialog from '../dialogs/ExifDialog';
import {
  useEntryCore,
  useRename,
  useDelete,
  EntryActionBar,
  RenameInput,
  SelectionCheckbox,
  type BaseEntryProps,
} from './common';
import { ENTRY_OUTER, ENTRY_HIGHLIGHTED, ENTRY_HEADER_ROW, ENTRY_HEADER_EXPANDED } from '../../utils/styles';

interface ImageEntryProps extends BaseEntryProps {
  allImages: FileEntryType[];
  isAttachment?: boolean;
}

function ImageEntry({ entry, allImages, onRename, onDelete, onSaveSettings, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, isAttachment = false }: ImageEntryProps) {
  // logger.log('[ImageEntry] Rendering entry:', entry.name, 'path:', entry.path);

  const {
    isRenaming,
    isExpanded,
    isSelected,
    isHighlighted,
    isBookmarked,
  } = useEntryCore({ path: entry.path, name: entry.name, defaultExpanded: true });

  const hasIndexFile = useHasIndexFile();

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

  // Image size from global store (shared across all ImageEntry instances)
  const imageSize = useImageSize();

  const handleToggleImageSize = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newSize = imageSize === 'small' ? 'large' : 'small';
    const thisImageUrl = imageUrl;

    // Phase 1: hide the view instantly (opacity 0) AND apply the new size in a
    // single render, so the larger images are laid out while invisible.
    setImageSizeWithTransition(newSize);

    // This rAF ensures that we can set the size option on our images 
    // which makes them all render at a different size, and have the page 
    // render (where all images may have changed size and therefore the 
    // scroll position has completely changed) in a way where the user sees
    // the screen update but the image they were previously looking at is still 
    // right at the center of the screen, even though the scrolling and positioning 
    // of everything will have completely changed.
    // 
    // After the new (larger) layout has painted at opacity 0, jump the
    // scroll to center the clicked image while it's still invisible, then drop
    // the transitioning flag to fade the view back in at the correct position.
    // Two rAFs guarantee the opacity:0 frame is painted first so the CSS
    // opacity transition actually fires (0 -> 1) instead of snapping.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const imgEl = document.querySelector(`img[src="${thisImageUrl}"]`);
        imgEl?.scrollIntoView({ behavior: 'instant', block: 'center' });
        setImageSizeTransitioning(false);
      });
    });

    // Persist the choice independently — it must not gate the animation timing.
    void window.electronAPI.updateConfig({ imageSize: newSize });
  };

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isActualSize, setIsActualSize] = useState(false);
  const [showFullscreenDeleteConfirm, setShowFullscreenDeleteConfirm] = useState(false);
  const [fullscreenImagePath, setFullscreenImagePath] = useState(entry.path);
  const [showEndAlert, setShowEndAlert] = useState(false);
  const [showBeginningAlert, setShowBeginningAlert] = useState(false);
  const [showExifDialog, setShowExifDialog] = useState(false);
  const [exifData, setExifData] = useState<Record<string, Record<string, string>> | null>(null);
  const [exifLoading, setExifLoading] = useState(false);
  const [exifFileName, setExifFileName] = useState(entry.name);

  // logger.log('[ImageEntry] State:', { isRenaming, isExpanded, isSelected });

  const fullscreenItem = useItem(fullscreenImagePath);
  const isFullscreenSelected = fullscreenItem?.isSelected ?? false;

  // Handle Escape key to close fullscreen overlay and arrow keys for navigation
  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
        setIsActualSize(false);
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
      } else if (e.key === ' ') {
        e.preventDefault();
        setItemSelected(fullscreenImagePath, !fullscreenItem?.isSelected);
      } else if (e.key.toLowerCase() === 'j') {
        // Jump to the current fullscreen image - close fullscreen, scroll to it, and highlight it
        const currentImage = allImages.find(img => img.path === fullscreenImagePath) || entry;
        setIsFullscreen(false);
        setIsActualSize(false);
        setFullscreenImagePath(entry.path); // Reset to this entry's image
        setHighlightItem(currentImage.path);
        setPendingScrollToFile(currentImage.path);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, entry.path, fullscreenImagePath, allImages, entry.name, fullscreenItem]);

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
      logger.error('[ImageEntry] Failed to delete image:', error);
    }
  };

  const handleFullscreenDeleteCancel = () => {
    setShowFullscreenDeleteConfirm(false);
  };

  const handleToggleExpanded = () => {
    toggleItemExpanded(entry.path);
  };

  const handleExifClick = async (e: React.MouseEvent, imagePath: string, imageName: string) => {
    e.stopPropagation();
    setExifLoading(true);
    setExifFileName(imageName);
    try {
      const data = await window.electronAPI.readExif(imagePath);
      setExifData(data);
      setShowExifDialog(true);
    } catch (error) {
      logger.error('[ImageEntry] Failed to read EXIF data:', error);
    } finally {
      setExifLoading(false);
    }
  };

  // Convert file path to local-file:// URL for the image src
  const imageUrl = `local-file://${entry.path}`;
  // logger.log('[ImageEntry] Image URL:', imageUrl);

  return (
    <div className={`${ENTRY_OUTER} ${isHighlighted ? ENTRY_HIGHLIGHTED : ''}`}>
      {/* Header row */}
      <div className={`${ENTRY_HEADER_ROW} ${isExpanded ? ENTRY_HEADER_EXPANDED : ''}`}>
        {!isAttachment && (
          <SelectionCheckbox
            path={entry.path}
            name={entry.name}
            isSelected={isSelected}
          />
        )}
        {/* Entry Icon */}
        <span
          className="flex-shrink-0 cursor-grab"
          draggable
          onDragStart={makeEntryDragStartHandler({ path: entry.path, name: entry.name, isDirectory: false })}
        >
          <PhotoIcon className="w-5 h-5 text-green-500" />
        </span>
        {isRenaming ? (
          <RenameInput
            ref={rename.inputRef}
            path={entry.path}
            name={entry.name}
            value={rename.newName}
            onChange={rename.setNewName}
            onKeyDown={rename.handleKeyDown}
            onBlur={rename.handleSave}
            disabled={rename.saving}
          />
        ) : (
          <span
            id={buildEntryHeaderId(entry.path)}
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
            isBookmarked={isBookmarked}
            deleting={del.deleting}
            onRenameClick={rename.handleRenameClick}
            onDeleteClick={del.handleDeleteClick}
            onSaveSettings={onSaveSettings}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onMoveToTop={onMoveToTop}
            onMoveToBottom={onMoveToBottom}
            className="-mr-1.5"
            isAttachment={isAttachment}
          />
        )}
      </div>

      {/* Expanded image content */}
      {isExpanded && (
        <div className="px-4 pb-4">
          <div className="bg-slate-900 rounded-lg p-4 flex items-center justify-center">
            <div className="relative inline-block">
              <img
                src={imageUrl}
                alt={entry.name}
                className={`max-w-full ${imageSize === 'large' ? 'max-h-[48rem]' : 'max-h-96'} object-contain rounded cursor-pointer hover:opacity-90 transition-opacity`}
                loading="lazy"
                onClick={() => setIsFullscreen(true)}
                title="Click to view fullscreen"
                // onLoad={() => {logger.log('[ImageEntry] Image loaded successfully:', imageUrl)}}
                onError={(e) => logger.error('[ImageEntry] Image failed to load:', imageUrl, 'Error:', e)}
              />
              <button
                onClick={handleToggleImageSize}
                className="absolute top-2 right-9 p-1 bg-black/50 hover:bg-black/70 text-white/70 hover:text-white rounded-full transition-colors"
                title={imageSize === 'small' ? 'Switch to large image size' : 'Switch to small image size'}
              >
                {imageSize === 'small' ? <MagnifyingGlassPlusIcon className="w-5 h-5" /> : <MagnifyingGlassMinusIcon className="w-5 h-5" />}
              </button>
              <button
                onClick={(e) => handleExifClick(e, entry.path, entry.name)}
                disabled={exifLoading}
                className="absolute top-2 right-2 p-1 bg-black/50 hover:bg-black/70 text-white/70 hover:text-white rounded-full transition-colors"
                title="View EXIF metadata"
              >
                <InformationCircleIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen overlay - use keyboard: Left/Right arrows to navigate, Delete to delete, Escape to close */}
      {isFullscreen && (
        <div
          className="fixed inset-0 z-[1000] bg-black/95"
          onClick={() => {
            setIsFullscreen(false);
            setIsActualSize(false);
            setFullscreenImagePath(entry.path);
          }}
        >
          {/* Fixed UI controls — always on top regardless of scroll */}
          <span className="fixed top-2 left-2 text-white/60 text-xs z-10">
            ESC=Close, J=Jump to Image, Space=Select{isActualSize ? ', Click Image=Fitted' : ', Click Image=Actual Size'}
          </span>
          <label
            className="fixed top-7 left-2 flex items-center gap-2 cursor-pointer z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isFullscreenSelected}
              onChange={(e) => setItemSelected(fullscreenImagePath, e.target.checked)}
              className="h-5 w-5 accent-blue-500 flex-shrink-0"
              aria-label={`Select ${currentFullscreenImage.name}`}
            />
            <span className="text-white/70 text-sm">{currentFullscreenImage.name}</span>
          </label>
          <button
            onClick={(e) => handleExifClick(e, fullscreenImagePath, currentFullscreenImage.name)}
            disabled={exifLoading}
            className="fixed top-2 right-2 p-2 bg-black/50 hover:bg-black/70 text-white/70 hover:text-white rounded-full transition-colors z-10"
            title="View EXIF metadata"
          >
            <InformationCircleIcon className="w-6 h-6" />
          </button>

          {/* Image area */}
          {isActualSize ? (
            // Actual-size: overflow-auto on fixed container, image at natural pixel dimensions
            <div
              style={{ position: 'absolute', inset: 0, overflow: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={fullscreenImageUrl}
                alt={currentFullscreenImage.name}
                style={{ display: 'block', width: 'auto', height: 'auto', maxWidth: 'none', maxHeight: 'none', imageRendering: 'pixelated', cursor: 'zoom-out' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsActualSize(false);
                }}
                title="Click for fitted view"
              />
            </div>
          ) : (
            // Fitted: centered, constrained to viewport
            <div className="w-full h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <img
                src={fullscreenImageUrl}
                alt={currentFullscreenImage.name}
                className="max-w-[95vw] max-h-[95vh] object-contain cursor-zoom-in"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsActualSize(true);
                }}
                title="Click for actual size"
              />
            </div>
          )}
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
          message={`Move "${currentFullscreenImage.name}" to trash?`}
          onConfirm={handleFullscreenDeleteConfirm}
          onCancel={handleFullscreenDeleteCancel}
        />
      )}

      {del.showDeleteConfirm && (
        <ConfirmDialog
          message={`Move "${entry.name}" to trash?`}
          onConfirm={del.handleDeleteConfirm}
          onCancel={del.handleDeleteCancel}
        />
      )}

      {showExifDialog && exifData && (
        <ExifDialog
          data={exifData}
          fileName={exifFileName}
          filePath={isFullscreen ? fullscreenImagePath : entry.path}
          onClose={() => { setShowExifDialog(false); setExifData(null); }}
        />
      )}
    </div>
  );
}

export default ImageEntry;
