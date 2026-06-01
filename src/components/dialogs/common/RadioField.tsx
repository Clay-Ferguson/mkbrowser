import React from 'react';
import { RADIO_FIELD_CLASS } from '../../../utils/styles';

interface RadioFieldProps {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  testId?: string;
  /** Override the <input> class string (e.g. a different accent color). */
  inputClassName?: string;
}

/** A single dialog radio button: a label wrapping the <input> and its text. */
const RadioField: React.FC<RadioFieldProps> = ({
  name,
  value,
  checked,
  onChange,
  label,
  testId,
  inputClassName = RADIO_FIELD_CLASS,
}) => (
  <label className="flex items-center gap-2 cursor-pointer">
    <input
      type="radio"
      name={name}
      value={value}
      checked={checked}
      onChange={onChange}
      data-testid={testId}
      className={inputClassName}
    />
    <span className="text-sm text-slate-300">{label}</span>
  </label>
);

export default RadioField;
