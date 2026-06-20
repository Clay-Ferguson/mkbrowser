import type { AiConfigState } from '../types/types';
import { getState, setState, useStoreValue, defaultAiConfig } from './core';

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
 * Merge partial updates into the in-memory AI config mirror and notify
 * subscribers. This only updates the renderer mirror — persistence to the main
 * process is the caller's responsibility (use `saveAiConfig` to do both).
 */
export function setAiConfig(updates: Partial<AiConfigState>): void {
  setState({ aiConfig: { ...getState().aiConfig, ...updates } });
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
