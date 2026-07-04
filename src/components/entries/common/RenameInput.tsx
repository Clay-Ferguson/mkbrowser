import type { Ref } from 'react';
import { buildEntryHeaderId } from '../../../renderer/entryDom';
import { RENAME_INPUT_CLASS } from '../../../renderer/styles';

interface RenameInputProps {
  /** Ref to the underlying input element (for focus/selection). */
  ref?: Ref<HTMLInputElement>;
  /** Full path of the entry (used for element ID) */
  path: string;
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
export function RenameInput({ ref, path, value, onChange, onKeyDown, onBlur, disabled = false, onClick, className = '' }: RenameInputProps) {
  return (
    <input
      ref={ref}
      type="text"
      id={buildEntryHeaderId(path)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onClick={onClick}
      disabled={disabled}
      className={`${RENAME_INPUT_CLASS} ${className}`}
    />
  );
}
