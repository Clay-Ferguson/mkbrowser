import { Fragment, useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { useAS, getItemEditContent, setItemEditContent } from '../store';
import { MONO_FONT_STACK, TAG_PILL_BASE, TAG_PILL_SELECTED, TAG_PILL_UNSELECTED, TAG_PILL_HOVER } from '../renderer/styles';
import {
  type TagsLoadState, type TagCategory, type HashtagDefinition,
  getTagsFromYaml, isYamlParseable, isAllTagCategory,
  removeTagFromText, insertTagIntoText,
} from '../shared/tagUtil';
import { fetchTags } from '../renderer/tagApi';
import { splitFrontMatter } from '../shared/frontMatterUtil';
import AlertDialog from './dialogs/AlertDialog';
import { logger } from '../shared/logUtil';

interface TagsPickerProps {
  /** Full path of the file being edited */
  filePath: string;
}

/**
 * Displays all predefined hashtag categories and lets the user toggle tags on/off in
 * the front matter of the file being edited.
 *
 * Tag definitions are loaded once from the project's tag configuration. Within each
 * category, selecting a tag deselects any other active sibling (radio-button behaviour),
 * except in the special "all" category which allows multiple simultaneous selections.
 * The definitions are re-fetched whenever the Tags Editor saves (`tagsRevision`).
 * Returns null until the tag definitions are loaded or when no categories exist.
 */
export default function TagsPicker({ filePath }: TagsPickerProps) {
  const editContent = useAS(s => s.items.get(filePath)?.editContent ?? '');
  // Bumped when the Tags Editor saves, so the tag definitions are re-fetched.
  const tagsRevision = useAS(s => s.tagsRevision);

  const [loadState, setLoadState] = useState<TagsLoadState>({ status: 'loading' });
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // No setLoadState({ status: 'loading' }) here: the initial state is already
    // 'loading', and on a reload (tagsRevision bump) keeping the previous categories
    // on screen until the fresh ones arrive avoids a flash of the picker vanishing.

    fetchTags()
      .then((categories: TagCategory[]) => {
        if (!cancelled) {
          setLoadState({ status: 'loaded', categories });
        }
      })
      .catch((err) => {
        // A load failure (bad tags config, IPC error) is otherwise indistinguishable
        // from "no tags configured" since both render null — log so it's diagnosable.
        logger.error('Failed to load tag definitions:', err);
        if (!cancelled) setLoadState({ status: 'loaded', categories: [] });
      });

    // Returns the useEffect cleanup (an unsubscribe-style teardown): sets the cancelled flag so the pending fetchTags() promise can't set state after unmount.
    return () => { cancelled = true; };
  }, [tagsRevision]);

  if (loadState.status === 'loading') return null;
  if (loadState.categories.length === 0) return null;

  const fmParts = splitFrontMatter(editContent);
  const activeTags = fmParts ? getTagsFromYaml(fmParts.yamlStr) : [];

  // Toggle a tag in the file's front matter. For non-"all" categories, removes any
  // already-active sibling tag before inserting the new one.
  const handleToggle = (category: TagCategory, def: HashtagDefinition) => {
    let currentContent = getItemEditContent(filePath);
    // No edit content means the item is gone or no longer in edit mode
    // (undefined, not an empty document) — there is nothing to toggle tags in.
    if (currentContent === undefined) return;

    // Guard: if the file already has a front-matter block whose YAML js-yaml
    // can't parse (e.g. duplicate keys), editing tags would discard the rest of
    // it. Refuse and warn the user instead of silently corrupting the file.
    const parts = splitFrontMatter(currentContent);
    if (parts && !isYamlParseable(parts.yamlStr)) {
      setAlertMessage(
        "This file's front matter couldn't be parsed, so its tags can't be edited safely. " +
        'Please fix the YAML front matter (for example, remove any duplicate keys) and try again.',
      );
      return;
    }

    // Derive the active tags from the *live* buffer (currentContent), not the render-time
    // `activeTags`: the toggle decision and the edit below must be made against the same
    // content, or a buffer change between render and click (debounce flush, calendar save)
    // would add/remove the wrong tags.
    const currentActiveTags = parts ? getTagsFromYaml(parts.yamlStr) : [];
    const isChecked = currentActiveTags.includes(def.tag);

    if (!isChecked) {
      // Radio-button behaviour within the category: remove other checked tags first.
      // Exception: "all" category allows multiple selections.
      if (!isAllTagCategory(category.name)) {
        for (const sibling of category.tags) {
          if (sibling.tag !== def.tag && currentActiveTags.includes(sibling.tag)) {
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

  // Renders a single tag as a toggleable pill; checked state reflects whether the tag
  // is present in the file's current front matter. The real checkbox is kept (for
  // label-click toggling, keyboard focus/Space, and screen readers) but visually hidden
  // via sr-only — the pill's background/border alone shows the checked state.
  const renderTag = (category: TagCategory, def: HashtagDefinition) => {
    const checked = activeTags.includes(def.tag);
    return (
      <label
        key={def.tag}
        title={def.description}
        className={clsx(
          TAG_PILL_BASE,
          TAG_PILL_HOVER,
          'relative flex items-center cursor-pointer transition-colors',
          'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500',
          checked ? TAG_PILL_SELECTED : TAG_PILL_UNSELECTED,
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => handleToggle(category, def)}
          className="sr-only"
          data-testid={`tags-picker-checkbox-${def.tag}`}
        />
        <span>{def.tag}</span>
      </label>
    );
  };

  return (
    <div className="pb-3" style={{ fontFamily: MONO_FONT_STACK }}>
      {/* Two-column grid: the name column is as wide as the longest category name, so the
          first tag of every category lines up in one column. Each category contributes
          one cell to each column (a Fragment, not a wrapper row). */}
      <div className="grid grid-cols-[max-content_1fr] items-start gap-x-2 gap-y-2">
        {[...loadState.categories].sort((a, b) => a.name.localeCompare(b.name)).map((category) => (
          <Fragment key={category.name}>
            <span className="min-w-[4rem] text-left text-sm font-bold uppercase pt-0.5 text-amber-400">
              {category.name}:
            </span>
            <div className="flex flex-wrap gap-x-1.5 gap-y-1">
              {category.tags.map((def) => renderTag(category, def))}
            </div>
          </Fragment>
        ))}
      </div>
      {alertMessage && (
        <AlertDialog
          title="Cannot Edit Tags"
          message={alertMessage}
          onClose={() => setAlertMessage(null)}
        />
      )}
    </div>
  );
}
