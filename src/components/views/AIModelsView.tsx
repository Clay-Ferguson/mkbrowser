import { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { logger } from '../../shared/logUtil';
import { AI_PROVIDERS, AI_PROVIDER_DEFAULT_URLS, AI_PROVIDER_LABELS, AI_PROVIDER_MODEL_EXAMPLES, type AIProvider } from '../../shared/shared';
import { getAiConfig, useAS } from '../../store';
import { saveAiConfig } from '../../renderer/config';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import CheckboxField from '../dialogs/common/CheckboxField';
import { BUTTON_CLASS_DLG_SAVE, BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_LINK_MUTED, BUTTON_CLASS_LINK_RED, DLG_INPUT_CLASS_ALT_COMPACT, SETTINGS_CHECKBOX_CLASS } from '../../renderer/styles';
import {
  fromConfig,
  toConfig,
  validate,
  newEditorModel,
  resolveActive,
  markSaved,
  modelNameKey,
  sortByName,
  type EditorModel,
} from './aiModelsEditorModel';

// Shared fixed width for every field label in the right pane, so the inputs' left edges line up.
const FIELD_LABEL_CLASS = 'text-sm text-slate-400 flex-shrink-0 w-28 text-right';

type EditableField = 'provider' | 'model' | 'baseUrl' | 'vision' | 'inputText' | 'outputText';

interface PendingConfirm {
  message: string;
  onConfirm: () => void;
}

// Serialized persisted form of the editor model; two models with equal
// snapshots save identically, so this is what "dirty" compares.
function snapshotOf(models: EditorModel[]): string {
  return JSON.stringify(toConfig(models));
}

function isAIProvider(value: string): value is AIProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

/**
 * AI Models tab: defines the AI models the app can use. There are no built-in
 * models, so nothing AI works until at least one is defined here. Two panes,
 * like TypesEditorView: the model list (by user-chosen name) on the left and the
 * selected model's details on the right. Edits live in a local, id-keyed model
 * (see aiModelsEditorModel.ts) until Save, which validates and persists
 * `aiModels` (and the active `aiModel`) via `saveAiConfig`; Revert reloads.
 * Unlike the Types editor, a rename is not saved on its own: a just-added model
 * has no Model ID yet, so saving then would only fail validation.
 *
 * The active model is chosen on the AI Settings tab, which is also the only way
 * to open this tab (its "Configure Models" button). Since views never unmount,
 * an unsaved draft survives tab switches.
 *
 * See: (application_tabs.md#mounting-and-scroll-position-important)
 * See: (USER_GUIDE.md#configuring-ai-models)
 */
export default function AIModelsView() {
  const activeModelName = useAS(s => s.aiConfig.aiModel);
  // The AI config mirror is seeded at startup by loadConfig (before this tab can
  // first mount), so the saved models are read straight from the store —
  // non-reactively, since this is a draft editor. Revert re-reads it.
  const [models, setModels] = useState<EditorModel[]>(() => fromConfig(getAiConfig().aiModels));
  // Snapshot of what is saved, for the dirty check.
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshotOf(models));
  const [selectedId, setSelectedId] = useState<string | null>(() => sortByName(models)[0]?.id ?? null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // A save failure, shown until the next save attempt or Revert.
  const [ioError, setIoError] = useState<string | null>(null);
  // Set when a save is refused by validation. From then on the message is recomputed
  // from the current model on every render, so fixing the problem clears it at once.
  const [showValidation, setShowValidation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const selected = models.find((m) => m.id === selectedId) ?? null;
  const sortedModels = sortByName(models);
  const dirty = snapshotOf(models) !== savedSnapshot;
  const error = ioError ?? (showValidation ? validate(models) : null);
  const activeKey = modelNameKey(activeModelName);

  // --- Model list operations ---

  const startRename = (m: EditorModel) => {
    setRenamingId(m.id);
    setRenameValue(m.name);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const id = renamingId;
    setRenamingId(null);
    setModels((prev) => prev.map((m) => m.id === id ? { ...m, name: renameValue } : m));
  };

  const cancelRename = () => {
    setRenamingId(null);
  };

  // Adds a model and opens its name for typing. See: (USER_GUIDE.md#configuring-ai-models)
  const addModel = () => {
    const m = newEditorModel();
    setModels((prev) => [...prev, m]);
    setSelectedId(m.id);
    setRenamingId(m.id);
    setRenameValue('');
  };

  const deleteModel = (id: string) => {
    // Derive both the new list and the fallback selection from one filtered array
    // so the two setters can never disagree.
    const remaining = models.filter((m) => m.id !== id);
    setModels(remaining);
    setSelectedId((prevSel) => {
      if (prevSel !== id) return prevSel;
      const first = sortByName(remaining)[0];
      return first ? first.id : null;
    });
  };

  const requestDeleteModel = (m: EditorModel) => {
    setPendingConfirm({
      message: `Delete model "${m.name || 'unnamed'}"? (Takes effect when you Save.)`,
      onConfirm: () => deleteModel(m.id),
    });
  };

  const updateField = <K extends EditableField>(id: string, field: K, value: EditorModel[K]) => {
    setModels((prev) => prev.map((m) => m.id === id ? { ...m, [field]: value } : m));
  };

  // --- Save / Revert ---

  // Save: validates, then writes the models and the (rename-followed) active model. See: (USER_GUIDE.md#configuring-ai-models)
  const save = () => {
    if (validate(models)) { setShowValidation(true); return; }
    setSaving(true);
    setShowValidation(false);
    setIoError(null);
    const aiModels = toConfig(models);
    const aiModel = resolveActive(models, getAiConfig().aiModel);
    saveAiConfig({ aiModels, aiModel })
      .then(() => {
        const saved = markSaved(models);
        setModels(saved);
        setSavedSnapshot(snapshotOf(saved));
        setSaving(false);
      })
      .catch((err: unknown) => {
        logger.error('[AIModelsView] failed to save AI models', err);
        setIoError(err instanceof Error ? err.message : 'Failed to save.');
        setSaving(false);
      });
  };

  // Reloads the saved models, reselecting the same model when it still exists (ids are regenerated).
  const revert = () => {
    const wanted = selected?.originalName;
    const editor = fromConfig(getAiConfig().aiModels);
    setModels(editor);
    setSavedSnapshot(snapshotOf(editor));
    const sel = editor.find((m) => m.originalName === wanted) ?? sortByName(editor)[0];
    setSelectedId(sel ? sel.id : null);
    setRenamingId(null);
    setIoError(null);
    setShowValidation(false);
  };

  const requestRevert = () => {
    setPendingConfirm({ message: 'Discard all unsaved changes to AI models?', onConfirm: revert });
  };

  const inputCls = DLG_INPUT_CLASS_ALT_COMPACT;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
      <main className="flex-1 min-h-0 flex flex-col max-w-5xl w-full mx-auto px-4 py-6">
        <section className="flex-1 min-h-0 flex flex-col bg-slate-800 rounded-lg border border-slate-700">
          {/* Body */}
          <div className="flex flex-1 min-h-0">
            {/* Left: Models */}
            <div className="w-2/5 border-r border-slate-600 flex flex-col">
              <div className="pl-4 pr-6 pt-3 pb-3 text-sm font-bold text-slate-300 uppercase tracking-wider flex-shrink-0 flex items-center justify-between">
                <span>AI Models</span>
                <button
                  type="button"
                  title="Add Model"
                  onClick={addModel}
                  className={`${BUTTON_CLASS_LINK_MUTED} text-lg leading-none`}
                  data-testid="ai-models-add-button"
                >
                  ＋
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2">
                {sortedModels.map((m) => {
                  const isActive = activeKey !== '' && m.originalName !== undefined && modelNameKey(m.originalName) === activeKey;
                  return (
                    <div
                      key={m.id}
                      className={clsx(
                        'flex items-center gap-1 px-2 py-1.5 rounded group',
                        selectedId === m.id
                          ? 'bg-slate-700 text-slate-100'
                          : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200',
                      )}
                    >
                      {renamingId === m.id ? (
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={commitRename}
                          placeholder="Model name"
                          data-testid="ai-models-rename-input"
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
                          onClick={() => setSelectedId(m.id)}
                          aria-pressed={selectedId === m.id}
                          className="flex-1 min-w-0 text-left text-sm truncate cursor-pointer"
                          data-testid={`ai-models-select-button-${m.id}`}
                        >
                          {m.name || <em className="text-slate-500">unnamed</em>}
                        </button>
                      )}
                      {isActive && (
                        <span
                          className="text-xs text-green-400 border border-green-700 rounded px-1.5 flex-shrink-0"
                          title="The model AI features use (chosen on the AI Settings tab)"
                          data-testid="ai-models-active-badge"
                        >
                          Active
                        </span>
                      )}
                      <button
                        type="button"
                        title="Rename"
                        onClick={() => startRename(m)}
                        className={`${BUTTON_CLASS_LINK_MUTED} opacity-0 group-hover:opacity-100 text-xl px-2 flex-shrink-0`}
                        data-testid={`ai-models-rename-button-${m.id}`}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title="Delete model"
                        onClick={() => requestDeleteModel(m)}
                        className={`${BUTTON_CLASS_LINK_RED} opacity-0 group-hover:opacity-100 text-xl px-2 flex-shrink-0`}
                        data-testid={`ai-models-delete-button-${m.id}`}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Details */}
            <div className="flex-1 flex flex-col min-w-0">
              {selected === null ? (
                <div className="flex-1 flex items-center justify-center text-slate-500 text-sm px-6 text-center">
                  {models.length === 0
                    ? 'No AI models are defined. Click ＋ to add one — AI features need at least one model.'
                    : 'Select a model.'}
                </div>
              ) : (
                <>
                  <div className="pl-4 pr-6 pt-3 pb-3 text-sm font-bold text-slate-300 uppercase tracking-wider flex-shrink-0">
                    <span className="truncate">Details of &ldquo;{selected.name || 'unnamed'}&rdquo;</span>
                  </div>
                  <div className="flex-1 overflow-y-auto pl-4 pr-6 py-3 space-y-3 border-t border-slate-700">
                    <div className="flex items-center gap-2">
                      <label htmlFor="ai-models-provider" className={FIELD_LABEL_CLASS}>Provider:</label>
                      <select
                        id="ai-models-provider"
                        value={selected.provider}
                        onChange={(e) => { if (isAIProvider(e.target.value)) updateField(selected.id, 'provider', e.target.value); }}
                        className={`${inputCls} cursor-pointer`}
                        data-testid="ai-models-provider-select"
                      >
                        {AI_PROVIDERS.map((p) => (
                          <option key={p} value={p}>{AI_PROVIDER_LABELS[p]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label htmlFor="ai-models-model-id" className={FIELD_LABEL_CLASS}>Model ID:</label>
                      <input
                        id="ai-models-model-id"
                        type="text"
                        value={selected.model}
                        onChange={(e) => updateField(selected.id, 'model', e.target.value)}
                        placeholder={AI_PROVIDER_MODEL_EXAMPLES[selected.provider]}
                        className={`${inputCls} flex-1 min-w-0 font-mono`}
                        data-testid="ai-models-model-input"
                      />
                    </div>
                    <div className="flex items-start gap-2">
                      <label htmlFor="ai-models-base-url" className={`${FIELD_LABEL_CLASS} mt-1.5`}>Base URL:</label>
                      <div className="flex-1 min-w-0">
                        <input
                          id="ai-models-base-url"
                          type="text"
                          value={selected.baseUrl}
                          onChange={(e) => updateField(selected.id, 'baseUrl', e.target.value)}
                          placeholder={AI_PROVIDER_DEFAULT_URLS[selected.provider]}
                          className={`${inputCls} w-full font-mono`}
                          data-testid="ai-models-base-url-input"
                        />
                        <p className="text-xs text-slate-500 mt-1">
                          Leave blank for the provider&rsquo;s standard endpoint. For a local server (llama.cpp, LM Studio), choose
                          OpenAI-compatible and enter its URL, e.g. <span className="font-mono">http://localhost:8080/v1</span>.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={FIELD_LABEL_CLASS}>Vision:</span>
                      <CheckboxField
                        label="Supports image input"
                        checked={selected.vision}
                        onChange={(checked) => updateField(selected.id, 'vision', checked)}
                        inputClassName={SETTINGS_CHECKBOX_CLASS}
                        spanClassName="text-sm text-slate-200"
                        testId="ai-models-vision-checkbox"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label htmlFor="ai-models-input-price" className={FIELD_LABEL_CLASS}>Input $/1M:</label>
                      <input
                        id="ai-models-input-price"
                        type="text"
                        inputMode="decimal"
                        value={selected.inputText}
                        onChange={(e) => updateField(selected.id, 'inputText', e.target.value)}
                        placeholder="0"
                        className={`${inputCls} w-32 font-mono`}
                        data-testid="ai-models-input-price-input"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label htmlFor="ai-models-output-price" className={FIELD_LABEL_CLASS}>Output $/1M:</label>
                      <input
                        id="ai-models-output-price"
                        type="text"
                        inputMode="decimal"
                        value={selected.outputText}
                        onChange={(e) => updateField(selected.id, 'outputText', e.target.value)}
                        placeholder="0"
                        className={`${inputCls} w-32 font-mono`}
                        data-testid="ai-models-output-price-input"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-slate-600 flex-shrink-0">
            <div className="text-sm min-w-0">
              {error ? (
                <span className="text-red-400" data-testid="ai-models-error">{error}</span>
              ) : dirty ? (
                <span className="text-amber-400 italic" data-testid="ai-models-dirty">Unsaved changes</span>
              ) : null}
            </div>
            <div className="flex gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={requestRevert}
                disabled={!dirty || saving}
                className={BUTTON_CLASS_DLG_CANCEL}
                data-testid="ai-models-revert-button"
              >
                Revert
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!dirty || saving}
                className={BUTTON_CLASS_DLG_SAVE}
                data-testid="ai-models-save-button"
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
