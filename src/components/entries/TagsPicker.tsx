import { useState, useEffect } from 'react';
import { useItem, getItemEditContent, setItemEditContent } from '../../store';
import { CHECKBOX_CLASSES } from '../../utils/styles';
import { loadTagsForFile, type TagsLoadState, type HashtagDefinition } from '../../utils/tagUtils';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

/**
 * Represents a single hashtag with its checked state.
 */
export interface TagData {
  tag: string;
  description: string;
  group?: string;
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

/**
 * Insert a hashtag at the position of the first existing hashtag in text.
 * If no hashtag exists, prepends the tag followed by a space.
 */
export function insertTagIntoText(text: string, tag: string): string {
  const match = /#[a-zA-Z0-9]/.exec(text);
  if (match !== null) {
    const i = match.index;
    return text.slice(0, i) + tag + ' ' + text.slice(i);
  }
  return tag + ' ' + text;
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

  // Async tag loading state
  const [loadState, setLoadState] = useState<TagsLoadState>({ status: 'loading' });

  // Panel open/closed state — persisted in app config
  const [panelOpen, setPanelOpen] = useState(false);

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

  // Load persisted panel state from config on mount
  useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      setPanelOpen(config.tagsPanelVisible ?? false);
    });
  }, []);

  const handleTogglePanel = async () => {
    const newOpen = !panelOpen;
    setPanelOpen(newOpen);
    const config = await window.electronAPI.getConfig();
    await window.electronAPI.saveConfig({ ...config, tagsPanelVisible: newOpen });
  };

  // While loading, show nothing (panel header will appear once tags are known)
  if (loadState.status === 'loading') {
    return null;
  }

  // If no tags found, render nothing
  if (loadState.tags.length === 0) {
    return null;
  }

  // Derive checked state from content on every render — no local state needed
  const tags: TagData[] = loadState.tags.map((def: HashtagDefinition) => ({
    tag: def.tag,
    description: def.description,
    group: def.group,
    checked: editContent.includes(def.tag),
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
      // Insert this tag if not already present
      if (!currentContent.includes(tag.tag)) {
        currentContent = insertTagIntoText(currentContent, tag.tag);
      }
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
    <div className="pt-2" style={{ fontFamily: MONO_FONT }}>
      {/* Collapsible panel header */}
      <div className="flex">
        <button
          onClick={handleTogglePanel}
          className="flex items-center gap-1 px-2 py-0.5 text-xs font-bold text-slate-400 uppercase hover:text-slate-200 transition-colors select-none"
        >
          {panelOpen
            ? <ChevronDownIcon className="w-3.5 h-3.5" />
            : <ChevronRightIcon className="w-3.5 h-3.5" />}
          Tags
        </button>
      </div>

      {/* Collapsible content */}
      {panelOpen && (
        <div className="flex flex-col gap-y-2 pt-1">
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
      )}
    </div>
  );
}
