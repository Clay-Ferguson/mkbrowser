import { useRef, useState } from 'react';
import { showTab, useCurrentView, setCurrentView, useFolderAnalysis, useSearchResults, useVisibleTabs, type AppView } from '../store';
import { isAiThreadByEntries } from '../ai/aiPatterns';
import type { FileEntry } from '../global';
import appLogo from '../../public/icon-256.png';
import FilePopupMenu from './menus/FilePopupMenu';

interface TabConfig {
  id: AppView;
  label: string;
}

interface AppTabButtonsProps {
  entries: FileEntry[];
  onSelectFolder: () => void;
  onQuit: () => void;
}

// Canonical tab order: Browse, Thread, Search, Analysis, Settings
const allTabs: TabConfig[] = [
  { id: 'browser', label: 'Browse' },
  { id: 'thread', label: 'Chat' },
  { id: 'search-results', label: 'Search' },
  { id: 'folder-analysis', label: 'Analysis' },
  { id: 'settings', label: 'Settings' },
  { id: 'ai-settings', label: 'AI Settings' },
];

function AppTabButtons({ entries, onSelectFolder, onQuit }: AppTabButtonsProps) {
  const currentView = useCurrentView();
  const folderAnalysis = useFolderAnalysis();
  const searchResults = useSearchResults();
  const logoRef = useRef<HTMLButtonElement>(null);
  const [showFileMenu, setShowFileMenu] = useState(false);

  const visibleTabs = useVisibleTabs();

  // Determine whether the thread tab should be visible based on loaded entries
  const isInAiThread = isAiThreadByEntries(entries) || currentView === 'thread';

  const visibleIds = new Set<AppView>([
    ...visibleTabs,
    ...(searchResults.length > 0 ? ['search-results' as AppView] : []),
    ...(folderAnalysis ? ['folder-analysis' as AppView] : []),
    ...(isInAiThread ? ['thread' as AppView] : []),
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
        data-testid="app-logo"
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
           onSettings={() => {
            showTab('settings');
            setCurrentView('settings');
          }}
          onAiSettings={() => {
            showTab('ai-settings');
            setCurrentView('ai-settings');
          }}
        />
      )}
      {tabs.map((tab) => (
        <button
          key={tab.id}
          data-testid={`tab-button-${tab.id}`}
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
