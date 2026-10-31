import { useRef, useState } from 'react';
import { FolderIcon } from '@heroicons/react/24/outline';
import { api } from '../../renderer/api';
import { logger } from '../../shared/logUtil';
import { joinPath } from '../../renderer/pathUtil';
import type { HtmlExportOptions } from '../../shared/shared';
import { EXPORTS_FOLDER_ERROR, isUnderExportsFolder } from '../../shared/shared';
import Dialog from './common/Dialog';
import ConfirmDialog from './ConfirmDialog';
import CheckboxField from './common/CheckboxField';
import { BUTTON_CLASS_DLG_BLUE, BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_NEUTRAL, DLG_FOOTER_CLASS, DLG_INPUT_CLASS, DLG_LABEL_CLASS } from '../../renderer/styles';

interface HtmlExportDialogProps {
  /** The folder being exported; the output folder is checked against it before anything else. */
  sourceFolder: string;
  /** Pre-filled output folder path (full path to the folder to create). */
  defaultOutputFolder: string;
  /** Name given to the new folder when one is picked with Browse. */
  defaultFolderName: string;
  onExport: (outputFolder: string, options: HtmlExportOptions) => void;
  onCancel: () => void;
}

/**
 * Configures "Export to Folder (HTML)": the full path of the folder to create
 * and whether each folder gets a generated index page, and whether object cards
 * are collapsible. Browse picks the parent folder; the new folder's name is
 * appended to it. Export first has the main process check the output folder: one
 * that is, contains, or lies inside the source (symlinks resolved) is refused with
 * an inline error and no overwrite warning ever appears. Only a folder that passes
 * and already exists gets the red warning before its contents are replaced. The
 * folder must lie below one named `exports`; that rule is also checked live as the
 * path is typed, disabling Export until it holds.
 * Returns the choice through onExport.
 *
 * See: (USER_GUIDE.md#export-to-folder-html)
 */
function HtmlExportDialog({ sourceFolder, defaultOutputFolder, defaultFolderName, onExport, onCancel }: HtmlExportDialogProps) {
  const [outputFolder, setOutputFolder] = useState(defaultOutputFolder);
  const [indexPages, setIndexPages] = useState(true);
  const [collapsibleObjects, setCollapsibleObjects] = useState(true);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const outputInputRef = useRef<HTMLInputElement>(null);

  const trimmedFolder = outputFolder.trim();
  const inExportsFolder = isUnderExportsFolder(trimmedFolder);
  // A server-side refusal wins; otherwise the live `exports` rule, once something is typed.
  const shownError = folderError ?? (trimmedFolder && !inExportsFolder ? EXPORTS_FOLDER_ERROR : null);

  const handleSelectFolder = () => {
    api.selectExportFolder()
      .then((folder) => {
        if (!folder) return;
        setOutputFolder(joinPath(folder, defaultFolderName));
        setFolderError(null);
      })
      .catch((err: unknown) => logger.error('Failed to select export folder:', err));
  };

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    if (!trimmedFolder || !inExportsFolder) return;
    api.checkHtmlExportTarget(sourceFolder, trimmedFolder)
      .then(({ error, exists }) => {
        if (error) setFolderError(error);
        else if (exists) setConfirmOverwrite(true);
        else onExport(trimmedFolder, { indexPages, collapsibleObjects, overwrite: false });
      })
      .catch((err: unknown) => logger.error('Failed to check the export folder:', err));
  };

  return (
    <>
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
                onChange={(e) => {
                  setOutputFolder(e.target.value);
                  setFolderError(null);
                }}
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
            {shownError ? (
              <p className="text-xs text-red-400 mt-1 whitespace-pre-line break-words" data-testid="export-html-folder-error">
                {shownError}
              </p>
            ) : (
              <p className="text-xs text-slate-500 mt-1">
                Must be inside a folder named <code>exports</code>. Created if missing; if it already exists, everything in it is replaced.
              </p>
            )}
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

          <div className="mb-6">
            <CheckboxField
              label="Collapsible Objects"
              checked={collapsibleObjects}
              onChange={setCollapsibleObjects}
              testId="export-html-collapsible-objects"
              description="Show each object as a collapsed section titled by its first property; click the title to show the other properties."
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
              disabled={!trimmedFolder || !inExportsFolder}
              className={BUTTON_CLASS_DLG_BLUE}
              data-testid="export-html-submit-button"
            >
              Export
            </button>
          </div>
        </form>
      </Dialog>

      {confirmOverwrite && (
        <ConfirmDialog
          title="Overwrite Folder?"
          danger
          message={`The output folder already exists:\n${trimmedFolder}\n\nEverything in it (all files and subfolders) will be permanently deleted before exporting. This cannot be undone.`}
          confirmLabel="Delete and Export"
          cancelLabel="Cancel"
          onConfirm={() => {
            setConfirmOverwrite(false);
            onExport(trimmedFolder, { indexPages, collapsibleObjects, overwrite: true });
          }}
          onCancel={() => setConfirmOverwrite(false)}
        />
      )}
    </>
  );
}

export default HtmlExportDialog;
