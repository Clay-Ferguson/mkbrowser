import { useState, useEffect, useRef } from 'react';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import { logger } from '../../utils/logUtil';
import type { FileEntry as FileEntryType } from '../../global';
import { setHighlightItem, setPendingScrollToFile, deleteItems, useItem, setItemSelected } from '../../store';
import ConfirmDialog from '../dialogs/ConfirmDialog';

interface FullscreenImageViewerProps {
  /** The image this viewer was opened from — used as the initial and fallback image. */
  entry: FileEntryType;
  allImages: FileEntryType[];
  /** Close the overlay (parent unmounts this component). */
  onClose: () => void;
  /** Notify the parent that an image was deleted so it can refresh. */
  onDelete: () => void;
  /** Open the EXIF dialog for the given image (owned by the parent so it is shared with the expanded view). */
  onExifClick: (e: React.MouseEvent, imagePath: string, imageName: string) => void;
  exifLoading: boolean;
}

/**
 * Fullscreen image overlay with its own keyboard handling, navigation, and view
 * state (fitted vs. actual size). Mounted only while fullscreen is active, so its
 * internal state resets each time it is opened.
 *
 * Keyboard: Left/Right navigate, Delete deletes, Space toggles selection,
 * J jumps to the image in the list, Escape closes.
 */
function FullscreenImageViewer(props: FullscreenImageViewerProps) {
  const { entry, allImages, onClose, onDelete, onExifClick, exifLoading } = props;

  const [isActualSize, setIsActualSize] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [fullscreenImagePath, setFullscreenImagePath] = useState(entry.path);

  const fullscreenItem = useItem(fullscreenImagePath);
  const isSelected = fullscreenItem?.isSelected ?? false;

  // Keep the latest keydown handler in a ref so the document listener (below) can be
  // attached once for the lifetime of the overlay rather than re-added on every
  // selection toggle or navigation change, while still seeing the latest state.
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowRight') {
      if (allImages.length === 0) return;
      const currentIndex = allImages.findIndex(img => img.path === fullscreenImagePath);
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % allImages.length;
      setFullscreenImagePath(allImages[nextIndex].path);
    } else if (e.key === 'ArrowLeft') {
      if (allImages.length === 0) return;
      const currentIndex = allImages.findIndex(img => img.path === fullscreenImagePath);
      const prevIndex = currentIndex <= 0 ? allImages.length - 1 : currentIndex - 1;
      setFullscreenImagePath(allImages[prevIndex].path);
    } else if (e.key === 'Delete') {
      setShowDeleteConfirm(true);
    } else if (e.key === ' ') {
      e.preventDefault();
      setItemSelected(fullscreenImagePath, !fullscreenItem?.isSelected);
    } else if (e.key.toLowerCase() === 'j') {
      // Jump to the current fullscreen image - close fullscreen, scroll to it, and highlight it
      const currentImage = allImages.find(img => img.path === fullscreenImagePath) || entry;
      onClose();
      setHighlightItem(currentImage.path);
      setPendingScrollToFile(currentImage.path);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => handleKeyDownRef.current(e);
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const currentImage = allImages.find(img => img.path === fullscreenImagePath) || entry;
  const imageUrl = `local-file://${fullscreenImagePath}`;

  const handleDeleteConfirm = async () => {
    setShowDeleteConfirm(false);
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
      const success = await api.deleteFile(pathToDelete);
      if (success) {
        // Remove the deleted item from the store so it no longer appears
        // as selected or referenced in memory
        deleteItems([pathToDelete]);
        if (nextImagePath) {
          setFullscreenImagePath(nextImagePath);
        } else {
          // No more images, close fullscreen
          onClose();
        }
        onDelete();
      }
    } catch (error) {
      logger.error('[FullscreenImageViewer] Failed to delete image:', error);
    }
  };

  return (
    <>
      {/* Fullscreen overlay - use keyboard: Left/Right arrows to navigate, Delete to delete, Escape to close */}
      <div
        className="fixed inset-0 z-[1000] bg-black/95"
        onClick={onClose}
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
            checked={isSelected}
            onChange={(e) => setItemSelected(fullscreenImagePath, e.target.checked)}
            className="h-5 w-5 accent-blue-500 flex-shrink-0"
            aria-label={`Select ${currentImage.name}`}
          />
          <span className="text-white/70 text-sm">{currentImage.name}</span>
        </label>
        <button
          onClick={(e) => onExifClick(e, fullscreenImagePath, currentImage.name)}
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
              src={imageUrl}
              alt={currentImage.name}
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
              src={imageUrl}
              alt={currentImage.name}
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

      {/* Fullscreen delete confirmation */}
      {showDeleteConfirm && (
        <ConfirmDialog
          message={`Move "${currentImage.name}" to trash?`}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}

export default FullscreenImageViewer;
