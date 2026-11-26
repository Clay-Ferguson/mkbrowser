import { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { logger } from '../../shared/logUtil';
import { DEFAULT_AI_REWRITE_PERSONA } from '../../shared/ai/aiPrompts';
import { getAiConfig, useAS } from '../../store';
import { saveAiConfig } from '../../renderer/config';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import { BUTTON_CLASS_DLG_SAVE, BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_LINK_MUTED, BUTTON_CLASS_LINK_RED, DLG_INPUT_CLASS_ALT_COMPACT } from '../../renderer/styles';
import {
  fromConfig,
  toConfig,
  validate,
  newEditorPersona,
  resolveActive,
  markSaved,
  personaNameKey,
  sortByName,
  type EditorPersona,
} from './aiPersonasEditorModel';

interface PendingConfirm {
  message: string;
  onConfirm: () => void;
}

// Serialized persisted form of the editor model; two models with equal
// snapshots save identically, so this is what "dirty" compares.
function snapshotOf(personas: EditorPersona[]): string {
  return JSON.stringify(toConfig(personas));
}

/**
 * AI Personas tab: defines the named personas (instructions woven into the
 * system prompt for AI Chat and AI Rewrite). Two panes, like AIModelsView: the
 * persona list on the left and the selected persona's instructions on the right.
 * Edits live in a local, id-keyed model (see aiPersonasEditorModel.ts) until
 * Save, which validates and persists `aiRewritePrompts` (and the active
 * `aiRewritePrompt`, following a rename) via `saveAiConfig`; Revert reloads.
 * The built-in [Default Agent] persona isn't listed here — it isn't editable.
 *
 * The active persona is chosen on the AI Settings tab (or the AI Chat header);
 * AI Settings' "Configure Personas" button is the only way to open this tab.
 * Since views never unmount, an unsaved draft survives tab switches.
 *
 * See: (application_tabs.md#mounting-and-scroll-position-important)
 * See: (USER_GUIDE.md#configuring-personas)
 */
export default function AIPersonasView() {
  const activePersonaName = useAS(s => s.aiConfig.aiRewritePrompt);
  // The AI config mirror is seeded at startup by loadConfig (before this tab can
  // first mount), so the saved personas are read straight from the store —
  // non-reactively, since this is a draft editor. Revert re-reads it.
  const [personas, setPersonas] = useState<EditorPersona[]>(() => fromConfig(getAiConfig().aiRewritePrompts));
  // Snapshot of what is saved, for the dirty check.
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshotOf(personas));
  const [selectedId, setSelectedId] = useState<string | null>(() => sortByName(personas)[0]?.id ?? null);
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

  const selected = personas.find((p) => p.id === selectedId) ?? null;
  const sortedPersonas = sortByName(personas);
  const dirty = snapshotOf(personas) !== savedSnapshot;
  const error = ioError ?? (showValidation ? validate(personas) : null);
  const activeKey = personaNameKey(activePersonaName);

  // --- Persona list operations ---

  const startRename = (p: EditorPersona) => {
    setRenamingId(p.id);
    setRenameValue(p.name);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const id = renamingId;
    setRenamingId(null);
    setPersonas((prev) => prev.map((p) => p.id === id ? { ...p, name: renameValue } : p));
  };

  const cancelRename = () => {
    setRenamingId(null);
  };

  // Adds a persona and opens its name for typing. See: (USER_GUIDE.md#configuring-personas)
  const addPersona = () => {
    const p = newEditorPersona();
    setPersonas((prev) => [...prev, p]);
    setSelectedId(p.id);
    setRenamingId(p.id);
    setRenameValue('');
  };

  const deletePersona = (id: string) => {
    // Derive both the new list and the fallback selection from one filtered array
    // so the two setters can never disagree.
    const remaining = personas.filter((p) => p.id !== id);
    setPersonas(remaining);
    setSelectedId((prevSel) => {
      if (prevSel !== id) return prevSel;
      const first = sortByName(remaining)[0];
      return first ? first.id : null;
    });
  };

  const requestDeletePersona = (p: EditorPersona) => {
    setPendingConfirm({
      message: `Delete persona "${p.name || 'unnamed'}"? (Takes effect when you Save.)`,
      onConfirm: () => deletePersona(p.id),
    });
  };

  const updatePrompt = (id: string, prompt: string) => {
    setPersonas((prev) => prev.map((p) => p.id === id ? { ...p, prompt } : p));
  };

  // --- Save / Revert ---

  // Save: validates, then writes the personas and the (rename-followed) active persona.
  // An active persona that was deleted falls back to [Default Agent] (key removed).
  // See: (USER_GUIDE.md#configuring-personas)
  const save = () => {
    if (validate(personas)) { setShowValidation(true); return; }
    setSaving(true);
    setShowValidation(false);
    setIoError(null);
    const aiRewritePrompts = toConfig(personas);
    const aiRewritePrompt = resolveActive(personas, getAiConfig().aiRewritePrompt) || undefined;
    saveAiConfig({ aiRewritePrompts, aiRewritePrompt })
      .then(() => {
        const saved = markSaved(personas);
        setPersonas(saved);
        setSavedSnapshot(snapshotOf(saved));
        setSaving(false);
      })
      .catch((err: unknown) => {
        logger.error('[AIPersonasView] failed to save AI personas', err);
        setIoError(err instanceof Error ? err.message : 'Failed to save.');
        setSaving(false);
      });
  };

  // Reloads the saved personas, reselecting the same one when it still exists (ids are regenerated).
  const revert = () => {
    const wanted = selected?.originalName;
    const editor = fromConfig(getAiConfig().aiRewritePrompts);
    setPersonas(editor);
    setSavedSnapshot(snapshotOf(editor));
    const sel = editor.find((p) => p.originalName === wanted) ?? sortByName(editor)[0];
    setSelectedId(sel ? sel.id : null);
    setRenamingId(null);
    setIoError(null);
    setShowValidation(false);
  };

  const requestRevert = () => {
    setPendingConfirm({ message: 'Discard all unsaved changes to AI personas?', onConfirm: revert });
  };

  const inputCls = DLG_INPUT_CLASS_ALT_COMPACT;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-900">
      <main className="flex-1 min-h-0 flex flex-col max-w-5xl w-full mx-auto px-4 py-6">
        <section className="flex-1 min-h-0 flex flex-col bg-slate-800 rounded-lg border border-slate-700">
          {/* Body */}
          <div className="flex flex-1 min-h-0">
            {/* Left: Personas */}
            <div className="w-2/5 border-r border-slate-600 flex flex-col">
              <div className="pl-4 pr-6 pt-3 pb-3 text-sm font-bold text-slate-300 uppercase tracking-wider flex-shrink-0 flex items-center justify-between">
                <span>AI Personas</span>
                <button
                  type="button"
                  title="Add Persona"
                  onClick={addPersona}
                  className={`${BUTTON_CLASS_LINK_MUTED} text-lg leading-none`}
                  data-testid="ai-personas-add-button"
                >
                  ＋
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-2">
                {sortedPersonas.map((p) => {
                  const isActive = activeKey !== '' && p.originalName !== undefined && personaNameKey(p.originalName) === activeKey;
                  return (
                    <div
                      key={p.id}
                      className={clsx(
                        'flex items-center gap-1 px-2 py-1.5 rounded group',
                        selectedId === p.id
                          ? 'bg-slate-700 text-slate-100'
                          : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200',
                      )}
                    >
                      {renamingId === p.id ? (
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={commitRename}
                          placeholder="Persona name"
                          data-testid="ai-personas-rename-input"
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
                          onClick={() => setSelectedId(p.id)}
                          aria-pressed={selectedId === p.id}
                          className="flex-1 min-w-0 text-left text-sm truncate cursor-pointer"
                          data-testid={`ai-personas-select-button-${p.id}`}
                        >
                          {p.name || <em className="text-slate-500">unnamed</em>}
                        </button>
                      )}
                      {isActive && (
                        <span
                          className="text-xs text-green-400 border border-green-700 rounded px-1.5 flex-shrink-0"
                          title="The persona AI Chat and AI Rewrite use (chosen on the AI Settings tab)"
                          data-testid="ai-personas-active-badge"
                        >
                          Active
                        </span>
                      )}
                      <button
                        type="button"
                        title="Rename"
                        onClick={() => startRename(p)}
                        className={`${BUTTON_CLASS_LINK_MUTED} opacity-0 group-hover:opacity-100 text-xl px-2 flex-shrink-0`}
                        data-testid={`ai-personas-rename-button-${p.id}`}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title="Delete persona"
                        onClick={() => requestDeletePersona(p)}
                        className={`${BUTTON_CLASS_LINK_RED} opacity-0 group-hover:opacity-100 text-xl px-2 flex-shrink-0`}
                        data-testid={`ai-personas-delete-button-${p.id}`}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Instructions */}
            <div className="flex-1 flex flex-col min-w-0">
              {selected === null ? (
                <div className="flex-1 flex items-center justify-center text-slate-500 text-sm px-6 text-center">
                  {personas.length === 0 ? 'No personas yet. Click ＋ to add one.' : 'Select a persona.'}
                </div>
              ) : (
                <>
                  <div className="pl-4 pr-6 pt-3 pb-3 text-sm font-bold text-slate-300 uppercase tracking-wider flex-shrink-0">
                    <span className="truncate">Persona &ldquo;{selected.name || 'unnamed'}&rdquo;</span>
                  </div>
                  <div className="flex-1 min-h-0 flex flex-col pl-4 pr-6 py-3 border-t border-slate-700">
                    <label htmlFor="ai-personas-prompt" className="text-sm text-slate-400 mb-1">
                      Persona Instructions
                    </label>
                    <textarea
                      id="ai-personas-prompt"
                      value={selected.prompt}
                      onChange={(e) => updatePrompt(selected.id, e.target.value)}
                      placeholder={DEFAULT_AI_REWRITE_PERSONA}
                      className="flex-1 min-h-0 w-full bg-slate-700 border border-slate-600 text-slate-200 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none text-sm font-mono placeholder:text-slate-500"
                      data-testid="ai-personas-prompt-textarea"
                    />
                    <p className="text-xs text-slate-500 mt-2">
                      These instructions are added to the system prompt for AI Chat and AI Rewrite whenever this persona is active.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-slate-600 flex-shrink-0">
            <div className="text-sm min-w-0">
              {error ? (
                <span className="text-red-400" data-testid="ai-personas-error">{error}</span>
              ) : dirty ? (
                <span className="text-amber-400 italic" data-testid="ai-personas-dirty">Unsaved changes</span>
              ) : null}
            </div>
            <div className="flex gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={requestRevert}
                disabled={!dirty || saving}
                className={BUTTON_CLASS_DLG_CANCEL}
                data-testid="ai-personas-revert-button"
              >
                Revert
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!dirty || saving}
                className={BUTTON_CLASS_DLG_SAVE}
                data-testid="ai-personas-save-button"
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
