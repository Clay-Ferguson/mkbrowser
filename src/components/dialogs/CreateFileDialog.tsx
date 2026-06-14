import { generateTimestampFileName } from '../../utils/timeUtil';
import NameInputDialog from './common/NameInputDialog';

interface CreateFileDialogProps {
  defaultName?: string;
  onCreate: (fileName: string) => void;
  onCancel: () => void;
}

// Blank → timestamped name; ensure a `.md` extension when none was supplied.
const normalizeFileName = (raw: string): string => {
  const baseName = raw.trim() || generateTimestampFileName().replace(/\.md$/, '');
  return baseName.includes('.') ? baseName : `${baseName}.md`;
};

function CreateFileDialog({ defaultName = '', onCreate, onCancel }: CreateFileDialogProps) {
  return (
    <NameInputDialog
      title="Create new file"
      label="File name"
      placeholder="Leave blank for YYYY-MM-DD--HH-MM-SS.md"
      defaultName={defaultName}
      normalizeName={normalizeFileName}
      onCreate={onCreate}
      onCancel={onCancel}
      inputTestId="create-file-dialog-input"
      createTestId="create-file-dialog-create-button"
    />
  );
}

export default CreateFileDialog;
