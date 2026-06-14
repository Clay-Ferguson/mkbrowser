import { useEffect, useState, useCallback } from 'react';
import { api } from '../../../services/api';

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
 * Loads the AI-related slice of the app config once on mount and exposes it as
 * a single state object. Consolidating into one state means the mount-time load
 * fires ONE React update instead of several — multiple separate setState calls
 * per mount multiplied the update pressure that was tripping React's nested
 * update limit when entries re-mount. The `cancelled` guard prevents a resolve
 * after unmount from calling setState on a dead component.
 *
 * `tagsVisible` only applies to the markdown editor; text entries can simply
 * ignore it.
 */
export function useAiConfig(): UseAiConfigResult {
  const [config, setConfig] = useState<AiConfigState>({
    aiEnabled: false,
    aiRewriteMode: false,
    selectedPromptName: '',
    tagsVisible: false,
  });

  useEffect(() => {
    let cancelled = false;
    void api.getConfig().then((c) => {
      if (cancelled) return;
      setConfig({
        aiEnabled: !!c.aiEnabled,
        aiRewriteMode: !!c.aiRewriteMode,
        selectedPromptName: c.aiRewritePrompt ?? '',
        tagsVisible: c.tagsPanelVisible ?? false,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTagsVisible = useCallback((visible: boolean) => {
    setConfig((prev) => ({ ...prev, tagsVisible: visible }));
  }, []);

  return { ...config, setTagsVisible };
}
