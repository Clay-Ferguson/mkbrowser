import { useEffect, useRef, useState } from 'react';

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
}

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
}: EditableComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Filter options based on current input value
  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(value.toLowerCase())
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
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const highlightedElement = listRef.current.children[highlightedIndex] as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setIsOpen(true);
    setHighlightedIndex(-1);
  };

  const handleInputFocus = () => {
    if (options.length > 0) {
      setIsOpen(true);
    }
  };

  const handleOptionClick = (option: ComboboxOption) => {
    onSelect(option);
    setIsOpen(false);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
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
          handleOptionClick(filteredOptions[highlightedIndex]);
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
      setIsOpen(!isOpen);
      if (!isOpen) {
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
          className="flex-1 bg-slate-900 text-slate-200 px-3 py-2 rounded-l border border-r-0 border-slate-600 focus:outline-none focus:border-blue-500 text-sm"
        />
        <button
          type="button"
          onClick={toggleDropdown}
          disabled={options.length === 0}
          className="px-2 bg-slate-900 border border-slate-600 rounded-r hover:bg-slate-800 focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          tabIndex={-1}
          aria-label="Toggle dropdown"
        >
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
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
          className="absolute z-50 w-full mt-1 max-h-48 overflow-auto bg-slate-800 border border-slate-600 rounded shadow-lg"
          role="listbox"
        >
          {filteredOptions.map((option, index) => (
            <li
              key={option.value}
              onClick={() => handleOptionClick(option)}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={`px-3 py-2 text-sm cursor-pointer ${
                index === highlightedIndex
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-200 hover:bg-slate-700'
              }`}
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
