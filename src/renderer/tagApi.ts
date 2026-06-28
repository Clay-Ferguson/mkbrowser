import { api } from '../services/api';
import type { TagCategory } from '../shared/tagUtil';

/**
 * Calls the main-process IPC to load tags from the config folder.
 *
 * RENDERER ONLY — uses the `window.electronAPI` bridge via `../services/api`.
 */
export async function fetchTags(): Promise<TagCategory[]> {
  return api.loadTags();
}
