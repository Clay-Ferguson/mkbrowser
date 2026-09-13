import type { FileEntry } from '../../global';
import FolderEntry from '../entries/FolderEntry';
import MarkdownEntry from '../entries/MarkdownEntry';
import GenericEntry from '../entries/GenericEntry';
import ImageEntry from '../entries/ImageEntry';
import TextEntry from '../entries/TextEntry';
import PDFEntry from '../entries/PDFEntry';
import { useAS } from '../../store';
import { isImageFile, isTextFile, isPdfFile } from '../../shared/fileTypes';
import { ATTACH_SUFFIX } from '../../shared/specialFiles';

interface AttachFolderContentsProps {
  entries: FileEntry[];
  level: number;
  onNavigate: (path: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onSaveSettings: () => void;
  onPasteIntoFolder?: (folderPath: string) => void;
}

/**
 * Recursively renders the contents of an attachment folder (a sibling folder
 * whose name ends with the ATTACH_SUFFIX convention). Entries are indented by
 * `level` so they visually nest under their parent markdown file. Directories
 * inside the attachment folder are rendered recursively; files are dispatched
 * to the appropriate entry component by type.
 *
 * Shared by both right-hand panes: BrowseView (under each file in the folder
 * listing) and BrowseFile (under the one file shown in single-file mode).
 */
function AttachFolderContents({ entries, level, onNavigate, onRename, onDelete, onSaveSettings, onPasteIntoFolder }: AttachFolderContentsProps) {
  const items = useAS(s => s.items);
  const visibleEntries = entries.filter((entry) => !items.get(entry.path)?.isCut);
  if (visibleEntries.length === 0) return null;
  const allImages = visibleEntries.filter(e => !e.isDirectory && isImageFile(e.name));

  return (
    <div style={{ paddingLeft: `${level * 32}px` }}>
      {visibleEntries.map(entry => (
        <div key={entry.path}>
          {entry.isDirectory ? (
            <>
              <FolderEntry entry={entry} onNavigate={onNavigate} onRename={onRename} onDelete={onDelete} onSaveSettings={onSaveSettings} onPasteIntoFolder={onPasteIntoFolder} isAttachFolder={entry.name.endsWith(ATTACH_SUFFIX)} />
              {entry.name.endsWith(ATTACH_SUFFIX) && entry.attachments && (
                <AttachFolderContents
                  entries={entry.attachments}
                  level={level + 1}
                  onNavigate={onNavigate}
                  onRename={onRename}
                  onDelete={onDelete}
                  onSaveSettings={onSaveSettings}
                  onPasteIntoFolder={onPasteIntoFolder}
                />
              )}
            </>
          ) : entry.isMarkdown ? (
            <MarkdownEntry entry={entry} view="browser" onRename={onRename} onDelete={onDelete} onSaveSettings={onSaveSettings} isAttachment={true} />
          ) : isImageFile(entry.name) ? (
            <ImageEntry entry={entry} allImages={allImages} onRename={onRename} onDelete={onDelete} onSaveSettings={onSaveSettings} isAttachment={true} />
          ) : isTextFile(entry.name) ? (
            <TextEntry entry={entry} onRename={onRename} onDelete={onDelete} onSaveSettings={onSaveSettings} isAttachment={true} />
          ) : isPdfFile(entry.name) ? (
            <PDFEntry entry={entry} onRename={onRename} onDelete={onDelete} onSaveSettings={onSaveSettings} isAttachment={true} />
          ) : (
            <GenericEntry entry={entry} onRename={onRename} onDelete={onDelete} onSaveSettings={onSaveSettings} isAttachment={true} />
          )}
        </div>
      ))}
    </div>
  );
}

export default AttachFolderContents;
