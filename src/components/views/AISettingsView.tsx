import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronRightIcon, PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/solid';
import { api } from '../../renderer/api';
import { logger } from '../../shared/logUtil';
import { saveAiConfig } from '../../renderer/config';
import { useAS, getAiConfig } from '../../store';
import type { AIModelConfig, AppConfig, AIUsageWithCosts } from '../../shared/shared';
import EditableCombobox, { type ComboboxOption } from '../EditableCombobox';
import { DEFAULT_AI_REWRITE_PERSONA } from '../../shared/ai/aiPrompts';
import EditAIModelDialog from '../dialogs/EditAIModelDialog';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import AlertDialog from '../dialogs/AlertDialog';
import CheckboxField from '../dialogs/common/CheckboxField';
import NameInputDialog from '../dialogs/common/NameInputDialog';
import { BUTTON_CLASS_BLUE, BUTTON_CLASS_RED, BUTTON_CLASS_DLG_BLUE, BUTTON_CLASS_DLG_GREEN, BUTTON_CLASS_DLG_RED, SETTINGS_CHECKBOX_CLASS } from '../../renderer/styles';

const DEFAULT_PERSONA_NAME = '[Default Agent]';

/** Model names are matched case-insensitively and ignoring surrounding whitespace. */
const normalizeModelKey = (name: string) => name.trim().toLowerCase();

/**
 * Formats an unknown thrown value for display. Also keeps ternaries out of
 * the component's catch blocks — the React Compiler bails out on value blocks
 * (conditional/logical expressions) inside a try/catch statement.
 */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Starts the local llama.cpp server via IPC and reports status through the
 * given setter. Module-level (not in the component) so its try/catch — with
 * the `??` fallback inside — doesn't make the React Compiler bail out on
 * AISettingsView.
 */
async function startLlamaServerWithStatus(setStatus: (status: string) => void): Promise<void> {
  try {
    const result = await api.startLlamaServer();
    if (result.success) {
      setStatus('running');
    } else {
      setStatus('stopped');
      alert(result.error ?? 'Failed to start server');
    }
  } catch (err) {
    setStatus('stopped');
    alert('Failed to start server: ' + errorMessage(err));
  }
}

/** Formats an elapsed-seconds count as "m:ss" for the server-starting message. */
function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins)}:${secs.toString().padStart(2, '0')}`;
}

/** Stops the local llama.cpp server; see startLlamaServerWithStatus. */
async function stopLlamaServerWithStatus(setStatus: (status: string) => void): Promise<void> {
  try {
    const result = await api.stopLlamaServer();
    if (result.success) {
      setStatus('stopped');
    } else {
      alert(result.error ?? 'Failed to stop server');
    }
  } catch (err) {
    alert('Failed to stop server: ' + errorMessage(err));
  }
}

/**
 * Settings page for all AI-related configuration: enabling AI, selecting and
 * managing model configs, configuring the llama.cpp local server, editing
 * rewrite personas, and viewing per-provider usage statistics.
 *
 * AI config lives on AppConfig (not AppSettings), so it is mirrored into the
 * store via `saveAiConfig` to keep the editor, ThreadView, and this form in sync
 * without a full config reload.
 */
function AISettingsView() {
  // AI config (lives top-level on AppConfig, not AppSettings) is mirrored into
  // the store so this form, the editor, and ThreadView all stay in sync. Read
  // the reactive values here; writes go through saveAiConfigField below.
  const {
    aiEnabled,
    aiModels,
    aiModel: selectedAiModel,
    agenticMode,
    fullDocContext,
    aiRewriteMode,
    aiRewritePrompts,
  } = useAS(s => s.aiConfig);

  // Text fields keep a local buffer for keystroke responsiveness, seeded lazily
  // from the store (nothing else writes them) and persisted on blur.
  const [llamacppBaseUrl, setLlamacppBaseUrl] = useState<string>(() => getAiConfig().llamacppBaseUrl);
  const [agenticAllowedFolders, setAgenticAllowedFolders] = useState<string>(() => getAiConfig().agenticAllowedFolders);
  const [llamacppFolder, setLlamacppFolder] = useState<string>(() => getAiConfig().llamacppFolder);
  const [llamaServerStatus, setLlamaServerStatus] = useState<string>('stopped');
  const [llamaServerBusy, setLlamaServerBusy] = useState(false);
  // Starting the server can take several minutes (the model has to load), so
  // while a start is in flight we show a reassuring message with elapsed time.
  const [llamaStarting, setLlamaStarting] = useState(false);
  const [llamaStartSeconds, setLlamaStartSeconds] = useState(0);

  // Persona editor working state: which persona is being edited + the textarea
  // buffer. Seeded lazily from the store's active persona.
  const [selectedPromptName, setSelectedPromptName] = useState<string>(() => getAiConfig().aiRewritePrompt || DEFAULT_PERSONA_NAME);
  const [promptEditorContent, setPromptEditorContent] = useState<string>(() => {
    const cfg = getAiConfig();
    const name = cfg.aiRewritePrompt || DEFAULT_PERSONA_NAME;
    return name === DEFAULT_PERSONA_NAME
      ? DEFAULT_AI_REWRITE_PERSONA
      : cfg.aiRewritePrompts.find((p) => p.name === name)?.prompt ?? '';
  });
  const [showPromptDeleteConfirm, setShowPromptDeleteConfirm] = useState(false);
  // "New Persona" dialog + the name-collision message it can raise (shown stacked
  // above it, so the name the user typed survives the correction).
  const [showNewPersonaDialog, setShowNewPersonaDialog] = useState(false);
  const [personaNameMessage, setPersonaNameMessage] = useState<string | null>(null);

  // AI model CRUD dialog state
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingModel, setEditingModel] = useState<AIModelConfig | undefined>(undefined);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [pendingSaveModel, setPendingSaveModel] = useState<AIModelConfig | null>(null);
  const [readonlyNameMessage, setReadonlyNameMessage] = useState<string | null>(null);

  // AI usage stats state
  const [usageData, setUsageData] = useState<AIUsageWithCosts | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Model table expand/collapse
  const [modelTableExpanded, setModelTableExpanded] = useState(false);

  // AI config is read reactively from the store (seeded at startup by
  // loadConfig); only the non-config stats/health need fetching here. Views
  // never unmount (App.tsx hides them with CSS), so a mount-only fetch would
  // go stale — re-fetch each time this tab becomes the active view instead.
  const currentView = useAS(s => s.currentView);
  useEffect(() => {
    if (currentView !== 'ai-settings') return;
    let ignore = false;
    void api.getAiUsage().then((data) => {
      if (!ignore) setUsageData(data);
    });
    // While a start is in flight the health endpoint still reports 'stopped'
    // until the model finishes loading — don't let that overwrite our
    // optimistic 'loading' status.
    if (!llamaStarting) {
      void api.checkLlamaHealth().then((status) => {
        if (!ignore) setLlamaServerStatus(status);
      });
    }
    // Returns the useEffect cleanup (an unsubscribe-style teardown): sets the ignore flag so the pending getAiUsage()/checkLlamaHealth() promises can't set state after unmount/re-run.
    return () => { ignore = true; };
  }, [currentView, llamaStarting]);

  // Tick the elapsed-time counter shown in the "server is starting" message.
  useEffect(() => {
    if (!llamaStarting) return;
    const id = setInterval(() => { setLlamaStartSeconds((s) => s + 1); }, 1000);
    return () => { clearInterval(id); };
  }, [llamaStarting]);

  const saveAiConfigField = async (updates: Partial<AppConfig>) => {
    try {
      // saveAiConfig persists AND mirrors the reactive subset into the store, so
      // live consumers (e.g. the editor's AI Rewrite button) update immediately.
      await saveAiConfig(updates);
    } catch {
      // Silently fail — config will be stale until next save
    }
  };

  const handleAiEnabledChange = (enabled: boolean) => {
    void saveAiConfigField({ aiEnabled: enabled });
  };

  const handleAiModelChange = (modelName: string) => {
    void saveAiConfigField({ aiModel: modelName });
  };

  const handleLlamacppBaseUrlBlur = () => {
    void saveAiConfigField({ llamacppBaseUrl });
  };

  // --- AI Model CRUD handlers ---

  const selectedModelKey = normalizeModelKey(selectedAiModel);

  const selectedModel = aiModels.find((m) => normalizeModelKey(m.name) === selectedModelKey);
  const selectedModelIsReadonly = Boolean(selectedModel?.readonly);

  const handleCreateModel = () => {
    setEditingModel(undefined);
    setShowEditDialog(true);
  };

  const handleEditModel = () => {
    const current = aiModels.find((m) => normalizeModelKey(m.name) === selectedModelKey);
    if (current) {
      setEditingModel(current);
      setShowEditDialog(true);
    }
  };

  const applyModelSave = (model: AIModelConfig) => {
    const modelKey = normalizeModelKey(model.name);
    const idx = aiModels.findIndex((m) => normalizeModelKey(m.name) === modelKey);
    const updated = idx >= 0
      ? aiModels.map((m, i) => (i === idx ? model : m))
      : [...aiModels, model];
    void saveAiConfigField({ aiModels: updated, aiModel: model.name });
    setShowEditDialog(false);
    setPendingSaveModel(null);
  };

  /**
   * Validates a model save from EditAIModelDialog and either applies it immediately
   * or routes through a confirmation dialog when the chosen name already exists.
   * Built-in (readonly) models can never be overwritten — an alert is shown instead.
   */
  const handleDialogSave = (model: AIModelConfig) => {
    // Check for name collision (only matters if it's a different entry than what we're editing)
    const isCreate = !editingModel;
    const nameChanged = editingModel && editingModel.name !== model.name;
    const modelKey = normalizeModelKey(model.name);
    const existingMatch = aiModels.find((m) => normalizeModelKey(m.name) === modelKey);
    const nameExists = Boolean(existingMatch);

    // Never allow overwriting a readonly (built-in) model via the UI.
    if (existingMatch?.readonly && (isCreate || nameChanged)) {
      setReadonlyNameMessage(
        `A built-in model named "${existingMatch.name}" already exists and cannot be overwritten.\n\nChoose a different name.`
      );
      return;
    }

    if (nameExists && (isCreate || nameChanged)) {
      // Duplicate name — ask for overwrite confirmation
      setPendingSaveModel(model);
      setShowOverwriteConfirm(true);
      return;
    }

    // If editing and keeping the same name, just update in place
    if (editingModel && !nameChanged) {
      applyModelSave(model);
      return;
    }

    applyModelSave(model);
  };

  const handleOverwriteConfirm = () => {
    if (pendingSaveModel) {
      applyModelSave(pendingSaveModel);
    }
    setShowOverwriteConfirm(false);
  };

  const handleOverwriteCancel = () => {
    setShowOverwriteConfirm(false);
    setPendingSaveModel(null);
    // Re-open the edit dialog so the user can change the name
    setShowEditDialog(true);
  };

  const handleDeleteModel = () => {
    const current = aiModels.find((m) => normalizeModelKey(m.name) === selectedModelKey);
    if (current?.readonly) {
      setShowDeleteConfirm(false);
      return;
    }
    const updated = aiModels.filter((m) => normalizeModelKey(m.name) !== selectedModelKey);
    const newSelected = updated.length > 0 ? updated[0]!.name : ''; 
    void saveAiConfigField({ aiModels: updated, aiModel: newSelected });
    setShowDeleteConfirm(false);
  };

  // --- Persona CRUD handlers ---

  /**
   * Creates an empty persona from the New Persona dialog and selects it, leaving
   * the user in front of an empty editor ready to type the prompt and Save.
   * Names are matched exactly, the same way the Save and Delete buttons match.
   */
  const handleCreatePersona = (name: string) => {
    if (!name) {
      setShowNewPersonaDialog(false);
      return;
    }
    if (name === DEFAULT_PERSONA_NAME || aiRewritePrompts.some((p) => p.name === name)) {
      setPersonaNameMessage(`A persona named "${name}" already exists. Choose a different name.`);
      return;
    }
    setShowNewPersonaDialog(false);
    setSelectedPromptName(name);
    setPromptEditorContent('');
    void saveAiConfigField({
      aiRewritePrompts: [...aiRewritePrompts, { name, prompt: '' }],
      aiRewritePrompt: name,
    });
  };

  /** Writes the editor buffer back to the selected persona. */
  const handleSavePersona = () => {
    const name = selectedPromptName.trim();
    if (!name) return;
    const updated = aiRewritePrompts.filter((p) => p.name !== name);
    updated.push({ name, prompt: promptEditorContent });
    void saveAiConfigField({ aiRewritePrompts: updated, aiRewritePrompt: name });
  };

  // The default agent is built in: it can be selected and used, but not edited,
  // saved over, or deleted. An empty name means nothing is selected (post-delete).
  const personaIsEditable = Boolean(selectedPromptName.trim()) && selectedPromptName !== DEFAULT_PERSONA_NAME;

  // Fire-and-forget: wired directly to the reset-confirmation dialog's
  // `onConfirm` (a `() => void` prop). Uses the sync-signature + internal
  // try/catch convention so a failed IPC reset is surfaced instead of becoming
  // an unhandled rejection.
  const handleResetUsage = () => {
    void (async () => {
      try {
        await api.resetAiUsage();
        const fresh = await api.getAiUsage();
        setUsageData(fresh);
        setShowResetConfirm(false);
      } catch (err) {
        alert('Failed to reset usage: ' + errorMessage(err));
      }
    })();
  };

  /** Starts the local llama.cpp server and updates the displayed status. */
  const startLlama = () => {
    setLlamaServerBusy(true);
    setLlamaStarting(true);
    setLlamaStartSeconds(0);
    setLlamaServerStatus('loading');
    void startLlamaServerWithStatus(setLlamaServerStatus).finally(() => {
      setLlamaServerBusy(false);
      setLlamaStarting(false);
    });
  };

  /** Stops the local llama.cpp server and updates the displayed status. */
  const stopLlama = () => {
    setLlamaServerBusy(true);
    void stopLlamaServerWithStatus(setLlamaServerStatus).finally(() => setLlamaServerBusy(false));
  };

  /** Re-pings the llama.cpp health endpoint and refreshes the displayed status. */
  const refreshLlama = () => {
    void (async () => {
      try {
        const status = await api.checkLlamaHealth();
        setLlamaServerStatus(status);
      } catch (err) {
        logger.error('Failed to refresh llama.cpp status:', err);
      }
    })();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-900">

      {/* Main content */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="space-y-6">

            {/* AI Settings */}
            <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-slate-100 mb-4">AI Settings</h2>
              <div className="flex items-center gap-6">
                <CheckboxField
                  label="Enable AI"
                  checked={aiEnabled}
                  onChange={handleAiEnabledChange}
                  inputClassName={SETTINGS_CHECKBOX_CLASS}
                  spanClassName="text-slate-200"
                />
                {aiEnabled && (
                  <CheckboxField
                    label="Agentic Mode"
                    checked={agenticMode}
                    onChange={(checked) => {
                      void saveAiConfigField({ agenticMode: checked });
                    }}
                    inputClassName={SETTINGS_CHECKBOX_CLASS}
                    spanClassName="text-slate-200"
                  />
                )}
              </div>
            </section>

            {/* AI Usage Statistics */}
            {aiEnabled && usageData && usageData.totalRequests > 0 && (
              <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-100">AI Usage Statistics</h2>
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(true)}
                    className="text-sm text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                  >
                    Reset
                  </button>
                </div>

                {/* Summary row */}
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-slate-750 rounded-lg p-3 border border-slate-600">
                    <div className="text-2xl font-bold text-slate-100">{usageData.totalRequests.toLocaleString()}</div>
                    <div className="text-xs text-slate-400 mt-1">Total Requests</div>
                  </div>
                  <div className="bg-slate-750 rounded-lg p-3 border border-slate-600">
                    <div className="text-2xl font-bold text-slate-100">{(usageData.totalInputTokens + usageData.totalOutputTokens).toLocaleString()}</div>
                    <div className="text-xs text-slate-400 mt-1">Total Tokens</div>
                  </div>
                  <div className="bg-slate-750 rounded-lg p-3 border border-slate-600">
                    <div className="text-2xl font-bold text-green-400">${usageData.totalEstimatedCost.toFixed(4)}</div>
                    <div className="text-xs text-slate-400 mt-1">Est. Total Cost</div>
                  </div>
                </div>

                {/* Per-provider breakdown */}
                {Object.keys(usageData.byProvider).length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-slate-300 mb-2">By Provider</h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-400 text-left">
                          <th className="pb-2 font-medium">Provider</th>
                          <th className="pb-2 font-medium text-right">Requests</th>
                          <th className="pb-2 font-medium text-right">Input Tokens</th>
                          <th className="pb-2 font-medium text-right">Output Tokens</th>
                          <th className="pb-2 font-medium text-right">Est. Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(usageData.byProvider).map(([provider, usage]) => (
                          <tr key={provider} className="text-slate-200 border-t border-slate-700">
                            <td className="py-2 font-mono text-xs">{provider}</td>
                            <td className="py-2 text-right">{usage.requests.toLocaleString()}</td>
                            <td className="py-2 text-right">{usage.inputTokens.toLocaleString()}</td>
                            <td className="py-2 text-right">{usage.outputTokens.toLocaleString()}</td>
                            <td className="py-2 text-right text-green-400">
                              ${(usageData.estimatedCosts[provider] ?? 0).toFixed(4)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* AI Model */}
            {aiEnabled && (
              <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
                <div className="space-y-4">
                  {agenticMode && (
                    <div>
                      <label className="text-slate-300 text-sm block mb-1">Allowed Folders (one absolute path per line):</label>
                      <textarea
                        value={agenticAllowedFolders}
                        onChange={(e) => setAgenticAllowedFolders(e.target.value)}
                        onBlur={() => void saveAiConfigField({ agenticAllowedFolders })}
                        placeholder={"/home/user/projects\n/home/user/documents"}
                        rows={4}
                        className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y font-mono text-sm"
                        data-testid="ai-agentic-allowed-folders-textarea"
                      />
                    </div>
                  )}

                  {/* AI Model — collapsed: show selected name; expanded: full table */}
                  <div>
                    {!modelTableExpanded && selectedAiModel && (
                      <div className="text-lg font-semibold text-slate-100 mb-1">AI Model: {selectedAiModel}</div>
                    )}
                    <button
                      type="button"
                      onClick={() => setModelTableExpanded((v) => !v)}
                      className="flex items-center gap-2 text-slate-300 text-sm font-medium hover:text-slate-100 transition-colors"
                    >
                      <ChevronRightIcon
                        className={clsx('w-4 h-4 transition-transform', modelTableExpanded && 'rotate-90')}
                      />
                      <span>{modelTableExpanded ? 'Hide models' : 'Change model'}</span>
                    </button>
                  </div>

                  {modelTableExpanded && (
                    <div className="space-y-2">
                      {/* Action buttons */}
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={handleCreateModel}
                          title="Create new model"
                          className="p-1.5 text-slate-400 hover:text-green-400 hover:bg-slate-700 rounded transition-colors"
                          data-testid="ai-settings-create-model-button"
                        >
                          <PlusIcon className="w-5 h-5" />
                        </button>
                        <button
                          type="button"
                          onClick={handleEditModel}
                          title="Edit selected model"
                          disabled={aiModels.length === 0}
                          className={BUTTON_CLASS_BLUE}
                          data-testid="ai-settings-edit-model-button"
                        >
                          <PencilIcon className="w-5 h-5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedModelIsReadonly) setShowDeleteConfirm(true);
                          }}
                          title="Delete selected model"
                          disabled={aiModels.length === 0 || selectedModelIsReadonly}
                          className={BUTTON_CLASS_RED}
                          data-testid="ai-settings-delete-model-button"
                        >
                          <TrashIcon className="w-5 h-5" />
                        </button>
                      </div>

                      {/* AI Models table with radio selection */}
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-slate-400 text-left">
                            <th className="pb-2 w-8"></th>
                            <th className="pb-2 font-medium">Name</th>
                            <th className="pb-2 font-medium">Provider</th>
                            <th className="pb-2 font-medium">Model</th>
                            <th className="pb-2 font-medium text-center">Vision</th>
                            <th className="pb-2 font-medium text-right">Input $/1M</th>
                            <th className="pb-2 font-medium text-right">Output $/1M</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiModels.map((m) => {
                            const isSelected = normalizeModelKey(m.name) === selectedModelKey;
                            return (
                              <tr
                                key={m.name}
                                onClick={() => handleAiModelChange(m.name)}
                                className={clsx('text-slate-200 border-t border-slate-700 cursor-pointer transition-colors hover:bg-slate-700/30', isSelected && 'bg-slate-700/50')}
                              >
                                <td className="py-2 text-center">
                                  <input
                                    type="radio"
                                    name="ai-model-select"
                                    checked={isSelected}
                                    onChange={() => handleAiModelChange(m.name)}
                                    className="w-5 h-5 cursor-pointer accent-blue-500"
                                    data-testid={`ai-model-radio-${m.name}`}
                                  />
                                </td>
                                <td className="py-2 font-mono text-xs">{m.name}</td>
                                <td className="py-2 font-mono text-xs">{m.provider}</td>
                                <td className="py-2 font-mono text-xs">{m.model}</td>
                                <td className="py-2 text-center text-green-400">{m.vision ? '✓' : ''}</td>
                                <td className="py-2 text-right text-green-400">${m.inputPer1M.toFixed(2)}</td>
                                <td className="py-2 text-right text-green-400">${m.outputPer1M.toFixed(2)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {selectedModel?.provider === 'LLAMACPP' && (
                    <div className="space-y-3 bg-slate-750 rounded-lg p-4 border border-slate-600">
                      <h3 className="text-sm font-medium text-slate-300">llama.cpp Server</h3>

                      {/* Server status + controls */}
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400 text-sm">Status:</span>
                        <span className={clsx(
                          'text-sm font-medium',
                          llamaServerStatus === 'running' ? 'text-green-400' :
                            llamaServerStatus === 'loading' ? 'text-yellow-400' :
                              'text-slate-500',
                        )}>
                          {llamaServerStatus === 'running' ? 'Running' :
                            llamaServerStatus === 'loading' ? 'Loading model…' :
                              'Stopped'}
                        </span>
                        <button
                          type="button"
                          disabled={llamaServerBusy || llamaServerStatus === 'running' || llamaServerStatus === 'loading'}
                          onClick={startLlama}
                          className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded transition-colors"
                          data-testid="llama-server-start-button"
                        >
                          Start
                        </button>
                        <button
                          type="button"
                          disabled={llamaServerBusy || llamaServerStatus === 'stopped'}
                          onClick={stopLlama}
                          className="px-3 py-1 text-xs bg-red-700 hover:bg-red-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded transition-colors"
                          data-testid="llama-server-stop-button"
                        >
                          Stop
                        </button>
                        <button
                          type="button"
                          disabled={llamaServerBusy}
                          onClick={refreshLlama}
                          className="px-3 py-1 text-xs bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 text-slate-200 rounded transition-colors"
                          data-testid="llama-server-refresh-button"
                        >
                          Refresh
                        </button>
                      </div>

                      {llamaStarting && (
                        <p
                          className="text-xs text-yellow-400/90 leading-relaxed"
                          data-testid="llama-server-starting-message"
                        >
                          Starting the server and loading the model into memory — this can take
                          several minutes, especially on the first start after booting. You can keep
                          using the rest of the app while you wait; this page will show
                          &ldquo;Running&rdquo; as soon as the server is ready.
                          {' '}
                          <span className="font-mono text-yellow-300">
                            ({formatElapsed(llamaStartSeconds)} elapsed)
                          </span>
                        </p>
                      )}

                      {/* Base URL */}
                      <div className="flex items-center gap-2">
                        <label className="text-slate-300 text-sm whitespace-nowrap">Base URL:</label>
                        <input
                          type="text"
                          value={llamacppBaseUrl}
                          onChange={(e) => setLlamacppBaseUrl(e.target.value)}
                          onBlur={handleLlamacppBaseUrlBlur}
                          className="bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 flex-1 font-mono text-sm"
                          data-testid="llamacpp-base-url-input"
                        />
                      </div>

                      {/* llama-deck folder path (separate project the user installs) */}
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <label className="text-slate-300 text-sm whitespace-nowrap">llama-deck folder:</label>
                          <input
                            type="text"
                            value={llamacppFolder}
                            onChange={(e) => setLlamacppFolder(e.target.value)}
                            onBlur={() => void saveAiConfigField({ llamacppFolder })}
                            placeholder="/path/to/llama-deck"
                            className="bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 flex-1 font-mono text-sm"
                            data-testid="llamacpp-folder-input"
                          />
                        </div>
                        <p className="text-xs italic text-slate-400">
                          Location where llama-deck (https://github.com/Clay-Ferguson/llama-deck) files are located
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Personas */}
            {aiEnabled && (
              <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
                <h2 className="text-lg font-semibold text-slate-100 mb-4">AI Personas</h2>
                <div>
                  {/* Combobox row: persona selector + New + Save + Delete */}
                  <div className="flex gap-3 mb-3">
                    {/* Select-only (no onChange): personas are created through the
                        New Persona button, not by typing a name in here. */}
                    <EditableCombobox
                      data-testid="ai-persona-combobox"
                      value={selectedPromptName}
                      onSelect={(option: ComboboxOption) => {
                        setSelectedPromptName(option.value);
                        if (option.value === DEFAULT_PERSONA_NAME) {
                          setPromptEditorContent(DEFAULT_AI_REWRITE_PERSONA);
                        } else {
                          const matched = aiRewritePrompts.find((p) => p.name === option.value);
                          setPromptEditorContent(matched?.prompt ?? '');
                        }
                        void saveAiConfigField({ aiRewritePrompt: option.value });
                      }}
                      options={[
                        { value: DEFAULT_PERSONA_NAME, label: DEFAULT_PERSONA_NAME },
                        ...[...aiRewritePrompts]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((p) => ({ value: p.name, label: p.name })),
                      ]}
                      placeholder="Select a persona..."
                      className="flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPersonaDialog(true)}
                      className={clsx(BUTTON_CLASS_DLG_BLUE, 'whitespace-nowrap')}
                      data-testid="ai-persona-new-button"
                    >
                      New
                    </button>
                    <button
                      type="button"
                      disabled={!personaIsEditable}
                      onClick={handleSavePersona}
                      className={BUTTON_CLASS_DLG_GREEN}
                      data-testid="ai-persona-save-button"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={!personaIsEditable || !aiRewritePrompts.some((p) => p.name === selectedPromptName)}
                      onClick={() => setShowPromptDeleteConfirm(true)}
                      className={BUTTON_CLASS_DLG_RED}
                      data-testid="ai-persona-delete-button"
                    >
                      Delete
                    </button>
                  </div>
                  {/* Prompt text editor */}
                  <textarea
                    value={promptEditorContent}
                    onChange={(e) => setPromptEditorContent(e.target.value)}
                    disabled={!personaIsEditable}
                    rows={5}
                    placeholder={DEFAULT_AI_REWRITE_PERSONA}
                    className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y overflow-y-auto text-base font-mono disabled:opacity-40 disabled:cursor-not-allowed placeholder:text-slate-500"
                    data-testid="ai-persona-prompt-textarea"
                  />
                </div>
              </section>
            )}

            {/* AI Rewrite Options */}
            {aiEnabled && (
              <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
                <h2 className="text-lg font-semibold text-slate-100 mb-4">AI Rewrite Options</h2>
                <div className="flex items-center gap-6">
                  <CheckboxField
                    label="Enable AI Rewrite"
                    checked={aiRewriteMode}
                    onChange={(checked) => {
                      void saveAiConfigField({ aiRewriteMode: checked });
                    }}
                    inputClassName={SETTINGS_CHECKBOX_CLASS}
                    spanClassName="text-slate-200"
                    testId="enable-ai-rewrite"
                  />
                  {aiRewriteMode && (
                    <CheckboxField
                      label="Rewrite using Full Doc Context"
                      checked={fullDocContext}
                      onChange={(checked) => {
                        void saveAiConfigField({ fullDocContext: checked });
                      }}
                      inputClassName={SETTINGS_CHECKBOX_CLASS}
                      spanClassName="text-slate-200"
                      testId="rewrite-using-full-doc-context"
                    />
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      </main>

      {/* Edit / Create AI Model dialog */}
      {showEditDialog && (
        <EditAIModelDialog
          initialModel={editingModel}
          onSave={handleDialogSave}
          onCancel={() => setShowEditDialog(false)}
        />
      )}

      {/* Readonly name collision message */}
      {readonlyNameMessage && (
        <AlertDialog
          preserveWhitespace
          title="Cannot Overwrite Model"
          message={readonlyNameMessage}
          onClose={() => setReadonlyNameMessage(null)}
        />
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <ConfirmDialog
          message={`Delete model "${selectedAiModel}"?`}
          onConfirm={handleDeleteModel}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* Overwrite confirmation (duplicate name) */}
      {showOverwriteConfirm && pendingSaveModel && (
        <ConfirmDialog
          message={`A model named "${pendingSaveModel.name}" already exists. Overwrite it?`}
          onConfirm={handleOverwriteConfirm}
          onCancel={handleOverwriteCancel}
        />
      )}

      {/* Reset usage confirmation */}
      {showResetConfirm && (
        <ConfirmDialog
          message="Reset all AI usage statistics to zero? This cannot be undone."
          onConfirm={handleResetUsage}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}

      {/* New persona name prompt */}
      {showNewPersonaDialog && (
        <NameInputDialog
          title="New Persona"
          label="Persona name"
          placeholder="e.g. Hemingway"
          normalizeName={(raw) => raw.trim()}
          onCreate={handleCreatePersona}
          onCancel={() => setShowNewPersonaDialog(false)}
          inputTestId="new-persona-dialog-input"
          createTestId="new-persona-dialog-create-button"
        />
      )}

      {/* Persona name collision message (stacked over the New Persona dialog) */}
      {personaNameMessage && (
        <AlertDialog
          title="Name Already Used"
          message={personaNameMessage}
          onClose={() => setPersonaNameMessage(null)}
        />
      )}

      {/* Delete rewrite prompt confirmation */}
      {showPromptDeleteConfirm && (
        <ConfirmDialog
          message={`Delete prompt "${selectedPromptName}"?`}
          onConfirm={() => {
            const updated = aiRewritePrompts.filter((p) => p.name !== selectedPromptName);
            setSelectedPromptName('');
            setPromptEditorContent('');
            setShowPromptDeleteConfirm(false);
            void saveAiConfigField({ aiRewritePrompts: updated, aiRewritePrompt: undefined });
          }}
          onCancel={() => setShowPromptDeleteConfirm(false)}
        />
      )}
    </div>
  );
}

export default AISettingsView;
