import { useEffect, useId, useRef, useState } from 'react';
import { clsx } from 'clsx';

export interface ComboboxOption {
  value: string;
  label: string;
}

interface EditableComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (option: ComboboxOption) => void;
  options: ComboboxOption[];
  placeholder?: string;
  className?: string;
  /** Number of options visible before the dropdown starts scrolling. Defaults to 5. */
  maxVisibleItems?: number;
  'data-testid'?: string;
}

// Approximate rendered height of a single option row (px-3 py-2 + text-sm).
const OPTION_ROW_HEIGHT = 36;

/**
 * An editable combobox that combines a text input with a dropdown list.
 * Users can either type freely or select from existing options.
 */
function EditableCombobox({
  value,
  onChange,
  onSelect,
  options,
  placeholder,
  className = '',
  maxVisibleItems = 5,
  'data-testid': dataTestId,
}: EditableComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [showAllOptions, setShowAllOptions] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Stable id base for wiring the input's ARIA relationships to the listbox/options.
  const listboxId = useId();

  // Filter options based on current input value, unless showAllOptions is true
  const lowerValue = value.toLowerCase();
  const filteredOptions = showAllOptions
    ? options
    : options.filter((option) =>
        option.label.toLowerCase().includes(lowerValue)
      );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    // Returns the useEffect cleanup (an unsubscribe): removes the document 'mousedown' listener on unmount.
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll highlighted item into view. Keyed on the highlighted option's value (not just
  // the index) so a re-filter that leaves the index unchanged but swaps the underlying row
  // still re-scrolls the new row into the viewport.
  const highlightedValue =
    highlightedIndex >= 0 ? filteredOptions[highlightedIndex]?.value : undefined;
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const highlightedElement = listRef.current.children[highlightedIndex] as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, highlightedValue]);

  // Reset the highlight whenever the controlled value changes (including programmatic
  // parent updates like a clear/reset), so it can't keep pointing into a now-stale
  // filtered list. Local typing already clears it too, so this is idempotent there.
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setShowAllOptions(false); // Filter as user types
    setIsOpen(true);
    setHighlightedIndex(-1);
  };

  const handleInputFocus = () => {
    if (options.length > 0) {
      setShowAllOptions(true); // Show all options on focus
      setIsOpen(true);
    }
  };

  const handleOptionClick = (option: ComboboxOption) => {
    onSelect(option);
    setIsOpen(false);
    setHighlightedIndex(-1);
    setShowAllOptions(true); // Reset to show all for next open
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setIsOpen(true);
      return;
    }

    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filteredOptions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
          e.preventDefault();
          handleOptionClick(filteredOptions[highlightedIndex]!);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
      case 'Tab':
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  const toggleDropdown = () => {
    if (options.length > 0) {
      const willOpen = !isOpen;
      if (willOpen) {
        setShowAllOptions(true); // Show all options when opening via button
      }
      setIsOpen(willOpen);
      if (willOpen) {
        inputRef.current?.focus();
      }
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          data-testid={dataTestId}
          className="flex-1 bg-slate-900 text-slate-200 px-3 py-2 rounded-l border border-r-0 border-slate-600 focus:outline-none focus:border-blue-500 text-sm"
        />
        <button
          type="button"
          onClick={toggleDropdown}
          disabled={options.length === 0}
          className="px-2 bg-slate-900 border border-slate-600 rounded-r hover:bg-slate-800 focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          tabIndex={-1}
          aria-label="Toggle dropdown"
          data-testid="combobox-toggle-button"
        >
          <svg
            className={clsx('w-4 h-4 text-slate-400 transition-transform', isOpen && 'rotate-180')}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {isOpen && filteredOptions.length > 0 && (
        <ul
          ref={listRef}
          id={listboxId}
          className="absolute z-50 w-full mt-1 overflow-auto bg-slate-800 border border-slate-600 rounded shadow-lg"
          style={{ maxHeight: maxVisibleItems * OPTION_ROW_HEIGHT }}
          role="listbox"
        >
          {filteredOptions.map((option, index) => (
            <li
              key={option.value}
              id={`${listboxId}-option-${index}`}
              onClick={() => handleOptionClick(option)}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={clsx(
                'px-3 py-2 text-sm cursor-pointer',
                index === highlightedIndex
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-200 hover:bg-slate-700',
              )}
              role="option"
              aria-selected={index === highlightedIndex}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default EditableCombobox;
