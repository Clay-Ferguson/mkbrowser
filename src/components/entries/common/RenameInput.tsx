import { forwardRef } from 'react';
import { buildEntryHeaderId } from '../../../utils/entryDom';
import { RENAME_INPUT_CLASSES } from '../../../utils/styles';

interface RenameInputProps {
  /** Entry name (used for element ID) */
  name: string;
  /** Current value of the input */
  value: string;
  /** Handler for value changes */
  onChange: (value: string) => void;
  /** Handler for keyboard events */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Handler for blur events (typically saves) */
  onBlur: () => void;
  /** Whether the input is disabled (saving in progress) */
  disabled?: boolean;
  /** Handler for click events (to stop propagation on folders) */
  onClick?: (e: React.MouseEvent) => void;
  /** Extra className for the input */
  className?: string;
}

/**
 * Reusable rename input component.
 * Renders a text input with proper ID, keyboard handling, and styles.
 */
export const RenameInput = forwardRef<HTMLInputElement, RenameInputProps>(
  function RenameInput(
    { name, value, onChange, onKeyDown, onBlur, disabled = false, onClick, className = '' },
    ref
  ) {
    return (
      <input
        ref={ref}
        type="text"
        id={buildEntryHeaderId(name)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onClick={onClick}
        disabled={disabled}
        className={`${RENAME_INPUT_CLASSES} ${className}`}
      />
    );
  }
);
