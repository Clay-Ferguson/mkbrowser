import { getSettings, setSettings, type SearchDefinition } from '../store';
import { logger } from './logUtil';

export async function saveSearchDefinitionToConfig(definition: SearchDefinition): Promise<void> {
  try {
    const currentSettings = getSettings();
    const config = await window.electronAPI.getConfig();
    const updatedSearchDefinitions = currentSettings.searchDefinitions.filter(
      (def) => def.name !== definition.name
    );
    updatedSearchDefinitions.push(definition);
    await window.electronAPI.saveConfig({
      ...config,
      settings: { ...currentSettings, searchDefinitions: updatedSearchDefinitions },
    });
    setSettings({ ...currentSettings, searchDefinitions: updatedSearchDefinitions });
  } catch (err) {
    logger.error('Failed to save search definition:', err);
  }
}

export async function deleteSearchDefinitionFromConfig(name: string): Promise<void> {
  try {
    const currentSettings = getSettings();
    const config = await window.electronAPI.getConfig();
    const updatedSearchDefinitions = currentSettings.searchDefinitions.filter(
      (def) => def.name !== name
    );
    await window.electronAPI.saveConfig({
      ...config,
      settings: { ...currentSettings, searchDefinitions: updatedSearchDefinitions },
    });
    setSettings({ ...currentSettings, searchDefinitions: updatedSearchDefinitions });
  } catch (err) {
    logger.error('Failed to delete search definition:', err);
  }
}

export function buildReplaceResultMessage(results: Array<{ success: boolean; replacementCount: number }>): string {
  const successfulFiles = results.filter((r) => r.success);
  const totalReplacements = successfulFiles.reduce((sum, r) => sum + r.replacementCount, 0);
  const failedFiles = results.filter((r) => !r.success);

  let message = totalReplacements > 0
    ? `Replaced ${totalReplacements} occurrence${totalReplacements === 1 ? '' : 's'} in ${successfulFiles.length} file${successfulFiles.length === 1 ? '' : 's'}.`
    : 'No matches found.';

  if (failedFiles.length > 0) {
    message += `\n\n${failedFiles.length} file${failedFiles.length === 1 ? '' : 's'} could not be processed.`;
  }

  return message;
}
