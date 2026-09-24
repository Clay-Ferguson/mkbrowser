import { getSettings, setSettings, setSearchOutcome, type AppSettings, type SearchDefinition } from '../store';
import { api, ipcErrorMessage } from './api';
import { logger } from '../shared/logUtil';
import type { SearchOutcome } from '../shared/shared';

// Pure, process-neutral search helpers (parseIgnoredPaths, createContentSearcher,
// buildReplaceResultMessage) now live in `searchHelpers.ts` so the main process can
// import them without pulling in the store / IPC bridge below.

/**
 * Applies `updatedSettings` to the reactive store (for immediate UI reflection) and persists
 * them. If the persist fails the store is rolled back to `previousSettings` and the error is
 * rethrown, so the UI never shows a change that didn't make it to disk.
 */
async function applySettings(
  previousSettings: AppSettings,
  updatedSettings: AppSettings,
  failureMessage: string
): Promise<void> {
  setSettings(updatedSettings);
  try {
    await api.updateConfig({ settings: updatedSettings });
  } catch (err) {
    setSettings(previousSettings);
    logger.error(failureMessage, err);
    throw err;
  }
}

/**
 * Id of the most recently started search. Searches can overlap (a new search,
 * a saved search, a hashtag click or a refresh started while one is still
 * running), and they can finish in any order — so each run takes the next id
 * and only publishes if it is still the latest when its IPC call returns.
 */
let latestSearchId = 0;

/**
 * Runs `definition` against `folder` and publishes the results to the store.
 * This is the single execution path for every search — the search dialog, a
 * saved search, a hashtag click, and the Search Results refresh — so the
 * results and the parameters that produced them are always written together:
 * `lastSearchDefinition` is what lets the refresh re-run the identical search.
 *
 * `searchText` is sent exactly as authored, newlines included: a multi-line
 * literal query matches multi-line text, and a `//` comment in a multi-line
 * advanced query ends at its line.
 *
 * Returns true when the results were published, or false when a newer search
 * started while this one was running. Starting a search makes the main process
 * cancel the one in progress (see searchRunner.ts); the cancelled search, or
 * any older result or error that still arrives, is dropped here, so an older,
 * slower search can never overwrite a newer one. Callers
 * should only react (e.g. switch to the Search tab) on true. Throws if the
 * search fails (e.g. an invalid or timed-out advanced query) and is still the
 * latest, with the main process's message; callers report it. Earlier results
 * are left in place.
 */
export async function executeSearch(folder: string, definition: SearchDefinition): Promise<boolean> {
  const searchId = ++latestSearchId;
  let outcome: SearchOutcome;
  try {
    outcome = await api.searchFolder(folder, definition);
  } catch (err) {
    if (searchId !== latestSearchId) return false;
    throw new Error(ipcErrorMessage(err));
  }
  if (outcome.cancelled || searchId !== latestSearchId) return false;
  setSearchOutcome(folder, definition, outcome);
  return true;
}

/**
 * Upserts a saved search definition into the user's settings, keyed by `definition.name`.
 * An existing definition with the same name is replaced. Updates both the reactive store
 * and the persisted config file. Throws if the persist fails.
 */
export async function saveSearchDefinitionToConfig(definition: SearchDefinition): Promise<void> {
  const currentSettings = getSettings();
  const updatedSearchDefinitions = currentSettings.searchDefinitions.filter(
    (def) => def.name !== definition.name
  );
  updatedSearchDefinitions.push(definition);
  const updatedSettings = { ...currentSettings, searchDefinitions: updatedSearchDefinitions };
  await applySettings(currentSettings, updatedSettings, 'Failed to save search definition:');
}

/**
 * Removes the saved search definition with the given name from the user's settings.
 * Updates both the reactive store and the persisted config file. Throws if the persist fails.
 */
export async function deleteSearchDefinitionFromConfig(name: string): Promise<void> {
  const currentSettings = getSettings();
  const updatedSearchDefinitions = currentSettings.searchDefinitions.filter(
    (def) => def.name !== name
  );
  const updatedSettings = { ...currentSettings, searchDefinitions: updatedSearchDefinitions };
  await applySettings(currentSettings, updatedSettings, 'Failed to delete search definition:');
}
