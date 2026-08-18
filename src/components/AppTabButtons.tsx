import { useRef, useState } from 'react';
import { Bars3Icon } from '@heroicons/react/24/outline';
import { showTab, hideTab, setCurrentView, useAS, setCurrentPath, setHighlightItem, setPendingScrollToFile, setFolderGraph, setFolderAnalysis, clearSearchResults, type AppView } from '../store';
import { isAiThreadByEntries } from '../shared/ai/aiPatterns';
import { getParentPath, isPathInside } from '../renderer/pathUtil';
import type { FileEntry } from '../global';
import appLogo from '../../public/icon-256.png';
import FilePopupMenu from './menus/FilePopupMenu';
import SystemPopupMenu from './menus/SystemPopupMenu';
import { BUTTON_CLASS_BAR_NEUTRAL, BUTTON_CLASS_LINK_MUTED, BUTTON_CLASS_TB_NORMAL, BUTTON_CLASS_XS, TAB_BUTTON_ACTIVE, TAB_BUTTON_IDLE } from '../renderer/styles';

interface TabConfig {
  id: AppView;
  label: string;
  hasCloseButton?: boolean;
}

interface AppTabButtonsProps {
  entries: FileEntry[];
  onSelectFolder: () => void;
  onQuit: () => void;
  recentFolders: string[];
  onOpenRecentFolder: (folder: string) => void;
}

// Canonical tab order: Browse, Thread, Search, Analysis, Graph, Settings
const allTabs: TabConfig[] = [
  { id: 'browser', label: 'Browse', hasCloseButton: false },
  { id: 'thread', label: 'AI Chat', hasCloseButton: false },
  { id: 'search-results', label: 'Search' },
  { id: 'folder-analysis', label: 'Analysis' },
  { id: 'folder-graph', label: 'Graph' },
  { id: 'settings', label: 'Settings' },
  { id: 'ai-settings', label: 'AI Settings' },
  { id: 'calendar', label: 'Calendar' },
];

/**
 * Top navigation bar showing the app logo (file menu), view tabs, system menu,
 * and an "Up Level" button when browsing below the root folder.
 *
 * Tab visibility is driven by store state: tabs appear when their corresponding
 * data is available (search results, analysis, graph, AI thread) and disappear
 * when closed — clearing the underlying data.
 */
function AppTabButtons({ entries, onSelectFolder, onQuit, recentFolders, onOpenRecentFolder }: AppTabButtonsProps) {
  const currentView = useAS(s => s.currentView);
  const folderAnalysis = useAS(s => s.folderAnalysis);
  const folderGraph = useAS(s => s.folderGraph);
  const searchResults = useAS(s => s.searchResults);
  const currentPath = useAS(s => s.currentPath);
  const rootPath = useAS(s => s.rootPath);
  const logoRef = useRef<HTMLButtonElement>(null);
  const systemMenuRef = useRef<HTMLButtonElement>(null);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showSystemMenu, setShowSystemMenu] = useState(false);

  // Navigate to the parent directory and highlight the folder we came from.
  const navigateUp = () => {
    if (!currentPath || currentPath === rootPath) return;
    const parent = getParentPath(currentPath);
    if (isPathInside(rootPath, parent)) {
      setCurrentPath(parent);
      setHighlightItem(currentPath);
      setPendingScrollToFile(currentPath);
    }
  };

  const visibleTabs = useAS(s => s.visibleTabs);

  // Returns a click handler that clears a tab's data and falls back to Browse if that tab was active.
  const makeCloseHandler = (tabId: AppView, close: () => void) => () => {
    close();
    if (currentView === tabId) setCurrentView('browser');
  };

  const closeHandlers: Partial<Record<AppView, () => void>> = {
    'thread': makeCloseHandler('thread', () => hideTab('thread')),
    'search-results': makeCloseHandler('search-results', () => clearSearchResults()),
    'folder-analysis': makeCloseHandler('folder-analysis', () => setFolderAnalysis(null)),
    'folder-graph': makeCloseHandler('folder-graph', () => setFolderGraph(null)),
    'settings': makeCloseHandler('settings', () => hideTab('settings')),
    'ai-settings': makeCloseHandler('ai-settings', () => hideTab('ai-settings')),
    'calendar': makeCloseHandler('calendar', () => hideTab('calendar')),
  };

  // Determine whether the thread tab should be visible based on loaded entries
  const isInAiThread = isAiThreadByEntries(entries) || currentView === 'thread';

  const visibleIds = new Set<AppView>([
    ...visibleTabs,
    ...(searchResults.length > 0 ? ['search-results' as AppView] : []),
    ...(folderAnalysis ? ['folder-analysis' as AppView] : []),
    ...(folderGraph ? ['folder-graph' as AppView] : []),
    ...(isInAiThread ? ['thread' as AppView] : []),
  ]);

  const tabs = allTabs.filter((tab) => visibleIds.has(tab.id));

  return (
    <nav data-testid="app-tab-buttons" className="flex items-center gap-3 px-2 bg-slate-800 border-b border-slate-600">
      <button
        ref={logoRef}
        type="button"
        onClick={() => setShowFileMenu((prev) => !prev)}
        className={`${BUTTON_CLASS_XS} flex-shrink-0`}
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
          recentFolders={recentFolders}
          onOpenRecentFolder={onOpenRecentFolder}
        />
      )}
      {showSystemMenu && (
        <SystemPopupMenu
          anchorRef={systemMenuRef}
          onClose={() => setShowSystemMenu(false)}
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
      {tabs.map((tab) => {
        const onClose = tab.hasCloseButton === false ? undefined : closeHandlers[tab.id];
        return (
          <div key={tab.id} className="self-stretch flex items-stretch gap-1 border-r border-slate-400 pr-4">
            <button
              data-testid={`tab-button-${tab.id}`}
              type="button"
              onClick={() => setCurrentView(tab.id)}
              className={currentView === tab.id ? TAB_BUTTON_ACTIVE : TAB_BUTTON_IDLE}
            >
              {tab.label}
            </button>
            {onClose && (
              <button
                type="button"
                data-testid={`tab-close-${tab.id}`}
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className={`${BUTTON_CLASS_LINK_MUTED} mb-1 ml-1 text-2xl leading-none`}
                aria-label={`Close ${tab.label} tab`}
                title={`Close ${tab.label} tab`}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <div className="ml-auto flex items-center gap-2">
        <button
          ref={systemMenuRef}
          type="button"
          onClick={() => setShowSystemMenu((prev) => !prev)}
          className={BUTTON_CLASS_TB_NORMAL}
          aria-label="System menu"
          title="System menu"
          data-testid="system-menu-button"
        >
          <Bars3Icon className="w-5 h-5" />
        </button>
        {(currentView === 'browser' || currentView === 'thread') && currentPath !== rootPath && (
          <button
            type="button"
            onClick={navigateUp}
            className={BUTTON_CLASS_BAR_NEUTRAL}
            title="Go up one level"
            data-testid="navigate-up-button"
          >
            Up Level
          </button>
        )}
      </div>
    </nav>
  );
}

export default AppTabButtons;
