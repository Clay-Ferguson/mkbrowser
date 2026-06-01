import React from 'react';
import { CHECKBOX_FIELD_CLASS } from '../../../utils/styles';

interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Optional helper text rendered as a <p> below the label. */
  description?: React.ReactNode;
  testId?: string;
  /** Override the <input> class string (e.g. a different accent color). */
  inputClassName?: string;
  /** Override the label text <span> class string. */
  spanClassName?: string;
  /** Extra classes appended to the <label> wrapper (e.g. margins). */
  className?: string;
  /** Override the description <p> class string. */
  descriptionClassName?: string;
}

/**
 * A single dialog checkbox: a label wrapping the <input> and its text, with an
 * optional helper description. When disabled the label dims (opacity-50) and
 * loses its pointer cursor, matching the inline markup these replaced.
 */
const CheckboxField: React.FC<CheckboxFieldProps> = ({
  label,
  checked,
  onChange,
  disabled,
  description,
  testId,
  inputClassName = CHECKBOX_FIELD_CLASS,
  spanClassName = 'text-sm text-slate-300',
  className = '',
  descriptionClassName = 'text-xs text-slate-500 mt-1 ml-6',
}) => (
  <>
    <label className={`flex items-center gap-2 ${disabled ? 'opacity-50' : 'cursor-pointer'} ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        data-testid={testId}
        className={inputClassName}
      />
      <span className={spanClassName}>{label}</span>
    </label>
    {description && <p className={descriptionClassName}>{description}</p>}
  </>
);

export default CheckboxField;
