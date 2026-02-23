import { useEffect, useState, useCallback } from 'react';
import {
  setFontSize,
  setFoldersOnTop,
  setIgnoredPaths,
  setContentWidth,
  setSettingsScrollPosition,
  getSettingsScrollPosition,
  useSettings,
  type FontSize,
  type ContentWidth,
} from '../../store';
import type { AIModelConfig, AppConfig, AIUsageWithCosts } from '../../global.d.ts';
import { useScrollPersistence } from '../../utils/useScrollPersistence';
import EditAIModelDialog from '../dialogs/EditAIModelDialog';
import ConfirmDialog from '../dialogs/ConfirmDialog';

interface FontSizeOption {
  value: FontSize;
  label: string;
}

const fontSizeOptions: FontSizeOption[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'xlarge', label: 'Extra Large' },
];

interface ContentWidthOption {
  value: ContentWidth;
  label: string;
}

const contentWidthOptions: ContentWidthOption[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full Width' },
];

interface SettingsViewProps {
  onSaveSettings: () => void;
}

function SettingsView({ onSaveSettings }: SettingsViewProps) {
  const settings = useSettings();

  // AI config state (lives on AppConfig, not AppSettings)
  const [aiEnabled, setAiEnabled] = useState<boolean>(false);
  const [aiModels, setAiModels] = useState<AIModelConfig[]>([]);
  const [selectedAiModel, setSelectedAiModel] = useState<string>('');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState<string>('http://localhost:11434');
  const [agenticMode, setAgenticMode] = useState<boolean>(false);

  // AI model CRUD dialog state
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingModel, setEditingModel] = useState<AIModelConfig | undefined>(undefined);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [pendingSaveModel, setPendingSaveModel] = useState<AIModelConfig | null>(null);

  // AI usage stats state
  const [usageData, setUsageData] = useState<AIUsageWithCosts | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Load AI config on mount
  useEffect(() => {
    window.electronAPI.getConfig().then((config: AppConfig) => {
      if (config.aiEnabled !== undefined) setAiEnabled(config.aiEnabled);
      if (config.aiModels) setAiModels(config.aiModels);
      if (config.aiModel) setSelectedAiModel(config.aiModel);
      if (config.ollamaBaseUrl) setOllamaBaseUrl(config.ollamaBaseUrl);
      if (config.agenticMode !== undefined) setAgenticMode(config.agenticMode);
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

  // --- AI Model CRUD handlers ---

  const handleCreateModel = useCallback(() => {
    setEditingModel(undefined);
    setShowEditDialog(true);
  }, []);

  const handleEditModel = useCallback(() => {
    const current = aiModels.find((m) => m.name === selectedAiModel);
    if (current) {
      setEditingModel(current);
      setShowEditDialog(true);
    }
  }, [aiModels, selectedAiModel]);

  const applyModelSave = useCallback((model: AIModelConfig) => {
    setAiModels((prev) => {
      const idx = prev.findIndex((m) => m.name === model.name);
      const updated = idx >= 0
        ? prev.map((m, i) => (i === idx ? model : m))
        : [...prev, model];
      void saveAiConfigField({ aiModels: updated, aiModel: model.name });
      return updated;
    });
    setSelectedAiModel(model.name);
    setShowEditDialog(false);
    setPendingSaveModel(null);
  }, [saveAiConfigField]);

  const handleDialogSave = useCallback((model: AIModelConfig) => {
    // Check for name collision (only matters if it's a different entry than what we're editing)
    const isCreate = !editingModel;
    const nameChanged = editingModel && editingModel.name !== model.name;
    const nameExists = aiModels.some((m) => m.name === model.name);

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
  }, [editingModel, aiModels, applyModelSave]);

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
    const updated = aiModels.filter((m) => m.name !== selectedAiModel);
    setAiModels(updated);
    const newSelected = updated.length > 0 ? updated[0].name : '';
    setSelectedAiModel(newSelected);
    void saveAiConfigField({ aiModels: updated, aiModel: newSelected });
    setShowDeleteConfirm(false);
  }, [aiModels, selectedAiModel, saveAiConfigField]);

  const handleResetUsage = useCallback(async () => {
    await window.electronAPI.resetAiUsage();
    const fresh = await window.electronAPI.getAiUsage();
    setUsageData(fresh);
    setShowResetConfirm(false);
  }, []);

  // Scroll position persistence
  const { containerRef: mainContainerRef, handleScroll: handleMainScroll } = useScrollPersistence(
    getSettingsScrollPosition,
    setSettingsScrollPosition
  );

  // Font size is now applied globally via data-font-size attribute on html element

  const handleFontSizeChange = (fontSize: FontSize) => {
    setFontSize(fontSize);
    // Trigger save to persist the setting
    onSaveSettings();
  };

  const handleFoldersOnTopChange = (foldersOnTop: boolean) => {
    setFoldersOnTop(foldersOnTop);
    // Trigger save to persist the setting
    onSaveSettings();
  };

  const handleIgnoredPathsChange = (ignoredPaths: string) => {
    setIgnoredPaths(ignoredPaths);
    // Trigger save to persist the setting
    onSaveSettings();
  };

  const handleContentWidthChange = (contentWidth: ContentWidth) => {
    setContentWidth(contentWidth);
    // Trigger save to persist the setting
    onSaveSettings();
  };

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
          {/* Appearance Setting */}
          <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-slate-100 mb-2">Appearance</h2>
            <p className="text-sm text-slate-400 mb-4">
              Adjust the visual layout of the application.
            </p>

            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <label className="text-slate-300 text-sm">Font Size:</label>
                <select
                  value={settings.fontSize}
                  onChange={(e) => handleFontSizeChange(e.target.value as FontSize)}
                  className="bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                >
                  {fontSizeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-slate-300 text-sm">Content Width:</label>
                <select
                  value={settings.contentWidth}
                  onChange={(e) => handleContentWidthChange(e.target.value as ContentWidth)}
                  className="bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                >
                  {contentWidthOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.foldersOnTop}
                  onChange={(e) => handleFoldersOnTopChange(e.target.checked)}
                  className="w-5 h-5 bg-slate-700 border border-slate-600 rounded text-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                />
                <span className="text-slate-200">Folders on Top</span>
              </label>
            </div>
          </section>

          {/* Ignored Paths Setting */}
          <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-slate-100 mb-2">Files to Ignore</h2>
            <p className="text-sm text-slate-400 mb-4">
              Enter folder or file names to exclude from search results, one per line.
            </p>

            <textarea
              value={settings.ignoredPaths}
              onChange={(e) => handleIgnoredPathsChange(e.target.value)}
              placeholder="node_modules&#10;.git&#10;dist"
              rows={6}
              className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y font-mono text-sm"
            />
          </section>

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

                  <div className="flex items-center gap-2">
                    <label className="text-slate-300 text-sm">AI Model:</label>
                    <select
                      value={selectedAiModel}
                      onChange={(e) => handleAiModelChange(e.target.value)}
                      className="bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                    >
                      {aiModels.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </select>

                    {/* Create / Edit / Delete buttons */}
                    <button
                      onClick={handleCreateModel}
                      title="Create new model"
                      className="p-1.5 text-slate-400 hover:text-green-400 hover:bg-slate-700 rounded transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                        <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                      </svg>
                    </button>
                    <button
                      onClick={handleEditModel}
                      title="Edit selected model"
                      disabled={aiModels.length === 0}
                      className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                        <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      title="Delete selected model"
                      disabled={aiModels.length === 0}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                        <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 01.78.72l.5 6a.75.75 0 01-1.49.12l-.5-6a.75.75 0 01.71-.84zm3.62.72a.75.75 0 10-1.49-.12l-.5 6a.75.75 0 101.49.12l.5-6z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>

                  {aiModels.find((m) => m.name === selectedAiModel)?.provider === 'OLLAMA' && (
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
                </>
              )}
            </div>
          </section>

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

export default SettingsView;