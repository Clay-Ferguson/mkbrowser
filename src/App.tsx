import { useState, useEffect, useCallback } from 'react';
import Markdown from 'react-markdown';
import type { FileEntry } from './global';

function App() {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [rootPath, setRootPath] = useState<string>('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial configuration
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await window.electronAPI.getConfig();
        if (config.browseFolder) {
          const exists = await window.electronAPI.pathExists(config.browseFolder);
          if (exists) {
            setRootPath(config.browseFolder);
            setCurrentPath(config.browseFolder);
          } else {
            setLoading(false);
          }
        } else {
          setLoading(false);
        }
      } catch (err) {
        setError('Failed to load configuration');
        setLoading(false);
      }
    };
    loadConfig();
  }, []);

  // Load directory when path changes
  useEffect(() => {
    if (!currentPath) return;

    const loadDirectory = async () => {
      setLoading(true);
      setError(null);
      try {
        const files = await window.electronAPI.readDirectory(currentPath);
        setEntries(files);
      } catch (err) {
        setError('Failed to read directory');
        setEntries([]);
      } finally {
        setLoading(false);
      }
    };
    loadDirectory();
  }, [currentPath]);

  // Handle folder selection
  const handleSelectFolder = useCallback(async () => {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      await window.electronAPI.saveConfig({ browseFolder: folder });
      setRootPath(folder);
      setCurrentPath(folder);
    }
  }, []);

  // Navigate to a subdirectory
  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
  }, []);

  // Navigate up one level
  const navigateUp = useCallback(() => {
    if (currentPath === rootPath) return;
    const parent = currentPath.substring(0, currentPath.lastIndexOf('/'));
    if (parent.length >= rootPath.length) {
      setCurrentPath(parent);
    }
  }, [currentPath, rootPath]);

  // Get relative path for breadcrumb display
  const getRelativePath = () => {
    if (!rootPath || !currentPath) return '';
    if (currentPath === rootPath) return '/';
    return currentPath.substring(rootPath.length) || '/';
  };

  // Folder selection prompt (first run or no folder configured)
  if (!currentPath && !loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
        <div className="bg-slate-800 rounded-lg shadow-lg p-8 max-w-md w-full text-center border border-slate-700">
          <div className="mb-6">
            <svg className="w-16 h-16 mx-auto text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-slate-100 mb-2">Welcome to MkBrowser</h1>
          <p className="text-slate-400 mb-6">
            Select a folder to start browsing your Markdown files.
          </p>
          <button
            onClick={handleSelectFolder}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
          >
            Select Folder
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header with navigation */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Back button */}
            <button
              onClick={navigateUp}
              disabled={currentPath === rootPath}
              className={`p-2 rounded-lg transition-colors ${
                currentPath === rootPath
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'text-slate-400 hover:bg-slate-700'
              }`}
              title="Go up"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Breadcrumb / path display */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500 truncate" title={rootPath}>
                  {rootPath.split('/').pop()}
                </span>
                <span className="text-slate-200 font-medium truncate">
                  {getRelativePath()}
                </span>
              </div>
            </div>

            {/* Change folder button */}
            <button
              onClick={handleSelectFolder}
              className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
              title="Change folder"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-slate-400">Loading...</div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="text-center py-12">
            <svg className="w-12 h-12 mx-auto text-slate-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <p className="text-slate-400">This folder is empty</p>
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.path}>
                {entry.isDirectory ? (
                  // Folder row
                  <button
                    onClick={() => navigateTo(entry.path)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800 rounded-lg border border-slate-700 hover:bg-slate-750 hover:border-slate-600 transition-colors text-left"
                  >
                    <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    <span className="text-slate-200 font-medium truncate">{entry.name}</span>
                    <svg className="w-4 h-4 text-slate-500 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ) : entry.isMarkdown ? (
                  // Markdown file card
                  <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-slate-800/50 border-b border-slate-700">
                      <svg className="w-5 h-5 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-slate-300 font-medium truncate">{entry.name}</span>
                    </div>
                    <div className="px-6 py-4">
                      <article className="prose prose-invert prose-sm max-w-none">
                        <Markdown>{entry.content || ''}</Markdown>
                      </article>
                    </div>
                  </div>
                ) : (
                  // Regular file row
                  <div className="flex items-center gap-3 px-4 py-3 bg-slate-800 rounded-lg border border-slate-700">
                    <svg className="w-5 h-5 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span className="text-slate-400 truncate">{entry.name}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
