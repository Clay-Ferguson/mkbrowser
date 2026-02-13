import { useRef, useState } from 'react';
import { useCurrentView, setCurrentView, useFolderAnalysis, useSearchResults, type AppView } from '../store';
import appLogo from '../../public/icon-256.png';
import FilePopupMenu from './menus/FilePopupMenu';

interface TabConfig {
  id: AppView;
  label: string;
}

interface AppTabButtonsProps {
  onSelectFolder: () => void;
  onQuit: () => void;
}

// Canonical tab order: Browse, Search, Analysis, Settings
const allTabs: TabConfig[] = [
  { id: 'browser', label: 'Browse' },
  { id: 'search-results', label: 'Search' },
  { id: 'folder-analysis', label: 'Analysis' },
  { id: 'settings', label: 'Settings' },
];

function AppTabButtons({ onSelectFolder, onQuit }: AppTabButtonsProps) {
  const currentView = useCurrentView();
  const folderAnalysis = useFolderAnalysis();
  const searchResults = useSearchResults();
  const logoRef = useRef<HTMLButtonElement>(null);
  const [showFileMenu, setShowFileMenu] = useState(false);

  const visibleIds = new Set<AppView>([
    'browser',
    'settings',
    ...(searchResults.length > 0 ? ['search-results' as AppView] : []),
    ...(folderAnalysis ? ['folder-analysis' as AppView] : []),
  ]);

  const tabs = allTabs.filter((tab) => visibleIds.has(tab.id));

  return (
    <nav data-id="app-tab-buttons" className="flex items-center gap-6 px-4 pt-1 bg-slate-800 border-b border-slate-600">
      <button
        ref={logoRef}
        type="button"
        onClick={() => setShowFileMenu((prev) => !prev)}
        className="flex-shrink-0 cursor-pointer rounded-lg p-0.5 hover:bg-slate-700 transition-colors"
        aria-label="File menu"
        title="File menu"
      >
        <img
          src={appLogo}
          alt="MkBrowser"
          className="w-10 h-10"
        />
      </button>
      {showFileMenu && (
        <FilePopupMenu
          anchorRef={logoRef}
          onClose={() => setShowFileMenu(false)}
          onSelectFolder={onSelectFolder}
          onQuit={onQuit}
        />
      )}
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => setCurrentView(tab.id)}
          className={`
            text-base font-medium pb-1 transition-colors cursor-pointer
            ${currentView === tab.id
              ? 'text-slate-100 border-b-4 border-blue-500'
              : 'text-slate-400 hover:text-slate-200 border-b-4 border-transparent'
            }
          `}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

export default AppTabButtons;
