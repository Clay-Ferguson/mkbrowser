import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { FolderIcon } from '@heroicons/react/24/outline';
import { api } from '../../services/api';
import Dialog from './common/Dialog';
import CheckboxField from './common/CheckboxField';
import RadioField from './common/RadioField';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_LABEL_CLASS, DLG_FOOTER_CLASS, DLG_INPUT_CLASS, DLG_INPUT_CLASS_BASE } from '../../utils/styles';

export interface ExportOptions {
  outputFolder: string;
  /** Always carries a `.md` extension; the caller handles PDF conversion from it. */
  fileName: string;
  includeSubfolders: boolean;
  includeFilenames: boolean;
  includeDividers: boolean;
  exportToPdf: boolean;
}

interface ExportDialogProps {
  defaultFolder: string;
  defaultFileName: string;
  onExport: (options: ExportOptions) => void;
  onCancel: () => void;
}

function ExportDialog({ defaultFolder, defaultFileName, onExport, onCancel }: ExportDialogProps) {
  const [outputFolder, setOutputFolder] = useState(defaultFolder);
  const [fileName, setFileName] = useState(() => defaultFileName.replace(/\.[a-zA-Z0-9]+$/, ''));
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  const [includeFilenames, setIncludeFilenames] = useState(true);
  const [includeDividers, setIncludeDividers] = useState(true);
  const [outputFormat, setOutputFormat] = useState<'markdown' | 'pdf'>('markdown');
  const fileNameInputRef = useRef<HTMLInputElement>(null);

  const fileNameHasExtension = /\.[a-zA-Z0-9]+$/.test(fileName.trim());
  const isValid = outputFolder.trim() && fileName.trim() && !fileNameHasExtension;

  const handleSelectFolder = async () => {
    const folder = await api.selectExportFolder();
    if (folder) {
      setOutputFolder(folder);
    }
  };

  const handleExport = () => {
    const trimmedFolder = outputFolder.trim();
    const trimmedFileName = fileName.trim();
    if (!trimmedFolder || !trimmedFileName || fileNameHasExtension) return;

    onExport({
      outputFolder: trimmedFolder,
      // Always pass a .md filename — the caller handles PDF conversion from it
      fileName: `${trimmedFileName}.md`,
      includeSubfolders,
      includeFilenames,
      includeDividers,
      exportToPdf: outputFormat === 'pdf',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleExport();
  };

  return (
    <Dialog
      title="Export Folder Contents"
      onClose={onCancel}
      className="w-full max-w-lg"
      initialFocusRef={fileNameInputRef}
    >
      <form className="p-6" onSubmit={handleSubmit}>
        <p className="text-sm text-slate-400 mb-4">
          Export all markdown and text files from the current folder into a single concatenated markdown file.
        </p>

        {/* Output Folder */}
        <div className="mb-4">
          <label className={DLG_LABEL_CLASS}>Output Folder</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={outputFolder}
              onChange={(e) => setOutputFolder(e.target.value)}
              className={`${DLG_INPUT_CLASS} flex-1`}
              placeholder="/path/to/output/folder"
              data-testid="export-output-folder"
            />
            <button
              type="button"
              onClick={handleSelectFolder}
              className="px-3 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors cursor-pointer"
              title="Browse for folder"
              data-testid="export-browse-folder-button"
            >
              <FolderIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* File Name */}
        <div className="mb-4">
          <label className={DLG_LABEL_CLASS}>File Name</label>
          <input
            ref={fileNameInputRef}
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className={clsx(
              'w-full',
              DLG_INPUT_CLASS_BASE,
              fileNameHasExtension
                ? 'border-red-500 focus:border-red-400'
                : 'border-slate-600 focus:border-blue-500',
            )}
            placeholder="export"
            data-testid="export-file-name"
          />
          {fileNameHasExtension ? (
            <p className="text-xs text-red-400 mt-1">Do not include a file extension — it will be added automatically.</p>
          ) : (
            <p className="text-xs text-slate-500 mt-1">
              Do not include an extension. The file will be saved as <span className="text-slate-400">.{outputFormat === 'pdf' ? 'pdf' : 'md'}</span>.
            </p>
          )}
        </div>

        {/* Include Subfolders Checkbox */}
        <div className="mb-3">
          <CheckboxField
            label="Include Subfolders"
            checked={includeSubfolders}
            onChange={setIncludeSubfolders}
            testId="export-include-subfolders"
            description="When enabled, files from all subfolders will be included in the export."
          />
        </div>

        {/* Include Filenames Checkbox */}
        <div className="mb-3">
          <CheckboxField
            label="Include Filenames"
            checked={includeFilenames}
            onChange={setIncludeFilenames}
            testId="export-include-filenames"
            description={<>When enabled, each file&apos;s name will be shown before its content.</>}
          />
        </div>

        {/* Divider Lines Checkbox */}
        <div className="mb-3">
          <CheckboxField
            label="Divider Lines"
            checked={includeDividers}
            onChange={setIncludeDividers}
            testId="export-include-dividers"
            description={<>When enabled, a horizontal line will separate each file&apos;s content.</>}
          />
        </div>

        {/* Output Format Radio Group */}
        <div className="mb-6 border border-slate-600 rounded p-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Output Format</p>
          <div className="flex flex-row gap-6">
            <RadioField
              name="outputFormat"
              value="markdown"
              checked={outputFormat === 'markdown'}
              onChange={() => setOutputFormat('markdown')}
              label="Markdown"
              testId="export-format-markdown"
            />
            <RadioField
              name="outputFormat"
              value="pdf"
              checked={outputFormat === 'pdf'}
              onChange={() => setOutputFormat('pdf')}
              label="PDF"
              testId="export-format-pdf"
            />
          </div>
          {outputFormat === 'pdf' && (
            <p className="text-xs text-slate-500 mt-2">
              The markdown file will be converted to PDF using Pandoc.
              A terminal window will open showing the conversion progress.
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className={DLG_FOOTER_CLASS}>
          <button
            type="button"
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
            data-testid="export-cancel-button"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid}
            className={BUTTON_CLASS_DLG_BLUE}
            data-testid="export-submit-button"
          >
            Export
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default ExportDialog;
