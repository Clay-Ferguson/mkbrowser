import { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { api } from '../../renderer/api';
import { fetchTags } from '../../renderer/tagApi';
import { logger } from '../../shared/logUtil';
import { serializeTagsToYaml } from '../../shared/tagUtil';
import { bumpTagsRevision } from '../../store';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import { BUTTON_CLASS_DLG_SAVE, BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_LINK_MUTED, BUTTON_CLASS_LINK_RED, DLG_INPUT_CLASS_ALT_COMPACT } from '../../renderer/styles';
import {
  fromLoaded,
  toTagCategories,
  dropBlankTags,
  validate,
  newEditorCategory,
  newEditorTag,
  type EditorCategory,
} from './tagsEditorModel';

interface PendingConfirm {
  message: string;
  onConfirm: () => void;
}

// Serialized persisted form of the editor model; two models with equal
// snapshots save identically, so this is what "dirty" compares.
function snapshotOf(cats: EditorCategory[]): string {
  return JSON.stringify(toTagCategories(cats));
}

function sortByName(cats: EditorCategory[]): EditorCategory[] {
  return [...cats].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Tags Editor tab: manages the hashtag taxonomy. Two panes, like
 * TypesEditorView: the category list on the left and the tags within the
 * selected category on the right. Edits live in a local, id-keyed model (see
 * tagsEditorModel.ts) until Save (or a category rename, which saves at once),
 * which validates, serializes back to YAML, and persists via `api.saveTags`;
 * Revert reloads from disk. A category can only be deleted once empty. Since views never unmount, an unsaved draft survives tab
 * switches.
 */
export default function TagsEditorView() {
  const [categories, setCategories] = useState<EditorCategory[]>([]);
  // Snapshot of what is on disk, for the dirty check.
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [renamingCatId, setRenamingCatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [loading, setLoading] = useState(true);
  // Bumped by Revert to re-run the load effect.
  const [loadNonce, setLoadNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Id of a just-added tag whose name input should grab focus when it mounts.
  const [focusTagId, setFocusTagId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Name of the selected category, so Revert can reselect it (ids are regenerated on load).
  const reselectNameRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTags()
      .then((cats) => {
        if (cancelled) return;
        const editor = fromLoaded(cats);
        setCategories(editor);
        setSavedSnapshot(snapshotOf(editor));
        const wanted = reselectNameRef.current;
        const initialSel = editor.find((c) => c.name === wanted) ?? sortByName(editor)[0];
        setSelectedCatId(initialSel ? initialSel.id : null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('[TagsEditorView] failed to load tags', err);
        setError(err instanceof Error ? err.message : 'Failed to load tags');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadNonce]);

  useEffect(() => {
    if (renamingCatId) renameInputRef.current?.focus();
  }, [renamingCatId]);

  const selectedCat = categories.find((c) => c.id === selectedCatId) ?? null;
  const sortedCategories = sortByName(categories);
  const dirty = !loading && snapshotOf(categories) !== savedSnapshot;

  // --- Category operations ---

  const startRename = (cat: EditorCategory) => {
    setRenamingCatId(cat.id);
    setRenameValue(cat.name);
  };

  // A rename is saved immediately (along with any other pending edits), unless
  // the name is unchanged — e.g. a just-added category left blank.
  const commitRename = () => {
    if (!renamingCatId) return;
    const target = categories.find((c) => c.id === renamingCatId);
    setRenamingCatId(null);
    if (!target || target.name === renameValue) return;
    const next = categories.map((c) => c.id === renamingCatId ? { ...c, name: renameValue } : c);
    setCategories(next);
    save(next);
  };

  const cancelRename = () => {
    setRenamingCatId(null);
  };

  const addCategory = () => {
    const cat = newEditorCategory();
    setCategories((prev) => [...prev, cat]);
    setSelectedCatId(cat.id);
    setRenamingCatId(cat.id);
    setRenameValue('');
  };

  const deleteCategory = (catId: string) => {
    // Derive both the new list and the fallback selection from one filtered
    // array so the two setters can never disagree. When the deleted category
    // was selected, fall back to the first category in display (alphabetical) order.
    const remaining = categories.filter((c) => c.id !== catId);
    setCategories(remaining);
    setSelectedCatId((prevSel) => {
      if (prevSel !== catId) return prevSel;
      const first = sortByName(remaining)[0];
      return first ? first.id : null;
    });
  };

  // --- Tag operations ---

  const updateTag = (catId: string, tagId: string, field: 'name' | 'description', value: string) => {
    setCategories((prev) =>
      prev.map((c) =>
        c.id !== catId ? c : {
          ...c,
          tags: c.tags.map((t) => t.id !== tagId ? t : { ...t, [field]: value }),
        }
      )
    );
  };

  const addTag = (catId: string) => {
    const tag = newEditorTag();
    setCategories((prev) =>
      prev.map((c) => c.id !== catId ? c : { ...c, tags: [...c.tags, tag] })
    );
    setFocusTagId(tag.id);
  };

  const deleteTag = (catId: string, tagId: string) => {
    setCategories((prev) =>
      prev.map((c) => c.id !== catId ? c : { ...c, tags: c.tags.filter((t) => t.id !== tagId) })
    );
  };

  // --- Save / Revert ---

  const save = (model: EditorCategory[]) => {
    const toSave = dropBlankTags(model);
    const validationError = validate(toSave);
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError(null);
    api.saveTags(serializeTagsToYaml(toTagCategories(toSave)))
      .then(() => {
        // Tell the tag picker(s) to re-fetch the definitions.
        bumpTagsRevision();
        setCategories(toSave);
        setSavedSnapshot(snapshotOf(toSave));
        setSaving(false);
      })
      .catch((err: unknown) => {
        logger.error('[TagsEditorView] failed to save tags', err);
        setError(err instanceof Error ? err.message : 'Failed to save.');
        setSaving(false);
      });
  };

  const revert = () => {
    reselectNameRef.current = selectedCat ? selectedCat.name : null;
    setRenamingCatId(null);
    setError(null);
    setLoading(true);
    setLoadNonce((n) => n + 1);
  };

  const requestRevert = () => {
    setPendingConfirm({ message: 'Discard all unsaved changes to hashtags?', onConfirm: revert });
  };

  const inputCls = DLG_INPUT_CLASS_ALT_COMPACT;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
      <main className="flex-1 min-h-0 flex flex-col max-w-5xl w-full mx-auto px-4 py-6">
        <section className="flex-1 min-h-0 flex flex-col bg-slate-800 rounded-lg border border-slate-700">
          {/* Body */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
          ) : (
            <div className="flex flex-1 min-h-0">
              {/* Left: Categories */}
              <div className="w-2/5 border-r border-slate-600 flex flex-col">
                <div className="pl-4 pr-6 pt-3 pb-3 text-sm font-bold text-slate-300 uppercase tracking-wider flex-shrink-0 flex items-center justify-between">
                  <span>Tag Categories</span>
                  <button
                    type="button"
                    title="Add Category"
                    onClick={addCategory}
                    className={`${BUTTON_CLASS_LINK_MUTED} text-lg leading-none`}
                    data-testid="tags-editor-add-category-button"
                  >
                    ＋
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-2 pb-2">
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
                            // Enter/Escape during IME composition confirm/cancel the
                            // composition itself — not the rename.
                            if (e.nativeEvent.isComposing) return;
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
                          data-testid={`tags-editor-category-select-button-${cat.id}`}
                        >
                          {cat.name || <em className="text-slate-500">unnamed</em>}
                        </button>
                      )}
                      <button
                        type="button"
                        title="Rename"
                        onClick={() => startRename(cat)}
                        className={`${BUTTON_CLASS_LINK_MUTED} opacity-0 group-hover:opacity-100 text-xl px-2 flex-shrink-0`}
                        data-testid={`tags-editor-category-edit-button-${cat.id}`}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title={cat.tags.length > 0 ? 'Remove all tags first' : 'Delete category'}
                        onClick={() => { if (cat.tags.length === 0) deleteCategory(cat.id); }}
                        disabled={cat.tags.length > 0}
                        className={`${BUTTON_CLASS_LINK_RED} opacity-0 group-hover:opacity-100 text-xl px-2 flex-shrink-0 disabled:hover:text-btn-ghost`}
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
                      <span className="truncate">Tags in &ldquo;{selectedCat.name || 'unnamed'}&rdquo;</span>
                      <button
                        type="button"
                        title="Add Tag"
                        onClick={() => addTag(selectedCat.id)}
                        className={`${BUTTON_CLASS_LINK_MUTED} text-lg leading-none`}
                        data-testid="tags-editor-add-tag-button"
                      >
                        ＋
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto pl-4 pr-2 py-2 space-y-3">
                      {selectedCat.tags.map((tag) => (
                        <div key={tag.id} className="flex gap-2 items-start group">
                          <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 flex-1 min-w-0">
                            <label htmlFor={`tag-name-${tag.id}`} className="text-sm text-slate-400">
                              Tag
                            </label>
                            <input
                              id={`tag-name-${tag.id}`}
                              type="text"
                              value={tag.name}
                              onChange={(e) => updateTag(selectedCat.id, tag.id, 'name', e.target.value)}
                              placeholder="tagname"
                              autoFocus={tag.id === focusTagId}
                              className={`${inputCls} w-1/3 min-w-0`}
                              data-testid={`tags-editor-tag-name-input-${tag.id}`}
                            />
                            <label htmlFor={`tag-description-${tag.id}`} className="text-sm text-slate-400">
                              Description
                            </label>
                            <input
                              id={`tag-description-${tag.id}`}
                              type="text"
                              value={tag.description}
                              onChange={(e) => updateTag(selectedCat.id, tag.id, 'description', e.target.value.replace(/\n/g, ' '))}
                              placeholder="Description…"
                              className={`${inputCls} w-full min-w-0`}
                              data-testid={`tags-editor-tag-description-input-${tag.id}`}
                            />
                          </div>
                          <button
                            type="button"
                            title="Delete tag"
                            onClick={() => deleteTag(selectedCat.id, tag.id)}
                            className={`${BUTTON_CLASS_LINK_RED} mt-1 opacity-0 group-hover:opacity-100 text-xl px-2 flex-shrink-0`}
                            data-testid={`tags-editor-tag-delete-button-${tag.id}`}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      {selectedCat.tags.length === 0 && (
                        <p className="text-slate-500 text-sm">No tags yet. Click ＋ to add one.</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Hint */}
          <div className="px-6 pt-3 text-center text-xs italic text-slate-400 flex-shrink-0">
            Use Category &ldquo;ALL&rdquo; for non-mutually exclusive tags
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-slate-600 flex-shrink-0">
            <div className="text-sm min-w-0">
              {error ? (
                <span className="text-red-400" data-testid="tags-editor-error">{error}</span>
              ) : dirty ? (
                <span className="text-amber-400 italic" data-testid="tags-editor-dirty">Unsaved changes</span>
              ) : null}
            </div>
            <div className="flex gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={requestRevert}
                disabled={!dirty || saving}
                className={BUTTON_CLASS_DLG_CANCEL}
                data-testid="tags-editor-revert-button"
              >
                Revert
              </button>
              <button
                type="button"
                onClick={() => save(categories)}
                disabled={!dirty || saving || loading}
                className={BUTTON_CLASS_DLG_SAVE}
                data-testid="tags-editor-save-button"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </section>
      </main>

      {pendingConfirm && (
        <ConfirmDialog
          message={pendingConfirm.message}
          onConfirm={() => { pendingConfirm.onConfirm(); setPendingConfirm(null); }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
}
