import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { api } from '../../renderer/api';
import { saveAiConfig } from '../../renderer/config';
import { runOp } from '../../renderer/runOp';
import { logger } from '../../shared/logUtil';
import { setCurrentView, showTab, useAS, useIsActiveView } from '../../store';
import type { AppConfig, AIUsageWithCosts } from '../../shared/shared';
import EditableCombobox, { type ComboboxOption } from '../EditableCombobox';
import { DEFAULT_PERSONA_NAME } from '../../shared/ai/aiPrompts';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import CheckboxField from '../dialogs/common/CheckboxField';
import { BUTTON_CLASS_DLG_BLUE, BUTTON_CLASS_LINK_RED, SETTINGS_CHECKBOX_CLASS } from '../../renderer/styles';

/**
 * Settings page for all AI-related configuration: enabling AI, choosing the
 * active model (models themselves are defined on the AI Models tab, opened by
 * the "Configure Models" button here), choosing the active persona (defined on
 * the AI Personas tab, opened by "Configure Personas"), and viewing per-model
 * usage statistics.
 *
 * AI config lives on AppConfig (not AppSettings), so it is mirrored into the
 * store via `saveAiConfig` to keep the editor, ThreadView, and this form in sync
 * without a full config reload.
 *
 * See: (USER_GUIDE.md#ai-settings)
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
    aiRewritePrompt,
    aiRewritePrompts,
    agenticAllowedFolders: storedAgenticAllowedFolders,
  } = useAS(s => s.aiConfig);
  // The active persona is always read from the store (ThreadView can change it
  // too). See: (ai_chat.md#what-the-view-shows)
  const personaName = aiRewritePrompt || DEFAULT_PERSONA_NAME;

  // The Allowed Folders textarea keeps a local draft for keystroke
  // responsiveness, persisted on blur. The store stays the source of truth: when
  // its value changes under us (e.g. saveAiConfig rolling back a failed write)
  // the draft is resynced.
  const [agenticAllowedFolders, setAgenticAllowedFolders] = useState(storedAgenticAllowedFolders);
  const [prevStoredFolders, setPrevStoredFolders] = useState(storedAgenticAllowedFolders);
  if (prevStoredFolders !== storedAgenticAllowedFolders) {
    setPrevStoredFolders(storedAgenticAllowedFolders);
    setAgenticAllowedFolders(storedAgenticAllowedFolders);
  }

  // AI usage stats state
  const [usageData, setUsageData] = useState<AIUsageWithCosts | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // AI config is read reactively from the store (seeded at startup by
  // loadConfig); only the non-config usage stats need fetching here. Views
  // never unmount (App.tsx hides them with CSS), so a mount-only fetch would
  // go stale — re-fetch each time this tab becomes the active view instead.
  // See: (application_tabs.md#hidden-views-are-live)
  const isActive = useIsActiveView('ai-settings');
  useEffect(() => {
    if (!isActive) return;
    let ignore = false;
    // Background refresh the user didn't explicitly ask for, so a failure is logged, not shown.
    api.getAiUsage()
      .then((data) => {
        if (!ignore) setUsageData(data);
      })
      .catch((err: unknown) => logger.error('Failed to load AI usage stats:', err));
    // Returns the useEffect cleanup (an unsubscribe-style teardown): sets the ignore flag so the pending getAiUsage() promise can't set state after unmount/re-run.
    return () => { ignore = true; };
  }, [isActive]);

  // saveAiConfig persists AND mirrors the reactive subset into the store, so
  // live consumers (e.g. the editor's AI Rewrite button) update immediately.
  // The store updates optimistically; a failed write is rolled back and
  // reported by runOp.
  const saveAiConfigField = (updates: Partial<AppConfig>) => {
    runOp(() => saveAiConfig(updates), 'Failed to save AI settings: ');
  };

  // Enable AI Features checkbox. See: (USER_GUIDE.md#enable-ai-features)
  const handleAiEnabledChange = (enabled: boolean) => {
    saveAiConfigField({ aiEnabled: enabled });
  };

  // Active model dropdown. See: (USER_GUIDE.md#ai-model)
  const handleAiModelChange = (modelName: string) => {
    saveAiConfigField({ aiModel: modelName });
  };

  // Opens the AI Models tab — its only entry point. See: (USER_GUIDE.md#configuring-ai-models)
  const handleConfigureModels = () => {
    showTab('ai-models');
    setCurrentView('ai-models');
  };

  // Persona dropdown. See: (USER_GUIDE.md#selecting-the-active-persona)
  const handlePersonaSelect = (name: string) => {
    saveAiConfigField({ aiRewritePrompt: name });
  };

  // Opens the AI Personas tab — its only entry point. See: (USER_GUIDE.md#configuring-personas)
  const handleConfigurePersonas = () => {
    showTab('ai-personas');
    setCurrentView('ai-personas');
  };

  // Wired directly to the reset-confirmation dialog's `onConfirm` (a `() => void`
  // prop); runOp reports a failed IPC reset through the app error dialog.
  // See: (USER_GUIDE.md#ai-usage-statistics)
  const handleResetUsage = () => {
    runOp(async () => {
      await api.resetAiUsage();
      const fresh = await api.getAiUsage();
      setUsageData(fresh);
      setShowResetConfirm(false);
    }, 'Failed to reset usage: ');
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
                      saveAiConfigField({ agenticMode: checked });
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
                    className={`${BUTTON_CLASS_LINK_RED} text-sm`}
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
                    <div className="text-2xl font-bold text-green-400">${usageData.totalCost.toFixed(4)}</div>
                    <div className="text-xs text-slate-400 mt-1">Est. Total Cost</div>
                  </div>
                </div>

                {/* Per-model breakdown */}
                {Object.keys(usageData.byModel).length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-slate-300 mb-2">By Model</h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-400 text-left">
                          <th className="pb-2 font-medium">Model</th>
                          <th className="pb-2 font-medium text-right">Requests</th>
                          <th className="pb-2 font-medium text-right">Input Tokens</th>
                          <th className="pb-2 font-medium text-right">Output Tokens</th>
                          <th className="pb-2 font-medium text-right">Est. Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(usageData.byModel).map(([modelName, usage]) => (
                          <tr key={modelName} className="text-slate-200 border-t border-slate-700">
                            <td className="py-2 font-mono text-xs">{modelName}</td>
                            <td className="py-2 text-right">{usage.requests.toLocaleString()}</td>
                            <td className="py-2 text-right">{usage.inputTokens.toLocaleString()}</td>
                            <td className="py-2 text-right">{usage.outputTokens.toLocaleString()}</td>
                            <td className="py-2 text-right text-green-400">
                              ${usage.cost.toFixed(4)}
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
                  {/* Active model + entry point to the AI Models tab. See: (USER_GUIDE.md#ai-model) */}
                  <div>
                    <h2 className="text-lg font-semibold text-slate-100 mb-3">AI Model</h2>
                    <div className="flex items-center gap-3">
                      {aiModels.length > 0 ? (
                        <select
                          value={selectedAiModel}
                          onChange={(e) => handleAiModelChange(e.target.value)}
                          className="flex-1 bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                          data-testid="ai-model-select"
                        >
                          {aiModels.map((m) => (
                            <option key={m.name} value={m.name}>{m.name}</option>
                          ))}
                        </select>
                      ) : (
                        <p className="flex-1 text-amber-400 text-sm" data-testid="ai-no-models-notice">
                          No AI models are defined yet. AI features won&rsquo;t work until you add one.
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={handleConfigureModels}
                        className={clsx(BUTTON_CLASS_DLG_BLUE, 'whitespace-nowrap')}
                        data-testid="ai-settings-configure-models-button"
                      >
                        Configure Models
                      </button>
                    </div>
                  </div>

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
                        data-testid="ai-agentic-allowed-folders-textarea"
                      />
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Personas */}
            {aiEnabled && (
              <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
                <h2 className="text-lg font-semibold text-slate-100 mb-3">AI Persona</h2>
                <div className="flex items-center gap-3">
                  {/* Select-only (no onChange): personas are defined on the AI Personas tab. */}
                  <EditableCombobox
                    data-testid="ai-persona-combobox"
                    value={personaName}
                    onSelect={(option: ComboboxOption) => handlePersonaSelect(option.value)}
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
                    onClick={handleConfigurePersonas}
                    className={clsx(BUTTON_CLASS_DLG_BLUE, 'whitespace-nowrap')}
                    data-testid="ai-settings-configure-personas-button"
                  >
                    Configure Personas
                  </button>
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
                      saveAiConfigField({ aiRewriteMode: checked });
                    }}
                    inputClassName={SETTINGS_CHECKBOX_CLASS}
                    spanClassName="text-slate-200"
                    testId="enable-ai-rewrite"
                  />
                  {aiRewriteMode && (
                    <CheckboxField
                      label="Rewrite using Full Doc Context (Document-Type Folders Only)"
                      checked={fullDocContext}
                      onChange={(checked) => {
                        saveAiConfigField({ fullDocContext: checked });
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
