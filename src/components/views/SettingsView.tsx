import { useState } from 'react';
import TagsEditorDialog from '../dialogs/TagsEditorDialog';
import CheckboxField from '../dialogs/common/CheckboxField';
import { SETTINGS_CHECKBOX_CLASS } from '../../utils/styles';
import {
  setFontSize,
  setFoldersOnTop,
  setShowToc,
  setIgnoredPaths,
  setContentWidth,
  setOcrToolsFolder,
  setCalendarItemsFolder,
  setIndexTreeWidth,
  useSettings,
  type FontSize,
  type ContentWidth,
  type IndexTreeWidth,
} from '../../store';

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

interface IndexTreeWidthOption {
  value: IndexTreeWidth;
  label: string;
}

const indexTreeWidthOptions: IndexTreeWidthOption[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
];

interface SettingsViewProps {
  onSaveSettings: () => void;
}

function SettingsView({ onSaveSettings }: SettingsViewProps) {
  const settings = useSettings();
  const [showTagsEditor, setShowTagsEditor] = useState(false);

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

  const handleShowTocChange = (showToc: boolean) => {
    setShowToc(showToc);
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

  const handleIndexTreeWidthChange = (indexTreeWidth: IndexTreeWidth) => {
    setIndexTreeWidth(indexTreeWidth);
    onSaveSettings();
  };

  const handleOcrToolsFolderChange = (ocrToolsFolder: string) => {
    setOcrToolsFolder(ocrToolsFolder);
    // Trigger save to persist the setting
    onSaveSettings();
  };

  const handleCalendarItemsFolderChange = (calendarItemsFolder: string) => {
    setCalendarItemsFolder(calendarItemsFolder);
    onSaveSettings();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-900">

      {/* Main content */}
      <main className="flex-1 min-h-0 overflow-y-auto">
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

              <div className="flex items-center gap-2">
                <label className="text-slate-300 text-sm">Folder Tree:</label>
                <select
                  value={settings.indexTreeWidth ?? 'narrow'}
                  onChange={(e) => handleIndexTreeWidthChange(e.target.value as IndexTreeWidth)}
                  className="bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                >
                  {indexTreeWidthOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <CheckboxField
                label="Folders on Top"
                checked={settings.foldersOnTop}
                onChange={handleFoldersOnTopChange}
                inputClassName={SETTINGS_CHECKBOX_CLASS}
                spanClassName="text-slate-200"
              />

              <CheckboxField
                label="Show Table of Contents"
                checked={settings.showToc}
                onChange={handleShowTocChange}
                inputClassName={SETTINGS_CHECKBOX_CLASS}
                spanClassName="text-slate-200"
              />
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

          {/* OCR Setting */}
          <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-slate-100 mb-2">OCR</h2>
            <p className="text-sm text-slate-400 mb-4">
              Optical Character Recognition Tools Folder
            </p>

            <input
              type="text"
              value={settings.ocrToolsFolder}
              onChange={(e) => handleOcrToolsFolderChange(e.target.value)}
              placeholder="/path/to/ocr-tools"
              className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
            />
          </section>

          {/* Calendar Setting */}
          <section className="bg-slate-800 rounded-lg border border-slate-700 p-6">
            <h2 className="text-lg font-semibold text-slate-100 mb-2">Calendar</h2>
            <p className="text-sm text-slate-400 mb-4">
              Folder where new calendar item files are created.
            </p>

            <input
              type="text"
              value={settings.calendarItemsFolder}
              onChange={(e) => handleCalendarItemsFolderChange(e.target.value)}
              placeholder="/path/to/calendar"
              className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
            />
          </section>

          <button
            type="button"
            onClick={() => setShowTagsEditor(true)}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 rounded-lg transition-colors cursor-pointer"
            data-testid="settings-edit-hashtags-button"
          >
            Edit Hashtags
          </button>
        </div>
        </div>
      </main>
      {showTagsEditor && (
        <TagsEditorDialog onClose={() => setShowTagsEditor(false)} />
      )}
    </div>
  );
}

export default SettingsView;