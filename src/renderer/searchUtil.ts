import { getSettings, setSettings, type SearchDefinition } from '../store';
import { api } from './api';
import { logger } from '../shared/logUtil';

// Pure, process-neutral search helpers (parseIgnoredPaths, createContentSearcher,
// buildReplaceResultMessage) now live in `searchHelpers.ts` so the main process can
// import them without pulling in the store / IPC bridge below.

export async function saveSearchDefinitionToConfig(definition: SearchDefinition): Promise<void> {
  try {
    const currentSettings = getSettings();
    const updatedSearchDefinitions = currentSettings.searchDefinitions.filter(
      (def) => def.name !== definition.name
    );
    updatedSearchDefinitions.push(definition);
    const updatedSettings = { ...currentSettings, searchDefinitions: updatedSearchDefinitions };
    setSettings(updatedSettings);
    await api.updateConfig({ settings: updatedSettings });
  } catch (err) {
    logger.error('Failed to save search definition:', err);
  }
}

export async function deleteSearchDefinitionFromConfig(name: string): Promise<void> {
  try {
    const currentSettings = getSettings();
    const updatedSearchDefinitions = currentSettings.searchDefinitions.filter(
      (def) => def.name !== name
    );
    const updatedSettings = { ...currentSettings, searchDefinitions: updatedSearchDefinitions };
    setSettings(updatedSettings);
    await api.updateConfig({ settings: updatedSettings });
  } catch (err) {
    logger.error('Failed to delete search definition:', err);
  }
}
