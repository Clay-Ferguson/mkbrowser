import { useState, useEffect } from 'react';
import { useItem, getItemEditContent, setItemEditContent } from '../../store';
import { CHECKBOX_CLASSES } from '../../utils/styles';
import {
  loadTagsForFile, type TagsLoadState, type HashtagDefinition,
  tagName, splitFrontMatter, getTagsFromYaml,
  removeTagFromText, insertTagIntoText,
} from '../../utils/tagUtils';

/**
 * Represents a single hashtag with its checked state.
 */
export interface TagData {
  tag: string;
  description: string;
  group?: string;
  checked: boolean;
}

export { removeTagFromText, insertTagIntoText };

interface TagsPickerProps { 
  /** Full path of the file being edited */
  filePath: string;
}

/**
 * TagsPicker — renders a horizontal wrapping list of hashtag checkboxes.
 * Displayed beneath a MarkdownEntry when it is in edit mode.
 *
 * Tags are loaded asynchronously by walking up ancestor directories and
 * collecting hashtags from `.TAGS.yaml` files. While loading, a spinner is shown.
 * If no `.TAGS.yaml` files are found (or they contain no tags), nothing is rendered.
 *
 * Checked state is derived directly from the editor content on every render,
 * so checkboxes stay perfectly in sync whether the user types in the editor
 * or clicks a checkbox. Toggling a checkbox on appends the hashtag to the
 * end of the editor content; toggling off removes all occurrences.
 */
export default function TagsPicker({ filePath }: TagsPickerProps) {
  const item = useItem(filePath);
  const editContent = item?.editContent ?? '';

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

  if (loadState.status === 'loading') {
    return null;
  }

  if (loadState.tags.length === 0) {
    return null;
  }

  // Derive checked state from front matter on every render — no local state needed
  const fmParts = splitFrontMatter(editContent);
  const activeTags = fmParts ? getTagsFromYaml(fmParts.yamlStr) : [];
  const tags: TagData[] = loadState.tags.map((def: HashtagDefinition) => ({
    tag: def.tag,
    description: def.description,
    group: def.group,
    checked: activeTags.includes(tagName(def.tag)),
  }));

  const handleToggle = (index: number) => {
    const tag = tags[index];
    const newChecked = !tag.checked;

    // Read the latest editor content synchronously (avoids render lag)
    let currentContent = getItemEditContent(filePath);

    if (newChecked) {
      // Radio-button behaviour: when enabling a grouped tag, remove all other
      // checked tags in the same group first so only one can be active at a time.
      if (tag.group) {
        for (const sibling of tags) {
          if (sibling.group === tag.group && sibling.tag !== tag.tag && sibling.checked) {
            currentContent = removeTagFromText(currentContent, sibling.tag);
          }
        }
      }
      currentContent = insertTagIntoText(currentContent, tag.tag);
      setItemEditContent(filePath, currentContent);
    } else {
      setItemEditContent(filePath, removeTagFromText(currentContent, tag.tag));
    }
  };

  const MONO_FONT = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

  // Partition tags into groups (sorted alphabetically) and ungrouped
  const groupMap = new Map<string, TagData[]>();
  const ungrouped: TagData[] = [];
  for (const t of tags) {
    if (t.group) {
      let arr = groupMap.get(t.group);
      if (!arr) { arr = []; groupMap.set(t.group, arr); }
      arr.push(t);
    } else {
      ungrouped.push(t);
    }
  }
  const sortedGroupNames = Array.from(groupMap.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  const renderTag = (t: TagData) => (
    <label
      key={t.tag}
      title={t.description.trim()}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer select-none text-sm transition-colors ${
        t.checked
          ? 'bg-blue-600/50 text-blue-100 border border-slate-400/60'
          : 'text-slate-300 hover:text-slate-100 border border-transparent'
      }`}
    >
      <input
        type="checkbox"
        checked={t.checked}
        onChange={() => handleToggle(tags.indexOf(t))}
        className={`${CHECKBOX_CLASSES} cursor-pointer`}
      />
      <span className="whitespace-nowrap">{t.tag}</span>
    </label>
  );

  return (
    <div className="pb-3" style={{ fontFamily: MONO_FONT }}>
      <div className="flex flex-col gap-y-2">
        {sortedGroupNames.map((groupName) => (
          <div key={groupName} className="flex items-start gap-2">
            <span className="min-w-[4rem] text-xs font-bold text-slate-400 uppercase pt-1.5 shrink-0">
              {groupName}
            </span>
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              {groupMap.get(groupName)!.map(renderTag)}
            </div>
          </div>
        ))}
        {ungrouped.length > 0 && (
          <div className="flex items-start gap-2">
            <span className="min-w-[4rem] text-xs font-bold text-slate-400 uppercase pt-1.5 shrink-0">
              tags
            </span>
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              {ungrouped.map(renderTag)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
