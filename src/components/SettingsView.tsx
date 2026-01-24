import {
  setCurrentView,
  setFontSize,
  setSortOrder,
  setFoldersOnTop,
  useSettings,
  type FontSize,
  type SortOrder,
} from '../store';

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

interface SortOrderOption {
  value: SortOrder;
  label: string;
}

const sortOrderOptions: SortOrderOption[] = [
  { value: 'alphabetical', label: 'Alphabetical' },
  { value: 'created-chron', label: 'Created Time (chron)' },
  { value: 'created-reverse', label: 'Created Time (reverse-chron)' },
  { value: 'modified-chron', label: 'Modified Time (chron)' },
  { value: 'modified-reverse', label: 'Modified Time (reverse-chron)' },
];

interface SettingsViewProps {
  onSaveSettings: () => void;
}

function SettingsView({ onSaveSettings }: SettingsViewProps) {
  const settings = useSettings();

  // Font size is now applied globally via data-font-size attribute on html element

  const handleBack = () => {
    setCurrentView('browser');
  };

  const handleFontSizeChange = (fontSize: FontSize) => {
    setFontSize(fontSize);
    // Trigger save to persist the setting
    onSaveSettings();
  };

  const handleSortOrderChange = (sortOrder: SortOrder) => {
    setSortOrder(sortOrder);
    // Trigger save to persist the setting
    onSaveSettings();
  };

  const handleFoldersOnTopChange = (foldersOnTop: boolean) => {
    setFoldersOnTop(foldersOnTop);
    // Trigger save to persist the setting
    onSaveSettings();
  };

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Back button */}
            <button
              onClick={handleBack}
              className="p-2 rounded-lg transition-colors text-slate-400 hover:bg-slate-700"
              title="Back to browser"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Title */}
            <div className="flex-1 min-w-0">
              <h1 className="text-slate-200 font-medium">Settings</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="space-y-6">
          {/* Font Size Setting */}
          <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-slate-100 mb-2">Font Size</h2>
            <p className="text-sm text-slate-400 mb-4">
              Choose the base font size for the application interface.
            </p>

            <div className="flex items-center gap-4">
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
          </section>

          {/* Sort Order Setting */}
          <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-slate-100 mb-2">Sort Order</h2>
            <p className="text-sm text-slate-400 mb-4">
              Choose how files and folders are ordered in the browser.
            </p>

            <div className="flex items-center gap-4 mb-4">
              <select
                value={settings.sortOrder}
                onChange={(e) => handleSortOrderChange(e.target.value as SortOrder)}
                className="bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
              >
                {sortOrderOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.foldersOnTop}
                onChange={(e) => handleFoldersOnTopChange(e.target.checked)}
                className="w-5 h-5 bg-slate-700 border border-slate-600 rounded text-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-slate-200">Folders on Top</span>
            </label>
            <p className="text-sm text-slate-400 mt-2 ml-8">
              When enabled, folders are displayed above files in the listing.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

export default SettingsView;