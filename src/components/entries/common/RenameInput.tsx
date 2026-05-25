import { forwardRef } from 'react';
import { buildEntryHeaderId } from '../../../utils/entryDom';

interface RenameInputProps {
  /** Full path of the entry (used for element ID) */
  path: string;
  /** Entry name (used for element ID fallback) */
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
    { path, name: _name, value, onChange, onKeyDown, onBlur, disabled = false, onClick, className = '' },
    ref
  ) {
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
        className={`flex-1 bg-slate-900 text-slate-200 px-2 py-1 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-sm ${className}`}
      />
    );
  }
);
