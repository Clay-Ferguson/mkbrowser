import { useState } from 'react';
import { clsx } from 'clsx';
import { PhotoIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { api } from '../../renderer/api';
import { logger } from '../../shared/logUtil';
import type { FileEntry as FileEntryType } from '../../global';
import type { ExifData } from '../../shared/shared';
import { useAS } from '../../store';
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

/**
 * Entry component for image files. Expands inline to show a thumbnail at the current global
 * image size (small/large, persisted to config, toggled from the Edit menu). Clicking the image
 * opens a fullscreen overlay (FullscreenImageViewer). An overlaid button shows EXIF metadata;
 * its dialog state is shared with the fullscreen viewer so only one dialog instance exists.
 */
function ImageEntry(props: ImageEntryProps) {
  const { entry, allImages, onDelete, onSaveSettings, onMoveUp, onMoveDown, onMoveToTop, onMoveToBottom, isAttachment = false } = props;
  // logger.log('[ImageEntry] Rendering entry:', entry.name, 'path:', entry.path);

  const { core, rename, del } = useEntry(props, { defaultExpanded: true });
  const { isRenaming, isExpanded, isSelected, isHighlighted, isBookmarked } = core;

  // Image size from global store (shared across all ImageEntry instances)
  const imageSize = useAS(s => s.imageSize);

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

  /** Fetches EXIF metadata for the given image and opens the EXIF dialog. */
  const handleExifClick = (e: React.MouseEvent, imagePath: string, imageName: string) => {
    e.stopPropagation();
    setExifLoading(true);
    setExifFileName(imageName);
    setExifFilePath(imagePath);
    void api.readExif(imagePath)
      .then((data) => {
        setExifData(data);
        setShowExifDialog(true);
      })
      .catch((error: unknown) => {
        logger.error('[ImageEntry] Failed to read EXIF data:', error);
      })
      .finally(() => setExifLoading(false));
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
                data-inline-image=""
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
