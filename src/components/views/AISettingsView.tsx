import { useEffect, useState, useCallback } from 'react';
import { ChevronRightIcon, PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/solid';
import {
  setAiSettingsScrollPosition,
  getAiSettingsScrollPosition,
} from '../../store';
import type { AIModelConfig, AppConfig, AIUsageWithCosts } from '../../global.d.ts';
import { useScrollPersistence } from '../../utils/useScrollPersistence';
import EditAIModelDialog from '../dialogs/EditAIModelDialog';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import MessageDialog from '../dialogs/MessageDialog';

function AISettingsView() {
  // AI config state (lives on AppConfig, not AppSettings)
  const [aiEnabled, setAiEnabled] = useState<boolean>(false);
  const [aiModels, setAiModels] = useState<AIModelConfig[]>([]);
  const [selectedAiModel, setSelectedAiModel] = useState<string>('');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState<string>('http://localhost:11434');
  const [llamacppBaseUrl, setLlamacppBaseUrl] = useState<string>('http://localhost:8080/v1');
  const [agenticMode, setAgenticMode] = useState<boolean>(false);
  const [agenticAllowedFolders, setAgenticAllowedFolders] = useState<string>('');

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
      if (config.ollamaBaseUrl) setOllamaBaseUrl(config.ollamaBaseUrl);
      if (config.llamacppBaseUrl) setLlamacppBaseUrl(config.llamacppBaseUrl);
      if (config.agenticMode !== undefined) setAgenticMode(config.agenticMode);
      if (config.agenticAllowedFolders !== undefined) setAgenticAllowedFolders(config.agenticAllowedFolders);
    });
    // Load AI usage stats
    window.electronAPI.getAiUsage().then(setUsageData);
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

  const handleOllamaBaseUrlChange = useCallback((url: string) => {
    setOllamaBaseUrl(url);
  }, []);

  const handleOllamaBaseUrlBlur = useCallback(() => {
    void saveAiConfigField({ ollamaBaseUrl });
  }, [ollamaBaseUrl, saveAiConfigField]);

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
                  className="text-sm text-slate-400 hover:text-red-400 transition-colors"
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

                  {selectedModel?.provider === 'OLLAMA' && (
                    <div className="flex items-center gap-2">
                      <label className="text-slate-300 text-sm">Ollama Base URL:</label>
                      <input
                        type="text"
                        value={ollamaBaseUrl}
                        onChange={(e) => handleOllamaBaseUrlChange(e.target.value)}
                        onBlur={handleOllamaBaseUrlBlur}
                        className="bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-80 font-mono text-sm"
                      />
                    </div>
                  )}

                  {selectedModel?.provider === 'LLAMACPP' && (
                    <div className="flex items-center gap-2">
                      <label className="text-slate-300 text-sm">llama.cpp Base URL:</label>
                      <input
                        type="text"
                        value={llamacppBaseUrl}
                        onChange={(e) => handleLlamacppBaseUrlChange(e.target.value)}
                        onBlur={handleLlamacppBaseUrlBlur}
                        className="bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-80 font-mono text-sm"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
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
    </div>
  );
}

export default AISettingsView;
