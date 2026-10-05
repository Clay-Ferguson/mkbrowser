import { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/outline';
import { api } from '../../renderer/api';
import { logger } from '../../shared/logUtil';
import { PROPERTY_TYPES, type PropertyType } from '../../shared/shared';
import { setTypeDefs } from '../../store';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import { BUTTON_CLASS_DLG_SAVE, BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_LINK_MUTED, BUTTON_CLASS_LINK_RED, DLG_INPUT_CLASS_ALT_COMPACT } from '../../renderer/styles';
import {
  fromTypeDefs,
  toTypeDefs,
  dropBlankProperties,
  validate,
  newEditorType,
  newEditorProperty,
  type EditorType,
  type EditorProperty,
} from './typesEditorModel';

// Display labels for the property-type select; the stored values are the lowercase keys.
const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  text: 'Text',
  address: 'Address',
  email: 'Email',
  url: 'URL',
  phone: 'Phone',
  date: 'Date',
};

// Shared fixed width for every field label in the right pane (type description
// and each property's name/description/type), so the inputs' left edges line up.
const FIELD_LABEL_CLASS = 'text-sm text-slate-400 flex-shrink-0 w-24 text-right';

interface PendingConfirm {
  message: string;
  onConfirm: () => void;
}

// Serialized persisted form of the editor model; two models with equal
// snapshots save identically, so this is what "dirty" compares.
function snapshotOf(types: EditorType[]): string {
  return JSON.stringify(toTypeDefs(types));
}

function sortByName(types: EditorType[]): EditorType[] {
  return [...types].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Types Editor tab: manages the user-defined object types stored under `types:`
 * in config.yaml. Two panes, following TagsEditorDialog: the type list on the
 * left and the selected type's description and properties on the right. Edits
 * live in a local, id-keyed model (see typesEditorModel.ts) until Save, which
 * validates and persists via `api.updateConfig({ types })`; Revert reloads from
 * config. Since views never unmount, an unsaved draft survives tab switches.
 */
export default function TypesEditorView() {
  const [types, setTypes] = useState<EditorType[]>([]);
  // Snapshot of what is on disk, for the dirty check.
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [renamingTypeId, setRenamingTypeId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [loading, setLoading] = useState(true);
  // Bumped by Revert to re-run the load effect.
  const [loadNonce, setLoadNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Id of a just-added property whose name input should grab focus when it mounts.
  const [focusPropId, setFocusPropId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Name of the selected type, so Revert can reselect it (ids are regenerated on load).
  const reselectNameRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getConfig()
      .then((config) => {
        if (cancelled) return;
        const editor = fromTypeDefs(config.types ?? {});
        setTypes(editor);
        setSavedSnapshot(snapshotOf(editor));
        const wanted = reselectNameRef.current;
        const initialSel = editor.find((t) => t.name === wanted) ?? sortByName(editor)[0];
        setSelectedTypeId(initialSel ? initialSel.id : null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('[TypesEditorView] failed to load types', err);
        setError(err instanceof Error ? err.message : 'Failed to load types');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadNonce]);

  useEffect(() => {
    if (renamingTypeId) renameInputRef.current?.focus();
  }, [renamingTypeId]);

  const selectedType = types.find((t) => t.id === selectedTypeId) ?? null;
  const sortedTypes = sortByName(types);
  const dirty = !loading && snapshotOf(types) !== savedSnapshot;

  // --- Type operations ---

  const startRename = (type: EditorType) => {
    setRenamingTypeId(type.id);
    setRenameValue(type.name);
  };

  const commitRename = () => {
    if (!renamingTypeId) return;
    setTypes((prev) =>
      prev.map((t) => t.id === renamingTypeId ? { ...t, name: renameValue } : t)
    );
    setRenamingTypeId(null);
  };

  const cancelRename = () => {
    setRenamingTypeId(null);
  };

  const addType = () => {
    const type = newEditorType();
    setTypes((prev) => [...prev, type]);
    setSelectedTypeId(type.id);
    setRenamingTypeId(type.id);
    setRenameValue('');
  };

  const deleteType = (typeId: string) => {
    // Derive both the new list and the fallback selection from one filtered
    // array so the two setters can never disagree. When the deleted type was
    // selected, fall back to the first type in display (alphabetical) order.
    const remaining = types.filter((t) => t.id !== typeId);
    setTypes(remaining);
    setSelectedTypeId((prevSel) => {
      if (prevSel !== typeId) return prevSel;
      const first = sortByName(remaining)[0];
      return first ? first.id : null;
    });
  };

  const requestDeleteType = (type: EditorType) => {
    if (type.properties.length === 0) {
      deleteType(type.id);
      return;
    }
    const count = type.properties.length;
    setPendingConfirm({
      message: `Delete type "${type.name || 'unnamed'}" and its ${count} ${count === 1 ? 'property' : 'properties'}?`,
      onConfirm: () => deleteType(type.id),
    });
  };

  const updateTypeDescription = (typeId: string, description: string) => {
    setTypes((prev) => prev.map((t) => t.id === typeId ? { ...t, description } : t));
  };

  // --- Property operations ---

  const updateProperty = (typeId: string, propId: string, patch: Partial<Pick<EditorProperty, 'name' | 'description' | 'type'>>) => {
    setTypes((prev) =>
      prev.map((t) =>
        t.id !== typeId ? t : {
          ...t,
          properties: t.properties.map((p) => p.id !== propId ? p : { ...p, ...patch }),
        }
      )
    );
  };

  const addProperty = (typeId: string) => {
    const prop = newEditorProperty();
    setTypes((prev) =>
      prev.map((t) => t.id !== typeId ? t : { ...t, properties: [...t.properties, prop] })
    );
    setFocusPropId(prop.id);
  };

  // Swap a property with its neighbor (delta -1 = up, +1 = down); no-op at either end.
  const moveProperty = (typeId: string, propId: string, delta: -1 | 1) => {
    setTypes((prev) =>
      prev.map((t) => {
        if (t.id !== typeId) return t;
        const from = t.properties.findIndex((p) => p.id === propId);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= t.properties.length) return t;
        const properties = [...t.properties];
        [properties[from], properties[to]] = [properties[to]!, properties[from]!];
        return { ...t, properties };
      })
    );
  };

  const deleteProperty = (typeId: string, propId: string) => {
    setTypes((prev) =>
      prev.map((t) => t.id !== typeId ? t : { ...t, properties: t.properties.filter((p) => p.id !== propId) })
    );
  };

  // --- Save / Revert ---

  const handleSave = () => {
    const toSave = dropBlankProperties(types);
    const validationError = validate(toSave);
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError(null);
    const defs = toTypeDefs(toSave);
    api.updateConfig({ types: defs })
      .then(() => {
        // Mirror into the store so the editor's "Insert Object" menu sees the new types.
        setTypeDefs(defs);
        setTypes(toSave);
        setSavedSnapshot(snapshotOf(toSave));
        setSaving(false);
      })
      .catch((err: unknown) => {
        logger.error('[TypesEditorView] failed to save types', err);
        setError(err instanceof Error ? err.message : 'Failed to save.');
        setSaving(false);
      });
  };

  const revert = () => {
    reselectNameRef.current = selectedType ? selectedType.name : null;
    setRenamingTypeId(null);
    setError(null);
    setLoading(true);
    setLoadNonce((n) => n + 1);
  };

  const requestRevert = () => {
    setPendingConfirm({ message: 'Discard all unsaved changes to types?', onConfirm: revert });
  };

  const inputCls = DLG_INPUT_CLASS_ALT_COMPACT;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
      <main className="flex-1 min-h-0 flex flex-col max-w-5xl w-full mx-auto px-4 py-6">
        <div className="mb-4 flex-shrink-0">
          <h2 className="text-lg font-semibold text-slate-100 mb-1">Object Types</h2>
          <p className="text-sm text-slate-400">
            Define object types and the properties each one carries.
          </p>
        </div>

        <section className="flex-1 min-h-0 flex flex-col bg-slate-800 rounded-lg border border-slate-700">
          {/* Body */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
          ) : (
            <div className="flex flex-1 min-h-0">
              {/* Left: Types */}
              <div className="w-2/5 border-r border-slate-600 flex flex-col">
                <div className="pl-4 pr-6 pt-3 pb-3 text-sm font-bold text-slate-300 uppercase tracking-wider flex-shrink-0 flex items-center justify-between">
                  <span>Types</span>
                  <button
                    type="button"
                    title="Add Type"
                    onClick={addType}
                    className={`${BUTTON_CLASS_LINK_MUTED} text-lg leading-none`}
                    data-testid="types-editor-add-type-button"
                  >
                    ＋
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-2 pb-2">
                  {sortedTypes.map((type) => (
                    <div
                      key={type.id}
                      className={clsx(
                        'flex items-center gap-1 px-2 py-1.5 rounded group',
                        selectedTypeId === type.id
                          ? 'bg-slate-700 text-slate-100'
                          : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200',
                      )}
                    >
                      {renamingTypeId === type.id ? (
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={commitRename}
                          placeholder="type_name"
                          data-testid="types-editor-type-rename-input"
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
                          onClick={() => setSelectedTypeId(type.id)}
                          aria-pressed={selectedTypeId === type.id}
                          className="flex-1 min-w-0 text-left text-sm truncate cursor-pointer"
                          data-testid={`types-editor-type-select-button-${type.id}`}
                        >
                          {type.name || <em className="text-slate-500">unnamed</em>}
                        </button>
                      )}
                      <button
                        type="button"
                        title="Rename"
                        onClick={() => startRename(type)}
                        className={`${BUTTON_CLASS_LINK_MUTED} opacity-0 group-hover:opacity-100 text-xl px-2 flex-shrink-0`}
                        data-testid={`types-editor-type-edit-button-${type.id}`}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title="Delete type"
                        onClick={() => requestDeleteType(type)}
                        className={`${BUTTON_CLASS_LINK_RED} opacity-0 group-hover:opacity-100 text-xl px-2 flex-shrink-0`}
                        data-testid={`types-editor-type-delete-button-${type.id}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: Properties */}
              <div className="flex-1 flex flex-col min-w-0">
                {selectedType === null ? (
                  <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
                    {types.length === 0 ? 'Add a type to get started.' : 'Select a type.'}
                  </div>
                ) : (
                  <>
                    <div className="pl-4 pr-6 pt-3 pb-3 text-sm font-bold text-slate-300 uppercase tracking-wider flex-shrink-0 flex items-center justify-between">
                      <span className="truncate">Properties of &ldquo;{selectedType.name || 'unnamed'}&rdquo;</span>
                      <button
                        type="button"
                        title="Add Property"
                        onClick={() => addProperty(selectedType.id)}
                        className={`${BUTTON_CLASS_LINK_MUTED} text-lg leading-none`}
                        data-testid="types-editor-add-property-button"
                      >
                        ＋
                      </button>
                    </div>
                    <div className="pl-4 pr-12 pb-3 flex-shrink-0 flex items-center gap-2">
                      <label htmlFor="types-editor-type-description" className={FIELD_LABEL_CLASS}>
                        Description:
                      </label>
                      <input
                        id="types-editor-type-description"
                        type="text"
                        value={selectedType.description}
                        onChange={(e) => updateTypeDescription(selectedType.id, e.target.value.replace(/\n/g, ' '))}
                        placeholder="Type description…"
                        className={`${inputCls} flex-1 min-w-0`}
                        data-testid="types-editor-type-description-input"
                      />
                    </div>
                    <div className="flex-1 overflow-y-auto pl-4 pr-2 py-2 space-y-3 border-t border-slate-700">
                      {selectedType.properties.map((prop, index) => (
                        <div key={prop.id} className="flex gap-2 items-start group">
                          <div className="flex flex-col gap-1 flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <label htmlFor={`types-editor-property-name-${prop.id}`} className={FIELD_LABEL_CLASS}>
                                Name:
                              </label>
                              <input
                                id={`types-editor-property-name-${prop.id}`}
                                type="text"
                                value={prop.name}
                                onChange={(e) => updateProperty(selectedType.id, prop.id, { name: e.target.value })}
                                placeholder="property_name"
                                autoFocus={prop.id === focusPropId}
                                className={`${inputCls} flex-1 min-w-0`}
                                data-testid={`types-editor-property-name-input-${prop.id}`}
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <label htmlFor={`types-editor-property-description-${prop.id}`} className={FIELD_LABEL_CLASS}>
                                Description:
                              </label>
                              <input
                                id={`types-editor-property-description-${prop.id}`}
                                type="text"
                                value={prop.description}
                                onChange={(e) => updateProperty(selectedType.id, prop.id, { description: e.target.value.replace(/\n/g, ' ') })}
                                placeholder="Description…"
                                className={`${inputCls} flex-1 min-w-0`}
                                data-testid={`types-editor-property-description-input-${prop.id}`}
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <label htmlFor={`types-editor-property-type-${prop.id}`} className={FIELD_LABEL_CLASS}>
                                Type:
                              </label>
                              <select
                                id={`types-editor-property-type-${prop.id}`}
                                value={prop.type}
                                onChange={(e) => updateProperty(selectedType.id, prop.id, { type: e.target.value as PropertyType })}
                                className={`${inputCls} cursor-pointer`}
                                data-testid={`types-editor-property-type-select-${prop.id}`}
                              >
                                {PROPERTY_TYPES.map((t) => (
                                  <option key={t} value={t}>{PROPERTY_TYPE_LABELS[t]}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          {/* Grouped without a gap so the icons sit close together. At either end the unusable arrow is invisible (not removed) so the icons stay aligned across rows. */}
                          <div className="flex items-start mt-1 flex-shrink-0">
                            <button
                              type="button"
                              title="Move up"
                              aria-label="Move property up"
                              onClick={() => moveProperty(selectedType.id, prop.id, -1)}
                              disabled={index === 0}
                              className={`${BUTTON_CLASS_LINK_MUTED} p-1 opacity-0 group-hover:opacity-100 disabled:invisible`}
                              data-testid={`types-editor-property-up-button-${prop.id}`}
                            >
                              <ArrowUpIcon className="w-5 h-5" />
                            </button>
                            <button
                              type="button"
                              title="Move down"
                              aria-label="Move property down"
                              onClick={() => moveProperty(selectedType.id, prop.id, 1)}
                              disabled={index === selectedType.properties.length - 1}
                              className={`${BUTTON_CLASS_LINK_MUTED} p-1 opacity-0 group-hover:opacity-100 disabled:invisible`}
                              data-testid={`types-editor-property-down-button-${prop.id}`}
                            >
                              <ArrowDownIcon className="w-5 h-5" />
                            </button>
                            <button
                              type="button"
                              title="Delete property"
                              onClick={() => deleteProperty(selectedType.id, prop.id)}
                              className={`${BUTTON_CLASS_LINK_RED} opacity-0 group-hover:opacity-100 text-xl px-1`}
                              data-testid={`types-editor-property-delete-button-${prop.id}`}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                      {selectedType.properties.length === 0 && (
                        <p className="text-slate-500 text-sm">No properties yet. Click ＋ to add one.</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-slate-600 flex-shrink-0">
            <div className="text-sm min-w-0">
              {error ? (
                <span className="text-red-400" data-testid="types-editor-error">{error}</span>
              ) : dirty ? (
                <span className="text-amber-400 italic" data-testid="types-editor-dirty">Unsaved changes</span>
              ) : null}
            </div>
            <div className="flex gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={requestRevert}
                disabled={!dirty || saving}
                className={BUTTON_CLASS_DLG_CANCEL}
                data-testid="types-editor-revert-button"
              >
                Revert
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || saving || loading}
                className={BUTTON_CLASS_DLG_SAVE}
                data-testid="types-editor-save-button"
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
