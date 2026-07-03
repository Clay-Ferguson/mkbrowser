import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { clsx } from 'clsx';
import { api } from '../../renderer/api';
import { serializeTagsToYaml } from '../../shared/tagUtil';
import type { TagCategory, HashtagDefinition } from '../../shared/tagUtil';
import { fetchTags } from '../../renderer/tagApi';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_BLUE, DLG_INPUT_CLASS_ALT_COMPACT } from '../../renderer/styles';

interface EditorTag {
  id: string;
  name: string;
  description: string;
}

interface EditorCategory {
  id: string;
  name: string;
  tags: EditorTag[];
}

interface TagsEditorDialogProps {
  onClose: () => void;
}

// Stable per-row keys for the editor's local model. crypto.randomUUID avoids
// the footgun of a module-level counter that keeps climbing across mounts and
// isn't test-friendly; these IDs only need to be unique within a session.
function newId() { return crypto.randomUUID(); }

// Convert loaded tag data into the editor's local model: assign stable row ids,
// drop the leading '#' from tag names (the UI shows it separately), and flatten
// multi-line descriptions to single lines. Inverse of toTagCategories.
function fromLoaded(categories: TagCategory[]): EditorCategory[] {
  return categories.map((cat) => ({
    id: newId(),
    name: cat.name,
    tags: cat.tags.map((t: HashtagDefinition) => ({
      id: newId(),
      name: t.tag.startsWith('#') ? t.tag.slice(1) : t.tag,
      description: t.description.replace(/\n/g, ' ').trim(),
    })),
  }));
}

// Convert the editor model back to the persisted shape: re-add the '#' prefix to
// each tag name and drop the editor-only row ids. Inverse of fromLoaded.
function toTagCategories(editor: EditorCategory[]): TagCategory[] {
  return editor.map((cat) => ({
    name: cat.name,
    tags: cat.tags.map((t) => ({
      tag: `#${t.name.trim()}`,
      description: t.description,
    })),
  }));
}

// Returns the first validation problem as a user-facing message, or null when the
// categories are valid: names must be non-empty and unique, both for categories
// and for the tags within each category.
function validate(cats: EditorCategory[]): string | null {
  const catNames = cats.map((c) => c.name.trim());
  if (catNames.some((n) => n === '')) return 'Category names cannot be empty.';
  if (new Set(catNames).size !== catNames.length) return 'Category names must be unique.';
  for (const cat of cats) {
    const tagNames = cat.tags.map((t) => t.name.trim());
    if (tagNames.some((n) => n === '')) return `Tag names in "${cat.name}" cannot be empty.`;
    if (new Set(tagNames).size !== tagNames.length) return `Duplicate tag names in category "${cat.name}".`;
  }
  return null;
}

/**
 * Two-pane editor for the hashtag taxonomy: a category list on the left and the
 * tags within the selected category on the right. Tags are loaded via fetchTags
 * into a local, id-keyed model (see fromLoaded) so categories and tags can be
 * added, renamed, edited, and removed without touching disk until Save. A
 * category can only be deleted once empty. Save validates (see validate),
 * serializes back to YAML, and persists via `api.saveTags`; load/save failures
 * are shown inline in the footer.
 */
export default function TagsEditorDialog({ onClose }: TagsEditorDialogProps) {
  const [categories, setCategories] = useState<EditorCategory[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [renamingCatId, setRenamingCatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchTags()
      .then((cats) => {
        const editor = fromLoaded(cats);
        setCategories(editor);
        if (editor.length > 0) setSelectedCatId([...editor].sort((a, b) => a.name.localeCompare(b.name))[0].id);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setSaveError(err instanceof Error ? err.message : 'Failed to load tags');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (renamingCatId) renameInputRef.current?.focus();
  }, [renamingCatId]);

  const selectedCat = categories.find((c) => c.id === selectedCatId) ?? null;
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );

  // --- Category operations ---

  const startRename = useCallback((cat: EditorCategory) => {
    setRenamingCatId(cat.id);
    setRenameValue(cat.name);
  }, []);

  const commitRename = useCallback(() => {
    if (!renamingCatId) return;
    setCategories((prev) =>
      prev.map((c) => c.id === renamingCatId ? { ...c, name: renameValue } : c)
    );
    setRenamingCatId(null);
  }, [renamingCatId, renameValue]);

  const cancelRename = useCallback(() => {
    setRenamingCatId(null);
  }, []);

  const addCategory = useCallback(() => {
    const newCat: EditorCategory = { id: newId(), name: '', tags: [] };
    setCategories((prev) => [...prev, newCat]);
    setSelectedCatId(newCat.id);
    setRenamingCatId(newCat.id);
    setRenameValue('');
  }, []);

  const deleteCategory = useCallback((catId: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== catId));
    setSelectedCatId((prevSel) => {
      if (prevSel !== catId) return prevSel;
      const next = categories.filter((c) => c.id !== catId);
      return next.length > 0 ? next[0].id : null;
    });
  }, [categories]);

  // --- Tag operations ---

  const updateTag = useCallback((catId: string, tagId: string, field: 'name' | 'description', value: string) => {
    setCategories((prev) =>
      prev.map((c) =>
        c.id !== catId ? c : {
          ...c,
          tags: c.tags.map((t) => t.id !== tagId ? t : { ...t, [field]: value }),
        }
      )
    );
  }, []);

  const addTag = useCallback((catId: string) => {
    const newTag: EditorTag = { id: newId(), name: '', description: '' };
    setCategories((prev) =>
      prev.map((c) => c.id !== catId ? c : { ...c, tags: [...c.tags, newTag] })
    );
  }, []);

  const deleteTag = useCallback((catId: string, tagId: string) => {
    setCategories((prev) =>
      prev.map((c) => c.id !== catId ? c : { ...c, tags: c.tags.filter((t) => t.id !== tagId) })
    );
  }, []);

  // --- Save ---

  const handleSave = useCallback(() => {
    const error = validate(categories);
    if (error) { setSaveError(error); return; }
    setSaving(true);
    setSaveError(null);
    void (async () => {
      try {
        const yaml = serializeTagsToYaml(toTagCategories(categories));
        await api.saveTags(yaml);
        onClose();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save.');
        setSaving(false);
      }
    })();
  }, [categories, onClose]);

  const inputCls = DLG_INPUT_CLASS_ALT_COMPACT;

  return (
    <Dialog
      title="Edit Hashtags"
      onClose={onClose}
      className="flex flex-col w-full max-w-3xl h-[75vh]"
    >
        {/* Body */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* Left: Categories */}
            <div className="w-2/5 border-r border-slate-600 flex flex-col">
              <div className="pl-4 pr-6 pt-3 pb-3 text-sm font-bold text-slate-300 uppercase tracking-wider flex-shrink-0 flex items-center justify-between">
                <span>Categories</span>
                <button
                  type="button"
                  title="Add Category"
                  onClick={addCategory}
                  className="text-slate-400 hover:text-slate-100 text-lg leading-none cursor-pointer transition-colors"
                  data-testid="tags-editor-add-category-button"
                >
                  ＋
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2">
                {sortedCategories.map((cat) => (
                  <div
                    key={cat.id}
                    className={clsx(
                      'flex items-center gap-1 px-2 py-1.5 rounded group',
                      selectedCatId === cat.id
                        ? 'bg-slate-700 text-slate-100'
                        : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200',
                    )}
                  >
                    {renamingCatId === cat.id ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        data-testid="tags-editor-category-rename-input"
                        onKeyDown={(e) => {
                          // preventDefault stops Escape from also dismissing the
                          // surrounding <dialog>; this Esc only cancels the rename.
                          if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                          else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                        }}
                        className={`${inputCls} flex-1 min-w-0`}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSelectedCatId(cat.id)}
                        aria-pressed={selectedCatId === cat.id}
                        className="flex-1 min-w-0 text-left text-sm truncate cursor-pointer"
                      >
                        {cat.name || <em className="text-slate-500">unnamed</em>}
                      </button>
                    )}
                    <button
                      type="button"
                      title="Rename"
                      onClick={() => startRename(cat)}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-200 text-xl px-2 cursor-pointer flex-shrink-0"
                      data-testid={`tags-editor-category-edit-button-${cat.id}`}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      title={cat.tags.length > 0 ? 'Remove all tags first' : 'Delete category'}
                      onClick={() => { if (cat.tags.length === 0) deleteCategory(cat.id); }}
                      disabled={cat.tags.length > 0}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-400 text-xl px-2 cursor-pointer flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-slate-400"
                      data-testid={`tags-editor-category-delete-button-${cat.id}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Tags */}
            <div className="flex-1 flex flex-col min-w-0">
              {selectedCat === null ? (
                <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
                  {categories.length === 0 ? 'Add a category to get started.' : 'Select a category.'}
                </div>
              ) : (
                <>
                  <div className="pl-4 pr-6 pt-3 pb-3 text-sm font-bold text-slate-300 uppercase tracking-wider flex-shrink-0 flex items-center justify-between">
                    <span>Tags in &ldquo;{selectedCat.name || 'unnamed'}&rdquo;</span>
                    <button
                      type="button"
                      title="Add Tag"
                      onClick={() => addTag(selectedCat.id)}
                      className="text-slate-400 hover:text-slate-100 text-lg leading-none cursor-pointer transition-colors"
                      data-testid="tags-editor-add-tag-button"
                    >
                      ＋
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto pl-4 pr-2 py-2 space-y-3">
                    {selectedCat.tags.map((tag) => (
                      <div key={tag.id} className="flex gap-2 items-start group">
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-slate-500 text-sm select-none">#</span>
                            <input
                              type="text"
                              value={tag.name}
                              onChange={(e) => updateTag(selectedCat.id, tag.id, 'name', e.target.value)}
                              placeholder="tagname"
                              className={`${inputCls} flex-1 min-w-0`}
                              data-testid={`tags-editor-tag-name-input-${tag.id}`}
                            />
                          </div>
                          <input
                            type="text"
                            value={tag.description}
                            onChange={(e) => updateTag(selectedCat.id, tag.id, 'description', e.target.value.replace(/\n/g, ' '))}
                            placeholder="Description…"
                            className={`${inputCls} w-full ml-5`}
                            data-testid={`tags-editor-tag-description-input-${tag.id}`}
                          />
                        </div>
                        <button
                          type="button"
                          title="Delete tag"
                          onClick={() => deleteTag(selectedCat.id, tag.id)}
                          className="mt-1 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-400 text-xl px-2 cursor-pointer flex-shrink-0 transition-opacity"
                          data-testid={`tags-editor-tag-delete-button-${tag.id}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {selectedCat.tags.length === 0 && (
                      <p className="text-slate-500 text-sm">No tags yet. Add one below.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-600 flex-shrink-0">
          <div className="text-sm text-red-400">{saveError ?? ''}</div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className={BUTTON_CLASS_DLG_CANCEL}
              data-testid="tags-editor-dialog-cancel-button"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className={BUTTON_CLASS_DLG_BLUE}
              data-testid="tags-editor-dialog-save-button"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
    </Dialog>
  );
}
