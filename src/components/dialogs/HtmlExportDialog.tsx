import { useRef, useState } from 'react';
import { FolderIcon } from '@heroicons/react/24/outline';
import { api } from '../../renderer/api';
import { logger } from '../../shared/logUtil';
import { joinPath } from '../../renderer/pathUtil';
import type { HtmlExportOptions } from '../../shared/shared';
import Dialog from './common/Dialog';
import CheckboxField from './common/CheckboxField';
import { BUTTON_CLASS_DLG_BLUE, BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_NEUTRAL, DLG_FOOTER_CLASS, DLG_INPUT_CLASS, DLG_LABEL_CLASS } from '../../renderer/styles';

interface HtmlExportDialogProps {
  /** Pre-filled output folder path (full path to the folder to create). */
  defaultOutputFolder: string;
  /** Name given to the new folder when one is picked with Browse. */
  defaultFolderName: string;
  onExport: (outputFolder: string, options: HtmlExportOptions) => void;
  onCancel: () => void;
}

/**
 * Configures "Export to Folder (HTML)": the full path of the folder to create
 * (it must not exist yet — the export never overwrites) and whether each folder
 * gets a generated index page. Browse picks the parent folder; the new folder's
 * name is appended to it. Returns the choice through onExport.
 */
function HtmlExportDialog({ defaultOutputFolder, defaultFolderName, onExport, onCancel }: HtmlExportDialogProps) {
  const [outputFolder, setOutputFolder] = useState(defaultOutputFolder);
  const [indexPages, setIndexPages] = useState(true);
  const outputInputRef = useRef<HTMLInputElement>(null);

  const trimmedFolder = outputFolder.trim();

  const handleSelectFolder = () => {
    api.selectExportFolder()
      .then((folder) => {
        if (folder) setOutputFolder(joinPath(folder, defaultFolderName));
      })
      .catch((err: unknown) => logger.error('Failed to select export folder:', err));
  };

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    if (!trimmedFolder) return;
    onExport(trimmedFolder, { indexPages });
  };

  return (
    <Dialog
      title="Export to Folder (HTML)"
      onClose={onCancel}
      className="w-full max-w-lg"
      initialFocusRef={outputInputRef}
    >
      <form className="p-6" onSubmit={handleSubmit}>
        <p className="text-sm text-slate-400 mb-4">
          Create a copy of the current folder tree that can be browsed in a web browser. Markdown
          files are converted to HTML pages; all other files are copied as they are.
        </p>

        <div className="mb-4">
          <label className={DLG_LABEL_CLASS}>Output Folder</label>
          <div className="flex gap-2">
            <input
              ref={outputInputRef}
              type="text"
              value={outputFolder}
              onChange={(e) => setOutputFolder(e.target.value)}
              className={`${DLG_INPUT_CLASS} flex-1`}
              placeholder="/path/to/new/folder"
              data-testid="export-html-output-folder"
            />
            <button
              type="button"
              onClick={handleSelectFolder}
              className={BUTTON_CLASS_DLG_NEUTRAL}
              title="Browse for the parent folder"
              data-testid="export-html-browse-folder-button"
            >
              <FolderIcon className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            This folder will be created and must not already exist.
          </p>
        </div>

        <div className="mb-6">
          <CheckboxField
            label="Index Pages"
            checked={indexPages}
            onChange={setIndexPages}
            testId="export-html-index-pages"
            description="Add a navigation page (_index.html) to every folder, listing its subfolders and pages, plus a breadcrumb trail on every page."
          />
        </div>

        <div className={DLG_FOOTER_CLASS}>
          <button
            type="button"
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
            data-testid="export-html-cancel-button"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!trimmedFolder}
            className={BUTTON_CLASS_DLG_BLUE}
            data-testid="export-html-submit-button"
          >
            Export
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default HtmlExportDialog;
