import { api } from './api';
import { runOp } from './runOp';
import { refreshDirectory } from './directoryLoader';
import { hasHumanMd } from '../shared/ai/aiPatterns';
import { navigateToBrowserPath, setAppError, setPendingEditFile, useAS } from '../store';

/**
 * Starts a new AI conversation in `folderPath` (the folder being browsed) by
 * creating a HUMAN.md turn file via the `replyToAi` IPC call, then navigates to
 * the thread view and opens the new file for editing. Refuses when the folder
 * already holds a conversation. Fire-and-forget: failures reach the app-wide
 * error dialog.
 */
export function startAiChat(folderPath: string): void {
  if (hasHumanMd(useAS.getState().currentEntries)) {
    setAppError('This folder already contains an AI conversation. Please navigate to a different folder to start a new chat.');
    return;
  }
  runOp(async () => {
    const result = await api.replyToAi(folderPath, false);
    if ('error' in result) {
      setAppError('Failed to create AI chat: ' + result.error);
    } else {
      const view = 'thread';
      navigateToBrowserPath(result.folderPath, result.filePath, view);
      setPendingEditFile(result.filePath, view);
      // The new HUMAN.md is created directly in the current folder, so
      // currentPath doesn't change and BrowseView's load effect won't
      // re-fire on its own. Refresh explicitly so the file appears when
      // the user switches back to the browse view.
      refreshDirectory();
    }
  }, 'Failed to create AI chat: ');
}
