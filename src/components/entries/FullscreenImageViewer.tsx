import { useState, useEffect } from 'react';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { api } from '../../renderer/api';
import { logger } from '../../shared/logUtil';
import { Z_MODAL } from '../../renderer/styles';
import type { FileEntry as FileEntryType } from '../../global';
import { setHighlightItem, setPendingScrollToFile, deleteItems, useAS, setItemSelected } from '../../store';
import ConfirmDialog from '../dialogs/ConfirmDialog';

/**
 * File-list context, supplied only when the viewer is opened from an image *file* entry.
 * It enables everything that needs a real entry in the current folder listing: Left/Right
 * navigation across the folder's images, selection, delete, EXIF, and jump-to-file.
 *
 * Images embedded in markdown omit it — there is nothing to navigate to and no file-list
 * entry to act on, so those open as a single image that can only be expanded or closed.
 */
interface BrowseContext {
  /** Absolute path of the image the viewer was opened from. */
  path: string;
  /** All images in the same folder, in list order — the navigation sequence. */
  allImages: FileEntryType[];
  /** Notify the parent that an image was deleted so it can refresh. */
  onDelete: () => void;
  /** Open the EXIF dialog for the given image (owned by the parent so it is shared with the expanded view). */
  onExifClick: (e: React.MouseEvent, imagePath: string, imageName: string) => void;
  exifLoading: boolean;
}

interface FullscreenImageViewerProps {
  /** Ready-to-render URL of the image (`local-file://…`, or an http(s)/data: URL from markdown). */
  src: string;
  /** Display name / alt text. In browse mode this is the fallback label while navigating. */
  name: string;
  /** Close the overlay (parent unmounts this component). */
  onClose: () => void;
  /** Omit for a standalone single-image viewer (see BrowseContext). */
  browse?: BrowseContext;
}

/**
 * Fullscreen image overlay with its own keyboard handling, navigation, and view
 * state (fitted vs. actual size). Mounted only while fullscreen is active, so its
 * internal state resets each time it is opened.
 *
 * Keyboard: Escape closes; with a `browse` context, Left/Right navigate, Delete
 * deletes, Space toggles selection, and J jumps to the image in the list.
 */
function FullscreenImageViewer(props: FullscreenImageViewerProps) {
  const { src, name, onClose, browse } = props;

  const [isActualSize, setIsActualSize] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Path of the image currently shown. Only meaningful in browse mode, where navigation
  // moves it through `allImages`; empty string in standalone mode (nothing to look up).
  const [currentPath, setCurrentPath] = useState(browse?.path ?? '');

  const currentItem = useAS(s => s.items.get(currentPath));
  const isSelected = currentItem?.isSelected ?? false;

  // Navigation sequence; undefined in standalone mode, which is what disables every
  // file-list shortcut below (arrows, Delete, Space, J) and leaves only Escape.
  const allImages = browse?.allImages;

  // The listener is re-attached whenever what it reads changes. Deliberately NOT the
  // "latest handler in a ref, attach once" pattern: that keeps whatever closure the ref
  // last received, so if the ref-updating effect is ever skipped the handler navigates
  // from a stale currentPath and the image appears frozen. Add/remove on document is
  // cheap, and correctness here is worth far more than skipping it.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Everything below acts on the file list, so it applies to browse mode only.
      if (!allImages || allImages.length === 0) return;

      const currentIndex = allImages.findIndex(img => img.path === currentPath);

      if (e.key === 'ArrowRight') {
        // Arrows would otherwise scroll the file list behind the overlay.
        e.preventDefault();
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % allImages.length;
        setCurrentPath(allImages[nextIndex]!.path);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevIndex = currentIndex <= 0 ? allImages.length - 1 : currentIndex - 1;
        setCurrentPath(allImages[prevIndex]!.path);
      } else if (e.key === 'Delete') {
        setShowDeleteConfirm(true);
      } else if (e.key === ' ') {
        e.preventDefault();
        setItemSelected(currentPath, !isSelected);
      } else if (e.key.toLowerCase() === 'j') {
        // Jump to the current fullscreen image - close fullscreen, scroll to it, and highlight it
        onClose();
        setHighlightItem(currentPath);
        setPendingScrollToFile(currentPath);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    // Returns the useEffect cleanup (an unsubscribe): removes the document 'keydown' listener on unmount.
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [allImages, currentPath, isSelected, onClose]);

  // In browse mode the displayed image follows `currentPath` (navigation); in standalone
  // mode it is always the src/name we were opened with.
  const currentName = browse ? (browse.allImages.find(img => img.path === currentPath)?.name ?? name) : name;
  const imageUrl = browse ? `local-file://${currentPath}` : src;

  const handleDeleteConfirm = () => {
    setShowDeleteConfirm(false);
    if (!browse) return;
    const allImages = browse.allImages;
    const currentIndex = allImages.findIndex(img => img.path === currentPath);
    const pathToDelete = currentPath;
    const onDelete = browse.onDelete;

    // Determine which image to show next
    let nextImagePath: string | null = null;
    if (allImages.length > 1) {
      if (currentIndex < allImages.length - 1) {
        // There's a next image, switch to it
        nextImagePath = allImages[currentIndex + 1]!.path;
      } else if (currentIndex > 0) {
        // No next image but there's a previous one
        nextImagePath = allImages[currentIndex - 1]!.path;
      }
    }

    void (async () => {
      try {
        const success = await api.deleteFile(pathToDelete);
        if (success) {
          // Remove the deleted item from the store so it no longer appears
          // as selected or referenced in memory
          deleteItems([pathToDelete]);
          if (nextImagePath) {
            setCurrentPath(nextImagePath);
          } else {
            // No more images, close fullscreen
            onClose();
          }
          onDelete();
        }
      } catch (error) {
        logger.error('[FullscreenImageViewer] Failed to delete image:', error);
      }
    })();
  };

  const sizeHint = isActualSize ? 'Click Image=Fitted' : 'Click Image=Actual Size';

  return (
    <>
      {/* Fullscreen overlay - use keyboard: Left/Right arrows to navigate, Delete to delete, Escape to close */}
      <div
        className={`fixed inset-0 ${Z_MODAL} bg-black/95`}
        onClick={onClose}
      >
        {/* Fixed UI controls — always on top regardless of scroll */}
        <span className="fixed top-2 left-2 text-white/60 text-xs z-10">
          {browse ? `ESC=Close, J=Jump to Image, Space=Select, ${sizeHint}` : `ESC=Close, ${sizeHint}`}
        </span>
        {browse ? (
          <label
            className="fixed top-7 left-2 flex items-center gap-2 cursor-pointer z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => setItemSelected(currentPath, e.target.checked)}
              className="h-5 w-5 accent-blue-500 flex-shrink-0"
              aria-label={`Select ${currentName}`}
              data-testid="fullscreen-image-select-checkbox"
            />
            <span className="text-white/70 text-sm">{currentName}</span>
          </label>
        ) : (
          <span className="fixed top-7 left-2 text-white/70 text-sm z-10">{currentName}</span>
        )}
        {browse && (
          <button
            type="button"
            onClick={(e) => browse.onExifClick(e, currentPath, currentName)}
            disabled={browse.exifLoading}
            className="fixed top-2 right-2 p-2 bg-black/50 hover:bg-black/70 text-white/70 hover:text-white rounded-full transition-colors z-10"
            title="View EXIF metadata"
            data-testid="fullscreen-image-exif-button"
          >
            <InformationCircleIcon className="w-6 h-6" />
          </button>
        )}

        {/* Image area */}
        {isActualSize ? (
          // Actual-size: overflow-auto on fixed container, image at natural pixel dimensions
          <div
            className="absolute inset-0 overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={imageUrl}
              alt={currentName}
              className="block w-auto h-auto max-w-none max-h-none cursor-zoom-out [image-rendering:pixelated]"
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
              alt={currentName}
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
          message={`Move "${currentName}" to trash?`}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}

export default FullscreenImageViewer;
