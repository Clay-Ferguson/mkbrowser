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
import type { AIModelConfig, AppConfig } from '../../global.d.ts';
import { useScrollPersistence } from '../../utils/useScrollPersistence';

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
  const [aiModels, setAiModels] = useState<AIModelConfig[]>([]);
  const [selectedAiModel, setSelectedAiModel] = useState<string>('');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState<string>('http://localhost:11434');

  // Load AI config on mount
  useEffect(() => {
    window.electronAPI.getConfig().then((config: AppConfig) => {
      if (config.aiModels) setAiModels(config.aiModels);
      if (config.aiModel) setSelectedAiModel(config.aiModel);
      if (config.ollamaBaseUrl) setOllamaBaseUrl(config.ollamaBaseUrl);
    });
  }, []);

  const saveAiConfigField = useCallback(async (updates: Partial<AppConfig>) => {
    try {
      const config = await window.electronAPI.getConfig();
      await window.electronAPI.saveConfig({ ...config, ...updates });
    } catch {
      // Silently fail — config will be stale until next save
    }
  }, []);

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
            <p className="text-sm text-slate-400 mb-4">
              Configure the AI model and provider used for chat conversations.
            </p>

            <div className="space-y-4">
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
              </div>

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
            </div>
          </section>
        </div>
        </div>
      </main>
    </div>
  );
}

export default SettingsView;