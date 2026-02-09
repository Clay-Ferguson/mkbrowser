import { useState, useEffect } from 'react';
import { useItem, getItemEditContent, setItemEditContent } from '../../store';
import { CHECKBOX_CLASSES } from '../../utils/styles';
import { loadTagsForFile, type TagsLoadState } from '../../utils/tagUtils';

/**
 * Represents a single hashtag with its checked state.
 */
export interface TagData {
  tag: string;
  checked: boolean; 
}

/**
 * Escape a string for use in a RegExp.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove all occurrences of a hashtag from text and clean up whitespace.
 */
export function removeTagFromText(text: string, tag: string): string {
  const pattern = new RegExp(escapeRegExp(tag), 'g');
  return text
    .replace(pattern, '')
    .replace(/  +/g, ' ')       // collapse multiple spaces
    .replace(/^ /gm, '')        // trim leading space per line
    .replace(/ $/gm, '')        // trim trailing space per line
    .replace(/\n{3,}/g, '\n\n') // collapse 3+ newlines to 2
    .trim();
}

interface TagsPickerProps {
  /** Full path of the file being edited */
  filePath: string;
}

/**
 * TagsPicker — renders a horizontal wrapping list of hashtag checkboxes.
 * Displayed beneath a MarkdownEntry when it is in edit mode.
 *
 * Tags are loaded asynchronously by walking up ancestor directories and
 * collecting hashtags from `.TAGS.md` files. While loading, a spinner is shown.
 * If no `.TAGS.md` files are found (or they contain no tags), nothing is rendered.
 *
 * Checked state is derived directly from the editor content on every render,
 * so checkboxes stay perfectly in sync whether the user types in the editor
 * or clicks a checkbox. Toggling a checkbox on appends the hashtag to the
 * end of the editor content; toggling off removes all occurrences.
 */
export default function TagsPicker({ filePath }: TagsPickerProps) {
  const item = useItem(filePath);
  const editContent = item?.editContent ?? '';

  // Async tag loading state
  const [loadState, setLoadState] = useState<TagsLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: 'loading' });

    loadTagsForFile(filePath).then((tags) => {
      if (!cancelled) {
        setLoadState({ status: 'loaded', tags });
      }
    });

    return () => { cancelled = true; };
  }, [filePath]);

  // While loading, show a small spinner
  if (loadState.status === 'loading') {
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2">
        <span className="text-xs text-slate-500 animate-pulse">Loading tags…</span>
      </div>
    );
  }

  // If no tags found, render nothing
  if (loadState.tags.length === 0) {
    return null;
  }

  // Derive checked state from content on every render — no local state needed
  const tags: TagData[] = loadState.tags.map((tag) => ({
    tag,
    checked: editContent.includes(tag),
  }));

  const handleToggle = (index: number) => {
    const tag = tags[index];
    const newChecked = !tag.checked;

    // Read the latest editor content synchronously (avoids render lag)
    const currentContent = getItemEditContent(filePath);

    if (newChecked) {
      // Append hashtag to end of content if not already present
      if (!currentContent.includes(tag.tag)) {
        const separator = currentContent.length > 0 && !currentContent.endsWith(' ') && !currentContent.endsWith('\n') ? ' ' : '';
        setItemEditContent(filePath, currentContent + separator + tag.tag);
      }
    } else {
      const cleaned = removeTagFromText(currentContent, tag.tag);
      setItemEditContent(filePath, cleaned);
    }
  };

  const MONO_FONT = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1 pt-2" style={{ fontFamily: MONO_FONT }}>
      {tags.map((t, i) => (
        <label
          key={t.tag}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer select-none text-sm transition-colors ${
            t.checked
              ? 'bg-blue-600/50 text-blue-100 border border-slate-400/60'
              : 'text-slate-300 hover:text-slate-100 border border-transparent'
          }`}
        >
          <input
            type="checkbox"
            checked={t.checked}
            onChange={() => handleToggle(i)}
            className={`${CHECKBOX_CLASSES} cursor-pointer`}
          />
          <span className="whitespace-nowrap">{t.tag}</span>
        </label>
      ))}
    </div>
  );
}
