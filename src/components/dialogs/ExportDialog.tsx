import { useEffect, useRef, useState } from 'react';
import { FolderIcon } from '@heroicons/react/24/outline';

interface ExportDialogProps {
  defaultFolder: string;
  defaultFileName: string;
  onExport: (outputFolder: string, fileName: string, includeSubfolders: boolean, includeFilenames: boolean, includeDividers: boolean, exportToPdf: boolean) => void;
  onCancel: () => void;
}

function ExportDialog({ defaultFolder, defaultFileName, onExport, onCancel }: ExportDialogProps) {
  const [outputFolder, setOutputFolder] = useState(defaultFolder);
  const [fileName, setFileName] = useState(defaultFileName);
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  const [includeFilenames, setIncludeFilenames] = useState(true);
  const [includeDividers, setIncludeDividers] = useState(true);
  const [exportToPdf, setExportToPdf] = useState(false);
  const fileNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fileNameInputRef.current?.focus();
    fileNameInputRef.current?.select();
  }, []);

  const handleSelectFolder = async () => {
    const folder = await window.electronAPI.selectExportFolder();
    if (folder) {
      setOutputFolder(folder);
    }
  };

  const handleExport = () => {
    const trimmedFolder = outputFolder.trim();
    const trimmedFileName = fileName.trim();
    if (!trimmedFolder || !trimmedFileName) return;
    
    // Strip any extension and add the appropriate one
    const baseFileName = trimmedFileName.replace(/\.(md|pdf)$/i, '');
    // Always use .md extension - the caller will handle PDF conversion
    const finalFileName = `${baseFileName}.md`;
    
    onExport(trimmedFolder, finalFileName, includeSubfolders, includeFilenames, includeDividers, exportToPdf);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleExport();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const isValid = outputFolder.trim() && fileName.trim();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 w-full max-w-lg mx-4 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-100 mb-4">Export Folder Contents</h2>
        
        <p className="text-sm text-slate-400 mb-4">
          Export all markdown and text files from the current folder into a single concatenated markdown file.
        </p>

        {/* Output Folder */}
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-2">Output Folder</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={outputFolder}
              onChange={(e) => setOutputFolder(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-slate-900 text-slate-200 px-3 py-2 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-sm"
              placeholder="/path/to/output/folder"
            />
            <button
              onClick={handleSelectFolder}
              className="px-3 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors"
              title="Browse for folder"
            >
              <FolderIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* File Name */}
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-2">File Name</label>
          <input
            ref={fileNameInputRef}
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-slate-900 text-slate-200 px-3 py-2 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-sm"
            placeholder="export.md"
          />
          <p className="text-xs text-slate-500 mt-1">
            {exportToPdf 
              ? 'The output file will have a .pdf extension.'
              : 'The output file will have a .md extension.'}
          </p>
        </div>

        {/* Include Subfolders Checkbox */}
        <div className="mb-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeSubfolders}
              onChange={(e) => setIncludeSubfolders(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-800"
            />
            <span className="text-sm text-slate-300">Include Subfolders</span>
          </label>
          <p className="text-xs text-slate-500 mt-1 ml-6">
            When enabled, files from all subfolders will be included in the export.
          </p>
        </div>

        {/* Include Filenames Checkbox */}
        <div className="mb-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeFilenames}
              onChange={(e) => setIncludeFilenames(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-800"
            />
            <span className="text-sm text-slate-300">Include Filenames</span>
          </label>
          <p className="text-xs text-slate-500 mt-1 ml-6">
            When enabled, each file&apos;s name will be shown before its content.
          </p>
        </div>

        {/* Divider Lines Checkbox */}
        <div className="mb-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeDividers}
              onChange={(e) => setIncludeDividers(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-800"
            />
            <span className="text-sm text-slate-300">Divider Lines</span>
          </label>
          <p className="text-xs text-slate-500 mt-1 ml-6">
            When enabled, a horizontal line will separate each file&apos;s content.
          </p>
        </div>

        {/* Export to PDF Checkbox */}
        <div className="mb-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={exportToPdf}
              onChange={(e) => setExportToPdf(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-800"
            />
            <span className="text-sm text-slate-300">Export to PDF</span>
          </label>
          <p className="text-xs text-slate-500 mt-1 ml-6">
            When enabled, the markdown file will be converted to PDF using Pandoc.
            A terminal window will open showing the conversion progress.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={!isValid}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed rounded transition-colors"
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExportDialog;
