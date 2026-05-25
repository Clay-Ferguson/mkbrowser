import { getSettings, setSettings, type SearchDefinition } from '../store';
import { logger } from './logUtil';

/**
 * Parse a newline-delimited ignored-paths string into a trimmed, non-empty array.
 */
export function parseIgnoredPaths(raw: string): string[] {
  return raw
    .split('\n')
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Convert an array of wildcard path patterns (e.g. "*.log", "temp*") into
 * anchored, case-insensitive RegExp objects suitable for matching filenames.
 */
export function buildIgnoredPatterns(paths: string[]): RegExp[] {
  return paths.map(pattern => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const regexPattern = escaped.replace(/\*/g, '.*');
    return new RegExp(`^${regexPattern}$`, 'i');
  });
}

/**
 * Creates a search function that checks if content contains given text (case-insensitive)
 * and tracks the total number of matches found.
 * 
 * @param content - The text content to search within
 * @returns An object containing the search function and match count getter
 */
export function createContentSearcher(content: string): {
  $: (searchText: string) => boolean;
  getMatchCount: () => number;
} {
  const contentLower = content.toLowerCase();
  let matchCount = 0;
  
  /**
   * The '$' function checks if content contains the given text (case-insensitive)
   * and increments matchCount for each call that returns true
   */
  const $ = (searchText: string): boolean => {
    const searchLower = searchText.toLowerCase();
    const found = contentLower.includes(searchLower);
    if (found) {
      // Count occurrences for matchCount
      let count = 0;
      let idx = 0;
      while ((idx = contentLower.indexOf(searchLower, idx)) !== -1) {
        count++;
        idx += searchLower.length;
      }
      matchCount += count;
      return true;
    }
    return false;
  };
  
  const getMatchCount = (): number => matchCount;
  
  return { $, getMatchCount };
}

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
