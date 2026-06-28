/**
 * Shared debug logging for the AI modules.
 *
 * Lives in its own dependency-free module so that aiModel.ts and langGraph.ts
 * can both use it without importing each other — previously aiModel imported
 * the logger from langGraph while langGraph imported the model factory from
 * aiModel, which formed an import cycle.
 *
 * Each module builds its own tagged logger via {@link createDebugLog} so log
 * lines are prefixed with the originating module (e.g. `[langGraph DEBUG]`),
 * matching the `[deepAgent DEBUG]` style used elsewhere.
 *
 * This module runs in the main process only — never import from the renderer.
 */
import { logger } from '../../shared/logUtil';

/** Set to true to enable verbose debug logging for AI invocations. */
const DEBUG = true;

/**
 * Build a debug logger tagged with the given module name. Output is gated by
 * the module-level {@link DEBUG} flag and prefixed as `[<tag> DEBUG]`.
 */
export function createDebugLog(tag: string): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    if (DEBUG) logger.log(`[${tag} DEBUG]`, ...args);
  };
}
