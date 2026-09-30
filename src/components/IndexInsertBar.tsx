import { ClipboardDocumentIcon, DocumentPlusIcon, FolderPlusIcon } from '@heroicons/react/24/outline';
import { BUTTON_CLASS_TB_AMBER, BUTTON_CLASS_TB_BLUE, BUTTON_CLASS_TB_GREEN } from '../renderer/styles';

interface IndexInsertBarProps {
  onInsertFile: () => void;
  onInsertFolder: () => void;
  /** Pastes the cut items at this position; the paste button is shown only when set. */
  onPaste?: () => void;
}

/**
 * The insert-here buttons (file and folder, plus paste while items are cut) that
 * float in the right-hand gutter at a specific index position in the entry list.
 *
 * Uses a zero-height wrapper so the bar occupies no vertical space in the layout;
 * the buttons are positioned absolutely into the gutter column reserved by the
 * entry list's padding.
 */
function IndexInsertBar({ onInsertFile, onInsertFolder, onPaste }: IndexInsertBarProps) {
  return (
    <div className="relative h-0">
      <div className="absolute top-0 right-0 translate-x-full flex flex-row gap-1">
        <button
          type="button"
          data-testid="insert-file-here"
          onClick={onInsertFile}
          className={BUTTON_CLASS_TB_BLUE}
          title="Insert file here"
        >
          <DocumentPlusIcon className="w-5 h-5" />
        </button>
        <button
          type="button"
          data-testid="insert-folder-here"
          onClick={onInsertFolder}
          className={BUTTON_CLASS_TB_AMBER}
          title="Insert folder here"
        >
          <FolderPlusIcon className="w-5 h-5" />
        </button>
        {onPaste && (
          <button
            type="button"
            data-testid="paste-here"
            onClick={onPaste}
            className={BUTTON_CLASS_TB_GREEN}
            title="Paste items here"
          >
            <ClipboardDocumentIcon className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}

export default IndexInsertBar;
