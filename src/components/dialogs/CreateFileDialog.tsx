import { useEffect, useRef, useState } from 'react';

interface CreateFileDialogProps {
  defaultName?: string;
  onCreate: (fileName: string) => void;
  onCancel: () => void;
}

function CreateFileDialog({ defaultName = '', onCreate, onCancel }: CreateFileDialogProps) {
  const [fileName, setFileName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const generateTimestampName = (): string => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const hours24 = now.getHours();
    const hours12 = hours24 % 12 || 12;
    const ampm = hours24 < 12 ? 'AM' : 'PM';
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}--${pad(hours12)}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${ampm}`;
  };

  const handleCreate = () => {
    const trimmedName = fileName.trim();
    const baseName = trimmedName || generateTimestampName();
    const normalizedName = baseName.includes('.') ? baseName : `${baseName}.md`;
    onCreate(normalizedName);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 w-full max-w-md mx-4 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-100 mb-3">Create new file</h2>
        <label className="block text-sm text-slate-400 mb-2">File name</label>
        <input
          ref={inputRef}
          type="text"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full bg-slate-900 text-slate-200 px-3 py-2 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-sm"
          placeholder="Leave blank for timestamp (YYYY-MM-DD--HH-MM-SS-AM/PM.md)"
        />
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateFileDialog;
