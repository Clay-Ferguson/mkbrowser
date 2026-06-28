import { useState, useRef } from 'react';
import { clsx } from 'clsx';
import { PhotoIcon, InformationCircleIcon, MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon } from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import { logger } from '../../shared/logUtil';
import type { FileEntry as FileEntryType } from '../../global';
import type { ExifData } from '../../shared/shared';
import { useImageSize, setImageSizeTransitioning, setImageSizeWithTransition } from '../../store';
import ExifDialog from '../dialogs/ExifDialog';
import FullscreenImageViewer from './FullscreenImageViewer';
import {
  useEntry,
  useToggleExpanded,
  EntryActionBar,
  EntryShell,
  type BaseEntryProps,
} from './common';

interface ImageEntryProps extends BaseEntryProps {
  allImages: FileEntryType[];
  isAttachment?: boolean;
}

function ImageEntry(props: ImageEntryProps) {
  const { entry, allImages, onDelete, onSaveSettings, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, isAttachment = false } = props;
  // logger.log('[ImageEntry] Rendering entry:', entry.name, 'path:', entry.path);

  const { core, rename, del } = useEntry(props, { defaultExpanded: true });
  const { isRenaming, isExpanded, isSelected, isHighlighted, isBookmarked } = core;

  // Image size from global store (shared across all ImageEntry instances)
  const imageSize = useImageSize();

  // Ref to this entry's expanded image, used to re-center it after a size toggle.
  const imgRef = useRef<HTMLImageElement>(null);

  const handleToggleImageSize = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newSize = imageSize === 'small' ? 'large' : 'small';

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
        imgRef.current?.scrollIntoView({ behavior: 'instant', block: 'center' });
        setImageSizeTransitioning(false);
      });
    });

    // Persist the choice independently — it must not gate the animation timing.
    api.updateConfig({ imageSize: newSize }).catch((err) => {
      logger.error('[ImageEntry] Failed to persist image size:', err);
    });
  };

  // Fullscreen state — the overlay itself (navigation, view state, keyboard handling)
  // lives in FullscreenImageViewer, mounted only while open.
  const [isFullscreen, setIsFullscreen] = useState(false);

  // EXIF state, shared between the expanded image and the fullscreen overlay.
  const [showExifDialog, setShowExifDialog] = useState(false);
  const [exifData, setExifData] = useState<ExifData | null>(null);
  const [exifLoading, setExifLoading] = useState(false);
  const [exifFileName, setExifFileName] = useState(entry.name);
  const [exifFilePath, setExifFilePath] = useState(entry.path);

  const handleToggleExpanded = useToggleExpanded(entry.path);

  const handleExifClick = async (e: React.MouseEvent, imagePath: string, imageName: string) => {
    e.stopPropagation();
    setExifLoading(true);
    setExifFileName(imageName);
    setExifFilePath(imagePath);
    try {
      const data = await api.readExif(imagePath);
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
    <>
      <EntryShell
        entry={entry}
        icon={<PhotoIcon className="w-5 h-5 text-green-500" />}
        isAttachment={isAttachment}
        isHighlighted={isHighlighted}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isRenaming={isRenaming}
        rename={rename}
        del={del}
        onToggleExpanded={handleToggleExpanded}
        nameClassName="text-green-400 truncate flex-1 cursor-pointer no-underline"
        nameTitle={isExpanded ? 'Collapse image' : 'Expand image'}
        headerRight={
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
        }
      >
        {/* Expanded image content */}
        <div className="px-4 pb-4">
          <div className="bg-slate-900 rounded-lg p-4 flex items-center justify-center">
            <div className="relative inline-block">
              <img
                ref={imgRef}
                src={imageUrl}
                alt={entry.name}
                className={clsx(
                  'max-w-full object-contain rounded cursor-pointer hover:opacity-90 transition-opacity',
                  imageSize === 'large' ? 'max-h-[48rem]' : 'max-h-96',
                )}
                loading="lazy"
                onClick={() => setIsFullscreen(true)}
                title="Click to view fullscreen"
                // onLoad={() => {logger.log('[ImageEntry] Image loaded successfully:', imageUrl)}}
                onError={(e) => logger.error('[ImageEntry] Image failed to load:', imageUrl, 'Error:', e)}
              />
              <button
                type="button"
                onClick={handleToggleImageSize}
                className="absolute top-2 right-9 p-1 bg-black/50 hover:bg-black/70 text-white/70 hover:text-white rounded-full transition-colors"
                title={imageSize === 'small' ? 'Switch to large image size' : 'Switch to small image size'}
              >
                {imageSize === 'small' ? <MagnifyingGlassPlusIcon className="w-5 h-5" /> : <MagnifyingGlassMinusIcon className="w-5 h-5" />}
              </button>
              <button
                type="button"
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
      </EntryShell>

      {isFullscreen && (
        <FullscreenImageViewer
          entry={entry}
          allImages={allImages}
          onClose={() => setIsFullscreen(false)}
          onDelete={onDelete}
          onExifClick={handleExifClick}
          exifLoading={exifLoading}
        />
      )}

      {showExifDialog && exifData && (
        <ExifDialog
          data={exifData}
          fileName={exifFileName}
          filePath={exifFilePath}
          onClose={() => { setShowExifDialog(false); setExifData(null); }}
        />
      )}
    </>
  );
}

export default ImageEntry;
