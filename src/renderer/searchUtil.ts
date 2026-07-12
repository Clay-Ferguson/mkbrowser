import { getSettings, setSettings, type AppSettings, type SearchDefinition } from '../store';
import { api } from './api';
import { logger } from '../shared/logUtil';

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
