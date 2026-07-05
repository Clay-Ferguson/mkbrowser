import { generateTimestampFolderName } from '../../shared/timeUtil';
import NameInputDialog from './common/NameInputDialog';

interface CreateFolderDialogProps {
  defaultName?: string;
  onCreate: (folderName: string) => void;
  onCancel: () => void;
}

// Blank → timestamped folder name.
const normalizeFolderName = (raw: string): string => raw.trim() || generateTimestampFolderName();

/**
 * "Create new folder" dialog — a thin configuration of the shared NameInputDialog
 * that supplies the folder-specific labels and the `normalizeFolderName` rule above.
 */
function CreateFolderDialog({ defaultName = '', onCreate, onCancel }: CreateFolderDialogProps) {
  return (
    <NameInputDialog
      title="Create new folder"
      label="Folder name"
      placeholder={generateTimestampFolderName()}
      defaultName={defaultName}
      normalizeName={normalizeFolderName}
      onCreate={onCreate}
      onCancel={onCancel}
    />
  );
}

export default CreateFolderDialog;
