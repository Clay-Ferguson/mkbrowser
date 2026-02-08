import { useState } from 'react';
import { useItem, getItemEditContent, setItemEditContent } from '../../store';

/**
 * Represents a single hashtag with its checked state.
 */
export interface TagData {
  tag: string;
  checked: boolean;
}

/** Default hardcoded tags for Phase 1/2 testing. */
const DEFAULT_TAGS: TagData[] = [
  { tag: '#abc', checked: false },
  { tag: '#def', checked: false },
  { tag: '#ghi', checked: false },
];

/**
 * Escape a string for use in a RegExp.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface TagsPickerProps {
  /** Full path of the file being edited */
  filePath: string;
}

/**
 * TagsPicker — renders a vertical list of hashtag checkboxes.
 * Displayed to the right of a MarkdownEntry when it is in edit mode.
 *
 * On mount, checks which hashtags already exist in the editor content
 * and pre-checks those boxes. Toggling a checkbox on appends the hashtag
 * to the end of the editor content; toggling off removes all occurrences.
 */
export default function TagsPicker({ filePath }: TagsPickerProps) {
  const item = useItem(filePath);
  const editContent = item?.editContent ?? '';

  // Initialize checked state from editor content on mount
  const [tags, setTags] = useState<TagData[]>(() =>
    DEFAULT_TAGS.map((t) => ({
      ...t,
      checked: editContent.includes(t.tag),
    }))
  );

  const handleToggle = (index: number) => {
    const tag = tags[index];
    const newChecked = !tag.checked;

    // Update checkbox state
    setTags((prev) =>
      prev.map((t, i) => (i === index ? { ...t, checked: newChecked } : t))
    );

    // Read the latest editor content synchronously (avoids render lag)
    const currentContent = getItemEditContent(filePath);

    if (newChecked) {
      // Append hashtag to end of content if not already present
      if (!currentContent.includes(tag.tag)) {
        const separator = currentContent.length > 0 && !currentContent.endsWith(' ') && !currentContent.endsWith('\n') ? ' ' : '';
        setItemEditContent(filePath, currentContent + separator + tag.tag);
      }
    } else {
      // Remove all occurrences of the hashtag and clean up whitespace
      const pattern = new RegExp(escapeRegExp(tag.tag), 'g');
      const cleaned = currentContent
        .replace(pattern, '')
        .replace(/  +/g, ' ')       // collapse multiple spaces
        .replace(/^ /gm, '')        // trim leading space per line
        .replace(/ $/gm, '')        // trim trailing space per line
        .replace(/\n{3,}/g, '\n\n') // collapse 3+ newlines to 2
        .trim();
      setItemEditContent(filePath, cleaned);
    }
  };

  return (
    <div className="flex flex-col gap-1 pt-10 pr-1 min-w-[80px]">
      {tags.map((t, i) => (
        <label
          key={t.tag}
          className="flex items-center gap-1.5 cursor-pointer select-none text-sm text-slate-300 hover:text-slate-100 transition-colors"
        >
          <input
            type="checkbox"
            checked={t.checked}
            onChange={() => handleToggle(i)}
            className="accent-blue-500 w-3.5 h-3.5 cursor-pointer"
          />
          <span className="whitespace-nowrap">{t.tag}</span>
        </label>
      ))}
    </div>
  );
}
