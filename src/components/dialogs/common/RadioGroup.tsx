import RadioField from './RadioField';

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  testId?: string;
}

interface RadioGroupProps<T extends string> {
  legend: string;
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: RadioOption<T>[];
  /** Extra classes appended to the <fieldset> (e.g. bottom margin). */
  className?: string;
  /** Override the radio <input> class string (e.g. a different accent color). */
  inputClassName?: string;
}

/**
 * A bordered <fieldset>/<legend> group of horizontally laid-out radio options,
 * driven by an options array.
 */
function RadioGroup<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  className = '',
  inputClassName,
}: RadioGroupProps<T>) {
  return (
    <fieldset className={`border border-slate-600 rounded-md p-3 ${className}`}>
      <legend className="text-xs text-slate-400 px-2">{legend}</legend>
      <div className="flex items-center gap-6">
        {options.map((option) => (
          <RadioField
            key={option.value}
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            label={option.label}
            testId={option.testId}
            inputClassName={inputClassName}
          />
        ))}
      </div>
    </fieldset>
  );
}

export default RadioGroup;
