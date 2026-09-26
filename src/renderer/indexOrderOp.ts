/**
 * Document Mode (a folder's `.INDEX.yaml` ordering) workflows behind
 * BrowseView's toolbar and entry rows.
 *
 * Each is a fire-and-forget workflow for a user action (`void`, run through
 * {@link runOp}), so a component only wires a button to it: failures reach the
 * app-wide error dialog, and the listing is reloaded on success.
 */

import { api } from './api';
import { runOp } from './runOp';
import { refreshDirectory } from './directoryLoader';
import { setAppError } from '../store';

/**
 * Reloads the listing of `folderPath`, first reconciling its index when it has
 * one, so files added or removed outside the app are placed in (or dropped
 * from) the order. Also the completion step of a rename or delete.
 */
export function reconcileAndRefresh(folderPath: string | null, hasIndexFile: boolean): void {
  runOp(async () => {
    if (folderPath && hasIndexFile) {
      await api.reconcileIndexedFiles(folderPath, false);
    }
    refreshDirectory();
  }, 'Failed to refresh folder: ');
}

/** Turns on Document Mode for `folderPath` by creating its index from the current listing. */
export function enableCustomOrdering(folderPath: string): void {
  runOp(async () => {
    const result = await api.reconcileIndexedFiles(folderPath, true);
    if (!result.success) {
      setAppError(result.error || 'Failed to enable custom ordering');
      return;
    }
    refreshDirectory();
  }, 'Failed to enable custom ordering: ');
}

/** Moves the entry named `name` one place up or down in `folderPath`'s index. */
export function moveInIndex(folderPath: string, name: string, direction: 'up' | 'down'): void {
  runOp(async () => {
    await api.moveInIndexYaml(folderPath, name, direction);
    refreshDirectory();
  }, 'Failed to move item: ');
}

/** Moves the entry named `name` to the top or bottom of `folderPath`'s index. */
export function moveToEdgeInIndex(folderPath: string, name: string, edge: 'top' | 'bottom'): void {
  runOp(async () => {
    await api.moveToEdgeInIndexYaml(folderPath, name, edge);
    refreshDirectory();
  }, 'Failed to move item: ');
}
