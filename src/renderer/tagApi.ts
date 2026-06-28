import { api } from './api';
import type { TagCategory } from '../shared/tagUtil';

/**
 * Calls the main-process IPC to load tags from the config folder.
 *
 * RENDERER ONLY — uses the `window.electronAPI` bridge via `./api`.
 */
export async function fetchTags(): Promise<TagCategory[]> {
  return api.loadTags();
}
