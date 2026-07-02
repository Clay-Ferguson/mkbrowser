import type { AiConfigState } from '../shared/types';
import { getState, useStoreValue, defaultAiConfig } from './core';
import type { StoreSet, StoreGet } from './core';

export { defaultAiConfig };

// ============================================================================
// AI Config - renderer-reactive mirror of the AI slice of AppConfig
// ============================================================================
//
// The main process config (configMgr) is the source of truth, but it is only
// fetched on demand via `api.getConfig()`. Consumers that mount once and live
// for the whole session (e.g. MarkdownEntry's AI Rewrite button, ThreadView's
// persona dropdown) would never see a change made later in AISettingsView /
// ThreadView. Mirroring the full AI config into the store lets those consumers
// subscribe and update live. `loadConfig` seeds this at startup; `saveAiConfig`
// (config.ts) keeps it in sync on every persist.

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts` (Zustand slices pattern — see ZUSTAND_CONVERSION.md §2b).
 */
export interface AiConfigSlice {
  setAiConfig: (updates: Partial<AiConfigState>) => void;
}

/**
 * Slice creator called by `core.ts` inside `create()`. A function declaration
 * (not a `const`) so it is hoisted and safe under the core ↔ slice import
 * cycle regardless of module load order.
 */
export function createAiConfigSlice(set: StoreSet, get: StoreGet): AiConfigSlice {
  return {
    /**
     * Merge partial updates into the in-memory AI config mirror and notify
     * subscribers. This only updates the renderer mirror — persistence to the
     * main process is the caller's responsibility (use `saveAiConfig` to do both).
     */
    setAiConfig: (updates) => set({ aiConfig: { ...get().aiConfig, ...updates } }),
  };
}

// Thin non-hook wrappers so the barrel API (and every caller) is unchanged;
// they delegate to the actions living inside the store.

export function setAiConfig(updates: Partial<AiConfigState>): void {
  getState().setAiConfig(updates);
}

/**
 * Read the current AI config mirror (non-reactive, for use outside React).
 */
export function getAiConfig(): AiConfigState {
  return getState().aiConfig;
}

/**
 * Hook to subscribe to the AI config mirror.
 */
export function useAiConfigState(): AiConfigState {
  return useStoreValue(s => s.aiConfig);
}
