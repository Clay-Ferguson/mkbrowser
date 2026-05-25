import { useEffect, useRef, useState } from 'react';
import DlgHeader from './common/DlgHeader';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE } from '../../utils/styles';

interface CreateFolderDialogProps {
  defaultName?: string;
  onCreate: (folderName: string) => void;
  onCancel: () => void;
}

function CreateFolderDialog({ defaultName = '', onCreate, onCancel }: CreateFolderDialogProps) {
  const [folderName, setFolderName] = useState(defaultName);
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
    const trimmedName = folderName.trim();
    const finalName = trimmedName || generateTimestampName();
    onCreate(finalName);
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
      <div className="bg-slate-800 rounded-lg border-2 border-slate-400 w-full max-w-md mx-4 shadow-xl overflow-hidden">
        <DlgHeader title="Create new folder" onClose={onCancel} />
        <div className="p-6">
        <label className="block text-sm text-slate-400 mb-2">Folder name</label>
        <input
          ref={inputRef}
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full bg-slate-900 text-slate-200 px-3 py-2 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-sm"
          placeholder="Leave blank for YYYY-MM-DD--HH-MM-SS"
        />
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className={BUTTON_CLASS_DLG_BLUE}
          >
            Create
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

export default CreateFolderDialog;
