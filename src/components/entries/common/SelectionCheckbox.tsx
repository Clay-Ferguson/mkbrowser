import { setItemSelected } from '../../../store';
import { CHECKBOX_CLASSES } from '../../../utils/styles';

interface SelectionCheckboxProps {
  /** Full path of the entry */
  path: string;
  /** Entry name (for accessibility) */
  name: string;
  /** Whether the item is selected */
  isSelected: boolean;
  /** Handler for click events (to stop propagation on folders) */
  onClick?: (e: React.MouseEvent) => void;
}

/**
 * Reusable selection checkbox component.
 * Renders a checkbox that updates item selection state in the store.
 */
export function SelectionCheckbox({ path, name, isSelected, onClick }: SelectionCheckboxProps) {
  return (
    <input
      type="checkbox"
      checked={isSelected}
      onChange={(e) => setItemSelected(path, e.target.checked)}
      onClick={onClick}
      className={CHECKBOX_CLASSES}
      aria-label={`Select ${name}`}
    />
  );
}
