import { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { useItem, getItemEditContent, setItemEditContent } from '../store';
import { CHECKBOX_CLASS, MONO_FONT_STACK } from '../utils/styles';
import {
  fetchTags, type TagsLoadState, type TagCategory, type HashtagDefinition,
  tagName, splitFrontMatter, getTagsFromYaml,
  removeTagFromText, insertTagIntoText,
} from '../utils/tagUtil';

interface TagsPickerProps {
  /** Full path of the file being edited */
  filePath: string;
}

export default function TagsPicker({ filePath }: TagsPickerProps) {
  const item = useItem(filePath);
  const editContent = item?.editContent ?? '';

  const [loadState, setLoadState] = useState<TagsLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    // No setLoadState({ status: 'loading' }) here: the initial state is already
    // 'loading' and this effect only runs once (empty deps), so resetting it would
    // be a redundant synchronous state update inside the effect.

    fetchTags()
      .then((categories: TagCategory[]) => {
        if (!cancelled) {
          setLoadState({ status: 'loaded', categories });
        }
      })
      .catch(() => {
        if (!cancelled) setLoadState({ status: 'loaded', categories: [] });
      });

    return () => { cancelled = true; };
  }, []);

  if (loadState.status === 'loading') return null;
  if (loadState.categories.length === 0) return null;

  const fmParts = splitFrontMatter(editContent);
  const activeTags = fmParts ? getTagsFromYaml(fmParts.yamlStr) : [];

  const handleToggle = (category: TagCategory, def: HashtagDefinition) => {
    let currentContent = getItemEditContent(filePath);
    const isChecked = activeTags.includes(tagName(def.tag));

    if (!isChecked) {
      // Radio-button behaviour within the category: remove other checked tags first.
      // Exception: "all" category allows multiple selections.
      if (category.name.toLowerCase() !== 'all') {
        for (const sibling of category.tags) {
          if (sibling.tag !== def.tag && activeTags.includes(tagName(sibling.tag))) {
            currentContent = removeTagFromText(currentContent, sibling.tag);
          }
        }
      }
      currentContent = insertTagIntoText(currentContent, def.tag);
    } else {
      currentContent = removeTagFromText(currentContent, def.tag);
    }
    setItemEditContent(filePath, currentContent);
  };

  const renderTag = (category: TagCategory, def: HashtagDefinition) => {
    const checked = activeTags.includes(tagName(def.tag));
    return (
      <label
        key={def.tag}
        title={def.description}
        className={clsx(
          'flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer select-none text-sm transition-colors',
          checked
            ? 'bg-blue-600/50 text-blue-100 border border-slate-400/60'
            : 'text-slate-300 hover:text-slate-100 border border-transparent',
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => handleToggle(category, def)}
          className={CHECKBOX_CLASS}
          data-testid={`tags-picker-checkbox-${def.tag.replace('#', '')}`}
        />
        <span className="whitespace-nowrap">{def.tag}</span>
      </label>
    );
  };

  return (
    <div className="pb-3" style={{ fontFamily: MONO_FONT_STACK }}>
      <div className="flex flex-col gap-y-2">
        {[...loadState.categories].sort((a, b) => a.name.localeCompare(b.name)).map((category) => (
          <div key={category.name} className="flex items-start gap-2">
            <span className="min-w-[4rem] text-xs font-bold text-slate-400 uppercase pt-1.5 shrink-0">
              {category.name}
            </span>
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              {category.tags.map((def) => renderTag(category, def))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
