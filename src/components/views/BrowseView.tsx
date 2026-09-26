import { useState, useEffect, useRef } from 'react';
import { runOp } from '../../renderer/runOp';
import { api } from '../../renderer/api';
import CreateFileDialog from '../dialogs/CreateFileDialog';
import CreateFolderDialog from '../dialogs/CreateFolderDialog';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import SearchDialog from '../dialogs/SearchDialog';
import ReplaceDialog from '../dialogs/ReplaceDialog';
import ExportDialog from '../dialogs/ExportDialog';
import type { ExportOptions } from '../dialogs/ExportDialog';
import AlertDialog from '../dialogs/AlertDialog';
import BrowseToolbar from './BrowseToolbar';
import BrowseEntryList from './BrowseEntryList';
import {
  cutSelectedItems,
  setCurrentPath,
  setIndexYaml,
  useAS,
  type SearchDefinition,
} from '../../store';
import { getContentWidthClasses } from '../../renderer/styles';
import { generateTimestampFileName } from '../../shared/timeUtil';
import { saveSearchDefinitionToConfig, deleteSearchDefinitionFromConfig, runSearch } from '../../renderer/searchUtil';
import { pasteIntoFolder, deleteSelected, createFileOp, createFolderOp } from '../../renderer/fileOpsUtil';
import { getFileName, getParentPath, isSamePath } from '../../renderer/pathUtil';
import { exportFolder, replaceInFolder } from '../../renderer/folderToolsOp';
import { reconcileAndRefresh, moveInIndex, moveToEdgeInIndex } from '../../renderer/indexOrderOp';
import { pasteCutAsAttachment, pasteClipboardAsAttachment, attachFromFile, createAttachment } from '../../renderer/attachmentOp';
import { NO_OVERLAY, type BrowseOverlay } from './browseOverlay';
import { getSelectedItems, getSortedEntries } from './browseListing';
import { usePendingBrowseIntents } from './usePendingBrowseIntents';

/** Derives a default export file name from the current folder name. */
function generateExportFileName(currentPath: string): string {
  return `${getFileName(currentPath)}-export.md`;
}

interface BrowseViewProps {
  lastExportFolder: string;
  onSetLastExportFolder: (folder: string) => void;
}

/**
 * The primary file-browser view: BrowseToolbar above BrowseEntryList, the
 * current folder's entries rendered as typed entry components (markdown,
 * image, text, folder, etc.). This component owns what the two share — the
 * dialogs (one {@link BrowseOverlay} at a time), the row and dialog handlers,
 * the index-yaml bookkeeping for the current folder, and the scroll container
 * whose per-folder position and pending intents usePendingBrowseIntents
 * manages. In index-ordered (document) mode the sort menu is hidden and inline
 * IndexInsertBars replace the create buttons.
 */
function BrowseView({ lastExportFolder, onSetLastExportFolder }: BrowseViewProps) {
  const [overlay, setOverlay] = useState<BrowseOverlay>(NO_OVERLAY);
  // Deliberately not part of `overlay`: it is set when an async replace
  // finishes, and by then the user may have opened another dialog that this
  // would otherwise clobber (losing whatever they had typed into it).
  const [replaceResultMessage, setReplaceResultMessage] = useState<string | null>(null);

  // Every close is conditional on the overlay still being the one that asked:
  // async ops close their dialog only once they finish, and must not close a
  // different one opened meanwhile (or, for the insert bars, one that was
  // never theirs).
  const closeOverlay = (kind: Exclude<BrowseOverlay['kind'], 'none'>) => {
    setOverlay((o) => (o.kind === kind ? NO_OVERLAY : o));
  };

  const hasIndexFile = useAS(s => s.hasIndexFile);
  const currentPath = useAS(s => s.currentPath);
  const entries = useAS(s => s.currentEntries);
  const contentWidth = useAS(s => s.settings.contentWidth);
  const searchDefinitions = useAS(s => s.settings.searchDefinitions);

  const mainContainerRef = useRef<HTMLElement | null>(null);
  const handleMainScroll = usePendingBrowseIntents(mainContainerRef);

  // Load the current folder's .INDEX.yaml into the store when it is index-ordered
  useEffect(() => {
    // A slow readIndexYaml can resolve after navigation (or after a newer run
    // for the same folder), so its write is gated on this run still being the
    // latest — otherwise a stale folder's yaml overwrites the current one.
    // On navigation, currentPath changes a render before the new folder's
    // entries arrive, so this can run with the OLD folder's entries paired
    // with the NEW path — computing hasIndex from the wrong folder and
    // fetching/flushing indexYaml against it. Skip such desynced runs; the
    // effect re-runs once the matching entries land. An empty listing carries
    // no path evidence, but hasIndex is necessarily false then, same as before.
    const firstEntry = entries[0];
    if (firstEntry && !isSamePath(getParentPath(firstEntry.path), currentPath)) return;
    let ignore = false;
    // hasIndexFile itself is derived by the store alongside currentEntries.
    const hasIndex = entries.some((e) => e.indexOrder !== undefined);
    if (hasIndex && currentPath) {
      void api.readIndexYaml(currentPath).then((yaml) => {
        if (ignore) return;
        setIndexYaml(yaml);
      });
    } else {
      setIndexYaml(null);
    }
    // Returns the useEffect cleanup (an unsubscribe-style teardown): sets the ignore flag so the pending readIndexYaml() promise can't set state after unmount/re-run.
    return () => {
      ignore = true;
    };
  }, [entries, currentPath]);

  // Reconcile on folder navigation only (not on every file-operation refresh)
  useEffect(() => {
    if (!currentPath) return;
    void api.reconcileIndexedFiles(currentPath, false);
  }, [currentPath]);

  // Also the completion step of an entry's rename or delete.
  const handleRefresh = () => reconcileAndRefresh(currentPath, hasIndexFile);

  const handleMoveEntry = (name: string, direction: 'up' | 'down') => {
    if (currentPath) moveInIndex(currentPath, name, direction);
  };

  const handleMoveEntryToEdge = (name: string, edge: 'top' | 'bottom') => {
    if (currentPath) moveToEdgeInIndex(currentPath, name, edge);
  };

  const doPasteIntoFolder = (folderPath: string) => {
    runOp(async () => {
      await pasteIntoFolder(folderPath, useAS.getState().items);
    }, 'Failed to paste into folder: ');
  };

  const performDelete = () => {
    runOp(async () => {
      await deleteSelected(getSelectedItems(useAS.getState().items), currentPath, hasIndexFile, () => closeOverlay('deleteConfirm'));
    }, 'Failed to delete: ');
  };

  const handleExport = (options: ExportOptions) => {
    if (!currentPath) return;
    closeOverlay('export');
    exportFolder(currentPath, options, onSetLastExportFolder);
  };

  const handleInsertFileAt = (insertIndex: number) => {
    const fileName = generateTimestampFileName();
    runOp(async () => {
      await createFileOp(fileName, currentPath, insertIndex, getSortedEntries(), () => closeOverlay('createFile'));
    }, 'Failed to create file: ');
  };

  const handleCreateFile = (insertAt: number | null, fileName: string) => {
    runOp(async () => {
      await createFileOp(fileName, currentPath, insertAt, getSortedEntries(), () => closeOverlay('createFile'));
    }, 'Failed to create file: ');
  };

  const handleInsertFolderAt = (insertIndex: number) => {
    setOverlay({ kind: 'createFolder', insertAt: insertIndex });
  };

  const handleCreateFolder = (insertAt: number | null, folderName: string) => {
    runOp(async () => {
      await createFolderOp(folderName, currentPath, insertAt, getSortedEntries(), () => closeOverlay('createFolder'));
    }, 'Failed to create folder: ');
  };

  const handleSearch = (definition: SearchDefinition) => {
    if (!currentPath) return;

    closeOverlay('search');

    // Running a search never saves it — even when it has a name, which just
    // labels the results. Saving (or updating) a definition is only ever done
    // by the dialog's Save button, so a one-off tweak to a saved search can't
    // silently overwrite it.
    runSearch(currentPath, definition);
  };

  const handleReplace = (searchText: string, replaceText: string) => {
    if (!currentPath) return;

    closeOverlay('replace');

    replaceInFolder(currentPath, searchText, replaceText, setReplaceResultMessage);
  };

  const handleSaveSearchDefinition = (definition: SearchDefinition) => {
    if (!definition.name) return;
    runOp(async () => {
      await saveSearchDefinitionToConfig(definition);
    }, 'Failed to save search: ');
  };

  const handleDeleteSearchDefinition = (name: string) => {
    runOp(async () => {
      await deleteSearchDefinitionFromConfig(name);
    }, 'Failed to delete search: ');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Combined header: breadcrumbs left, actions right, wraps responsively */}
      <BrowseToolbar
        onOpenOverlay={setOverlay}
        onRefresh={handleRefresh}
        onPasteIntoFolder={doPasteIntoFolder}
      />

      {/* Main content */}
      <main
        data-testid="browser-main-content"
        ref={mainContainerRef}
        onScroll={handleMainScroll}
        className="flex-1 min-h-0 pb-4 pt-1 pr-3 pl-3 relative overflow-y-auto"
      >
        <div className={getContentWidthClasses(contentWidth)}>
          <BrowseEntryList
            onNavigate={setCurrentPath}
            onRename={handleRefresh}
            onDelete={handleRefresh}
            onPasteIntoFolder={doPasteIntoFolder}
            onPasteAsAttachment={pasteCutAsAttachment}
            onPasteClipboardAsAttachment={pasteClipboardAsAttachment}
            onAttachFromFile={attachFromFile}
            onCreateAttachment={createAttachment}
            onMoveEntry={handleMoveEntry}
            onMoveEntryToEdge={handleMoveEntryToEdge}
            onInsertFileAt={handleInsertFileAt}
            onInsertFolderAt={handleInsertFolderAt}
          />
        </div>
      </main>

      {overlay.kind === 'createFile' && (
        <CreateFileDialog
          onCreate={(fileName) => handleCreateFile(overlay.insertAt, fileName)}
          onCancel={() => closeOverlay('createFile')}
        />
      )}

      {overlay.kind === 'createFolder' && (
        <CreateFolderDialog
          onCreate={(folderName) => handleCreateFolder(overlay.insertAt, folderName)}
          onCancel={() => closeOverlay('createFolder')}
        />
      )}

      {overlay.kind === 'search' && (
        <SearchDialog
          onSearch={handleSearch}
          onSave={handleSaveSearchDefinition}
          onCancel={() => closeOverlay('search')}
          onDeleteSearchDefinition={handleDeleteSearchDefinition}
          initialDefinition={overlay.definition}
          searchDefinitions={searchDefinitions}
        />
      )}

      {overlay.kind === 'replace' && (
        <ReplaceDialog
          onReplace={handleReplace}
          onCancel={() => closeOverlay('replace')}
        />
      )}

      {overlay.kind === 'export' && currentPath && (
        <ExportDialog
          defaultFolder={lastExportFolder}
          defaultFileName={generateExportFileName(currentPath)}
          onExport={handleExport}
          onCancel={() => closeOverlay('export')}
        />
      )}

      {overlay.kind === 'deleteConfirm' && (
        <ConfirmDialog
          message={`Move ${overlay.count} selected item(s) to trash?`}
          onConfirm={performDelete}
          onCancel={() => closeOverlay('deleteConfirm')}
        />
      )}

      {overlay.kind === 'cutOrphanConfirm' && (
        <ConfirmDialog
          message="One or more selected files have an attachments folder that is not selected. Cut only the file(s) without their attachments?"
          onConfirm={() => { closeOverlay('cutOrphanConfirm'); cutSelectedItems(); }}
          onCancel={() => closeOverlay('cutOrphanConfirm')}
        />
      )}

      {replaceResultMessage && (
        <AlertDialog
          preserveWhitespace
          title="Replace Results"
          message={replaceResultMessage}
          onClose={() => setReplaceResultMessage(null)}
        />
      )}
    </div>
  );
}

export default BrowseView;
