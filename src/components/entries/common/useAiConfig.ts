import { setAiConfig, useAS } from '../../../store';

export interface AiConfigState {
  /** Whether AI features are enabled at all. */
  aiEnabled: boolean;
  /** Whether the AI rewrite button is shown in editors. */
  aiRewriteMode: boolean;
  /** Display name of the selected rewrite prompt/persona (empty if none). */
  selectedPromptName: string;
  /** Whether the tags panel is shown in the markdown editor. */
  tagsVisible: boolean;
}

export interface UseAiConfigResult extends AiConfigState {
  /** Locally toggle tags-panel visibility (persisting is the caller's job). */
  setTagsVisible: (visible: boolean) => void;
}

/**
 * Exposes the AI-related slice of the app config as a single reactive object.
 *
 * The values come from the store's AI config mirror (`store/aiConfig.ts`), which
 * is seeded once at startup and kept in sync by `saveAiConfig` whenever these
 * fields are persisted. Subscribing to the store — rather than fetching config
 * once on mount — is what lets long-lived consumers (entries never unmount once
 * their view is visited) react to persona / rewrite-mode changes made later in
 * AISettingsView or ThreadView.
 *
 * `tagsVisible` only applies to the markdown editor; text entries can simply
 * ignore it. `setTagsVisible` updates the mirror only; callers that want the
 * change to survive a restart must also persist it (see `saveAiConfig`).
 */
export function useAiConfig(): UseAiConfigResult {
  const { aiEnabled, aiRewriteMode, aiRewritePrompt, tagsPanelVisible } = useAS(s => s.aiConfig);

  const setTagsVisible = (visible: boolean) => {
    setAiConfig({ tagsPanelVisible: visible });
  };

  return {
    aiEnabled,
    aiRewriteMode,
    selectedPromptName: aiRewritePrompt,
    tagsVisible: tagsPanelVisible,
    setTagsVisible,
  };
}
