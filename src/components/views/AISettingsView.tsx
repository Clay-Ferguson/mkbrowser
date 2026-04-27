import { useEffect, useState, useCallback } from 'react';
import { ChevronRightIcon, PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/solid';
import {
  setAiSettingsScrollPosition,
  getAiSettingsScrollPosition,
} from '../../store';
import type { AIModelConfig, AIRewritePromptDef, AppConfig, AIUsageWithCosts } from '../../global.d.ts';
import EditableCombobox, { type ComboboxOption } from '../EditableCombobox';
import { useScrollPersistence } from '../../utils/useScrollPersistence';
import { DEFAULT_AI_REWRITE_PERSONA } from '../../ai/aiPrompts';
import EditAIModelDialog from '../dialogs/EditAIModelDialog';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import MessageDialog from '../dialogs/MessageDialog';

function AISettingsView() {
  // AI config state (lives on AppConfig, not AppSettings)
  const [aiEnabled, setAiEnabled] = useState<boolean>(false);
  const [aiModels, setAiModels] = useState<AIModelConfig[]>([]);
  const [selectedAiModel, setSelectedAiModel] = useState<string>('');
  const [llamacppBaseUrl, setLlamacppBaseUrl] = useState<string>('http://localhost:8080/v1');
  const [agenticMode, setAgenticMode] = useState<boolean>(false);
  const [agenticAllowedFolders, setAgenticAllowedFolders] = useState<string>('');
  const [llamacppFolder, setLlamacppFolder] = useState<string>('');
  const [llamaServerStatus, setLlamaServerStatus] = useState<string>('stopped');
  const [llamaServerBusy, setLlamaServerBusy] = useState(false);
  const [selectedPromptName, setSelectedPromptName] = useState<string>('');
  const [aiRewritePrompts, setAiRewritePrompts] = useState<AIRewritePromptDef[]>([]);
  const [promptEditorContent, setPromptEditorContent] = useState<string>('');
  const [showPromptDeleteConfirm, setShowPromptDeleteConfirm] = useState(false);
  const [fullDocContext, setFullDocContext] = useState<boolean>(false);

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

  // Load AI config on mount
  useEffect(() => {
    window.electronAPI.getConfig().then((config: AppConfig) => {
      if (config.aiEnabled !== undefined) setAiEnabled(config.aiEnabled);
      if (config.aiModels) setAiModels(config.aiModels);
      if (config.aiModel) setSelectedAiModel(config.aiModel);
      if (config.llamacppBaseUrl) setLlamacppBaseUrl(config.llamacppBaseUrl);
      if (config.llamacppFolder) setLlamacppFolder(config.llamacppFolder);
      if (config.agenticMode !== undefined) setAgenticMode(config.agenticMode);
      if (config.agenticAllowedFolders !== undefined) setAgenticAllowedFolders(config.agenticAllowedFolders);
      if (config.fullDocContext !== undefined) setFullDocContext(config.fullDocContext);
      const savedName = config.aiRewritePrompt ?? '';
      const savedPrompts = config.aiRewritePrompts ?? [];
      setSelectedPromptName(savedName);
      setAiRewritePrompts(savedPrompts);
      const matched = savedName ? savedPrompts.find((p) => p.name === savedName) : undefined;
      setPromptEditorContent(matched?.prompt ?? '');
    });
    // Load AI usage stats
    window.electronAPI.getAiUsage().then(setUsageData);
    // Check llama.cpp server status
    window.electronAPI.checkLlamaHealth().then(setLlamaServerStatus);
  }, []);

  const saveAiConfigField = useCallback(async (updates: Partial<AppConfig>) => {
    try {
      const config = await window.electronAPI.getConfig();
      await window.electronAPI.saveConfig({ ...config, ...updates });
    } catch {
      // Silently fail — config will be stale until next save
    }
  }, []);

  const handleAiEnabledChange = useCallback((enabled: boolean) => {
    setAiEnabled(enabled);
    void saveAiConfigField({ aiEnabled: enabled });
  }, [saveAiConfigField]);

  const handleAiModelChange = useCallback((modelName: string) => {
    setSelectedAiModel(modelName);
    void saveAiConfigField({ aiModel: modelName });
  }, [saveAiConfigField]);

  const handleLlamacppBaseUrlChange = useCallback((url: string) => {
    setLlamacppBaseUrl(url);
  }, []);

  const handleLlamacppBaseUrlBlur = useCallback(() => {
    void saveAiConfigField({ llamacppBaseUrl });
  }, [llamacppBaseUrl, saveAiConfigField]);

  // --- AI Model CRUD handlers ---

  const normalizeModelKey = useCallback((name: string) => name.trim().toLowerCase(), []);

  const selectedModel = aiModels.find((m) => normalizeModelKey(m.name) === normalizeModelKey(selectedAiModel));
  const selectedModelIsReadonly = Boolean(selectedModel?.readonly);

  const handleCreateModel = useCallback(() => {
    setEditingModel(undefined);
    setShowEditDialog(true);
  }, []);

  const handleEditModel = useCallback(() => {
    const current = aiModels.find((m) => normalizeModelKey(m.name) === normalizeModelKey(selectedAiModel));
    if (current) {
      setEditingModel(current);
      setShowEditDialog(true);
    }
  }, [aiModels, selectedAiModel, normalizeModelKey]);

  const applyModelSave = useCallback((model: AIModelConfig) => {
    setAiModels((prev) => {
      const modelKey = normalizeModelKey(model.name);
      const idx = prev.findIndex((m) => normalizeModelKey(m.name) === modelKey);
      const updated = idx >= 0
        ? prev.map((m, i) => (i === idx ? model : m))
        : [...prev, model];
      void saveAiConfigField({ aiModels: updated, aiModel: model.name });
      return updated;
    });
    setSelectedAiModel(model.name);
    setShowEditDialog(false);
    setPendingSaveModel(null);
  }, [saveAiConfigField, normalizeModelKey]);

  const handleDialogSave = useCallback((model: AIModelConfig) => {
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
  }, [editingModel, aiModels, applyModelSave, normalizeModelKey]);

  const handleOverwriteConfirm = useCallback(() => {
    if (pendingSaveModel) {
      applyModelSave(pendingSaveModel);
    }
    setShowOverwriteConfirm(false);
  }, [pendingSaveModel, applyModelSave]);

  const handleOverwriteCancel = useCallback(() => {
    setShowOverwriteConfirm(false);
    setPendingSaveModel(null);
    // Re-open the edit dialog so the user can change the name
    setShowEditDialog(true);
  }, []);

  const handleDeleteModel = useCallback(() => {
    const current = aiModels.find((m) => normalizeModelKey(m.name) === normalizeModelKey(selectedAiModel));
    if (current?.readonly) {
      setShowDeleteConfirm(false);
      return;
    }
    const updated = aiModels.filter((m) => m.name !== selectedAiModel);
    setAiModels(updated);
    const newSelected = updated.length > 0 ? updated[0].name : '';
    setSelectedAiModel(newSelected);
    void saveAiConfigField({ aiModels: updated, aiModel: newSelected });
    setShowDeleteConfirm(false);
  }, [aiModels, selectedAiModel, saveAiConfigField, normalizeModelKey]);

  const handleResetUsage = useCallback(async () => {
    await window.electronAPI.resetAiUsage();
    const fresh = await window.electronAPI.getAiUsage();
    setUsageData(fresh);
    setShowResetConfirm(false);
  }, []);

  // Scroll position persistence
  const { containerRef: mainContainerRef, handleScroll: handleMainScroll } = useScrollPersistence(
    getAiSettingsScrollPosition,
    setAiSettingsScrollPosition
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-900">

      {/* Main content */}
      <main
        ref={mainContainerRef}
        onScroll={handleMainScroll}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="space-y-6">
          {/* AI Usage Statistics */}
          {aiEnabled && usageData && usageData.totalRequests > 0 && (
            <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-100">AI Usage Statistics</h2>
                <button
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

          {/* AI Settings */}
          <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-slate-100 mb-2">AI Settings</h2>

            <div className="space-y-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  onChange={(e) => handleAiEnabledChange(e.target.checked)}
                  className="w-5 h-5 bg-slate-700 border border-slate-600 rounded text-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                />
                <span className="text-slate-200">Enable AI Features</span>
              </label>

              {aiEnabled && (
                <>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agenticMode}
                      onChange={(e) => {
                        setAgenticMode(e.target.checked);
                        saveAiConfigField({ agenticMode: e.target.checked });
                      }}
                      className="w-5 h-5 bg-slate-700 border border-slate-600 rounded text-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                    />
                    <span className="text-slate-200">Agentic Mode</span>
                  </label>

                  {agenticMode && (
                    <div>
                      <label className="text-slate-300 text-sm block mb-1">Allowed Folders (one absolute path per line):</label>
                      <textarea
                        value={agenticAllowedFolders}
                        onChange={(e) => setAgenticAllowedFolders(e.target.value)}
                        onBlur={() => saveAiConfigField({ agenticAllowedFolders })}
                        placeholder={"/home/user/projects\n/home/user/documents"}
                        rows={4}
                        className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y font-mono text-sm"
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
                        className={`w-4 h-4 transition-transform ${modelTableExpanded ? 'rotate-90' : ''}`}
                      />
                      <span>{modelTableExpanded ? 'Hide models' : 'Change model'}</span>
                    </button>
                  </div>

                  {modelTableExpanded && (
                    <div className="space-y-2">
                      {/* Action buttons */}
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={handleCreateModel}
                          title="Create new model"
                          className="p-1.5 text-slate-400 hover:text-green-400 hover:bg-slate-700 rounded transition-colors"
                        >
                          <PlusIcon className="w-5 h-5" />
                        </button>
                        <button
                          onClick={handleEditModel}
                          title="Edit selected model"
                          disabled={aiModels.length === 0}
                          className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <PencilIcon className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => {
                            if (!selectedModelIsReadonly) setShowDeleteConfirm(true);
                          }}
                          title="Delete selected model"
                          disabled={aiModels.length === 0 || selectedModelIsReadonly}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                            const isSelected = normalizeModelKey(m.name) === normalizeModelKey(selectedAiModel);
                            return (
                              <tr
                                key={m.name}
                                onClick={() => handleAiModelChange(m.name)}
                                className={`text-slate-200 border-t border-slate-700 cursor-pointer transition-colors hover:bg-slate-700/30 ${isSelected ? 'bg-slate-700/50' : ''}`}
                              >
                                <td className="py-2 text-center">
                                  <input
                                    type="radio"
                                    name="ai-model-select"
                                    checked={isSelected}
                                    onChange={() => handleAiModelChange(m.name)}
                                    className="w-5 h-5 cursor-pointer accent-blue-500"
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
                        <span className={`text-sm font-medium ${
                          llamaServerStatus === 'running' ? 'text-green-400' :
                          llamaServerStatus === 'loading' ? 'text-yellow-400' :
                          'text-slate-500'
                        }`}>
                          {llamaServerStatus === 'running' ? 'Running' :
                           llamaServerStatus === 'loading' ? 'Loading model…' :
                           'Stopped'}
                        </span>
                        <button
                          disabled={llamaServerBusy || llamaServerStatus === 'running' || llamaServerStatus === 'loading'}
                          onClick={async () => {
                            setLlamaServerBusy(true);
                            setLlamaServerStatus('loading');
                            const result = await window.electronAPI.startLlamaServer();
                            if (result.success) {
                              setLlamaServerStatus('running');
                            } else {
                              setLlamaServerStatus('stopped');
                              alert(result.error ?? 'Failed to start server');
                            }
                            setLlamaServerBusy(false);
                          }}
                          className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded transition-colors"
                        >
                          Start
                        </button>
                        <button
                          disabled={llamaServerBusy || llamaServerStatus === 'stopped'}
                          onClick={async () => {
                            setLlamaServerBusy(true);
                            const result = await window.electronAPI.stopLlamaServer();
                            if (result.success) {
                              setLlamaServerStatus('stopped');
                            } else {
                              alert(result.error ?? 'Failed to stop server');
                            }
                            setLlamaServerBusy(false);
                          }}
                          className="px-3 py-1 text-xs bg-red-700 hover:bg-red-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded transition-colors"
                        >
                          Stop
                        </button>
                        <button
                          disabled={llamaServerBusy}
                          onClick={async () => {
                            const status = await window.electronAPI.checkLlamaHealth();
                            setLlamaServerStatus(status);
                          }}
                          className="px-3 py-1 text-xs bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 text-slate-200 rounded transition-colors"
                        >
                          Refresh
                        </button>
                      </div>

                      {/* Base URL */}
                      <div className="flex items-center gap-2">
                        <label className="text-slate-300 text-sm whitespace-nowrap">Base URL:</label>
                        <input
                          type="text"
                          value={llamacppBaseUrl}
                          onChange={(e) => handleLlamacppBaseUrlChange(e.target.value)}
                          onBlur={handleLlamacppBaseUrlBlur}
                          className="bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 flex-1 font-mono text-sm"
                        />
                      </div>

                      {/* Llama.cpp folder path */}
                      <div className="flex items-center gap-2">
                        <label className="text-slate-300 text-sm whitespace-nowrap">Llama.cpp folder:</label>
                        <input
                          type="text"
                          value={llamacppFolder}
                          onChange={(e) => setLlamacppFolder(e.target.value)}
                          onBlur={() => saveAiConfigField({ llamacppFolder })}
                          placeholder="/path/to/llamacpp"
                          className="bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 flex-1 font-mono text-sm"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* Prompts */}
          {aiEnabled && (
            <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-slate-100 mb-4">Rewrite Settings</h2>
              <div>
                <label className="text-slate-300 text-sm block mb-2">Persona</label>
                {/* Combobox row: name selector + Save + Delete */}
                <div className="flex gap-3 mb-3">
                  <EditableCombobox
                    value={selectedPromptName}
                    onChange={(name) => {
                      setSelectedPromptName(name);
                      // If the typed name no longer matches a saved prompt, clear the editor
                      const matched = aiRewritePrompts.find((p) => p.name === name);
                      setPromptEditorContent(matched?.prompt ?? '');
                    }}
                    onSelect={(option: ComboboxOption) => {
                      setSelectedPromptName(option.value);
                      const matched = aiRewritePrompts.find((p) => p.name === option.value);
                      setPromptEditorContent(matched?.prompt ?? '');
                    }}
                    options={[...aiRewritePrompts]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((p) => ({ value: p.name, label: p.name }))}
                    placeholder="Enter a name or select existing..."
                    className="flex-1"
                  />
                  <button
                    type="button"
                    disabled={!selectedPromptName.trim()}
                    onClick={() => {
                      const name = selectedPromptName.trim();
                      if (!name) return;
                      const updated = aiRewritePrompts.filter((p) => p.name !== name);
                      updated.push({ name, prompt: promptEditorContent });
                      setAiRewritePrompts(updated);
                      void saveAiConfigField({ aiRewritePrompts: updated, aiRewritePrompt: name });
                    }}
                    className="px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-500 disabled:bg-green-600/50 disabled:cursor-not-allowed rounded transition-colors"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={!selectedPromptName.trim() || !aiRewritePrompts.some((p) => p.name === selectedPromptName)}
                    onClick={() => setShowPromptDeleteConfirm(true)}
                    className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 disabled:bg-red-600/50 disabled:cursor-not-allowed rounded transition-colors"
                  >
                    Delete
                  </button>
                </div>
                {/* Prompt text editor */}
                <textarea
                  value={promptEditorContent}
                  onChange={(e) => setPromptEditorContent(e.target.value)}
                  disabled={!selectedPromptName.trim()}
                  rows={5}
                  placeholder={DEFAULT_AI_REWRITE_PERSONA}
                  className="w-full bg-slate-700 border border-slate-600 text-slate-200 px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y overflow-y-auto text-base font-mono disabled:opacity-40 disabled:cursor-not-allowed placeholder:text-slate-500"
                />
                <button
                  type="button"
                  disabled={!selectedPromptName.trim()}
                  onClick={() => setPromptEditorContent(DEFAULT_AI_REWRITE_PERSONA)}
                  className="mt-2 px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-slate-100 border border-slate-600 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Reset to Default
                </button>
              </div>
              <label className="flex items-center gap-2 cursor-pointer mt-4">
                <input
                  type="checkbox"
                  checked={fullDocContext}
                  onChange={(e) => {
                    setFullDocContext(e.target.checked);
                    void saveAiConfigField({ fullDocContext: e.target.checked });
                  }}
                  className="w-5 h-5 bg-slate-700 border border-slate-600 rounded text-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                />
                <span className="text-slate-200">Full Document Context</span>
              </label>
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
        <MessageDialog
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

      {/* Delete rewrite prompt confirmation */}
      {showPromptDeleteConfirm && (
        <ConfirmDialog
          message={`Delete prompt "${selectedPromptName}"?`}
          onConfirm={() => {
            const updated = aiRewritePrompts.filter((p) => p.name !== selectedPromptName);
            setAiRewritePrompts(updated);
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
