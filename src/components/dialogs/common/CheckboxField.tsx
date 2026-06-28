import { useId } from 'react';
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { CHECKBOX_FIELD_CLASS } from '../../../renderer/styles';

interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Optional helper text rendered as a <p> below the label. */
  description?: ReactNode;
  testId?: string;
  /** Override the <input> class string (e.g. a different accent color). */
  inputClassName?: string;
  /** Override the label text <span> class string (e.g. a lighter slate). */
  spanClassName?: string;
}

/**
 * A single dialog checkbox: a label wrapping the <input> and its text, with an
 * optional helper description. When disabled the label dims (opacity-50) and
 * loses its pointer cursor, matching the inline markup these replaced.
 *
 * The description is rendered as a sibling <p> (not inside the <label>, where it
 * would bloat the click target), so it's tied to the input via aria-describedby
 * for assistive tech.
 */
const CheckboxField = ({
  label,
  checked,
  onChange,
  disabled,
  description,
  testId,
  inputClassName = CHECKBOX_FIELD_CLASS,
  spanClassName = 'text-sm text-slate-300',
}: CheckboxFieldProps) => {
  const descriptionId = useId();
  return (
    <>
      <label className={clsx('flex items-center gap-2', disabled ? 'opacity-50' : 'cursor-pointer')}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          data-testid={testId}
          className={inputClassName}
          aria-describedby={description ? descriptionId : undefined}
        />
        <span className={spanClassName}>{label}</span>
      </label>
      {description && <p id={descriptionId} className="text-xs text-slate-500 mt-1 ml-6">{description}</p>}
    </>
  );
};

export default CheckboxField;
