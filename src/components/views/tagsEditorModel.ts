import type { TagCategory } from '../../shared/tagUtil';

/**
 * Pure model for the Tags Editor (TagsEditorView): converts the loaded hashtag
 * categories to an id-keyed editor model and back, and validates it before
 * save. Kept free of React so it can be unit tested.
 */

export interface EditorTag {
  id: string;
  name: string;
  description: string;
}

export interface EditorCategory {
  id: string;
  name: string;
  tags: EditorTag[];
}

// Stable per-row keys for the editor's local model; only need to be unique within a session.
function newId() { return crypto.randomUUID(); }

/** A new, empty tag row. */
export function newEditorTag(): EditorTag {
  return { id: newId(), name: '', description: '' };
}

/** A new, empty category row. */
export function newEditorCategory(): EditorCategory {
  return { id: newId(), name: '', tags: [] };
}

/**
 * Convert loaded tag data into the editor model: assign row ids and flatten
 * multi-line descriptions to single lines. Inverse of toTagCategories.
 */
export function fromLoaded(categories: TagCategory[]): EditorCategory[] {
  return categories.map((cat) => ({
    id: newId(),
    name: cat.name,
    tags: cat.tags.map((t) => ({
      id: newId(),
      name: t.tag,
      description: t.description.replace(/\n/g, ' ').trim(),
    })),
  }));
}

/**
 * Convert the editor model back to the persisted shape: trim each tag name and
 * drop the editor-only row ids. Inverse of fromLoaded.
 */
export function toTagCategories(editor: EditorCategory[]): TagCategory[] {
  return editor.map((cat) => ({
    name: cat.name,
    tags: cat.tags.map((t) => ({
      tag: t.name.trim(),
      description: t.description,
    })),
  }));
}

/**
 * Drop tag rows whose name and description are both blank (e.g. a tag the user
 * added but never filled in), so they're silently discarded on Save instead of
 * failing validation. A blank name with a description is kept and rejected by validate.
 */
export function dropBlankTags(cats: EditorCategory[]): EditorCategory[] {
  return cats.map((cat) => ({
    ...cat,
    tags: cat.tags.filter((t) => t.name.trim() !== '' || t.description.trim() !== ''),
  }));
}

/**
 * Returns the first validation problem as a user-facing message, or null when the
 * categories are valid: names must be non-empty and unique, both for categories
 * and for the tags within each category. Expects fully blank tags to have been
 * removed already (see dropBlankTags).
 */
export function validate(cats: EditorCategory[]): string | null {
  const catNames = cats.map((c) => c.name.trim());
  if (catNames.some((n) => n === '')) return 'Category names cannot be empty.';
  if (new Set(catNames).size !== catNames.length) return 'Category names must be unique.';
  for (const cat of cats) {
    const tagNames = cat.tags.map((t) => t.name.trim());
    if (tagNames.some((n) => n === '')) return `Tags in "${cat.name}" that have a description need a name.`;
    if (new Set(tagNames).size !== tagNames.length) return `Duplicate tag names in category "${cat.name}".`;
  }
  return null;
}
