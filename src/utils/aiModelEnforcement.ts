export type AIProvider = 'ANTHROPIC' | 'OLLAMA' | 'OPENAI' | 'GOOGLE';

export interface AIModelConfigLike {
  name: string;
  provider: AIProvider;
  model: string;
  readonly?: boolean;
}

export interface EnforceDefaultModelsResult<T extends AIModelConfigLike> {
  models: Array<Omit<T, 'readonly'> & { readonly: boolean }>;
  selectedModel: string;
  changed: boolean;
}

function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeModel<T extends AIModelConfigLike>(model: T, readonly: boolean): Omit<T, 'readonly'> & { readonly: boolean } {
  return {
    ...model,
    name: model.name.trim(),
    model: model.model.trim(),
    readonly,
  };
}

function modelsEqual(a: AIModelConfigLike, b: AIModelConfigLike): boolean {
  return (
    a.name === b.name &&
    a.provider === b.provider &&
    a.model === b.model &&
    Boolean(a.readonly) === Boolean(b.readonly)
  );
}

/**
 * Enforce that all default AI models are present and take precedence.
 *
 * - Name matching is case-insensitive.
 * - Any user model colliding with a default model name is overwritten by the default.
 * - Non-default models are normalized to `readonly: false`.
 * - Defaults appear first (in the order provided), then remaining user models in original order.
 * - The selected model name is canonicalized to the matched model's `name`, or set to the provided default.
 */
export function enforceDefaultAIModels<T extends AIModelConfigLike>(args: {
  existingModels?: T[];
  defaultModels: Array<Omit<T, 'readonly'> & { readonly: boolean }>;
  selectedModelName?: string;
  defaultSelectedModelName: string;
}): EnforceDefaultModelsResult<T> {
  const existingModels = args.existingModels ?? [];

  const defaultByKey = new Map<string, Omit<T, 'readonly'> & { readonly: boolean }>();
  for (const d of args.defaultModels) {
    defaultByKey.set(normalizeKey(d.name), d);
  }

  // Keep user models in original order, deduped case-insensitively, excluding any that collide with defaults.
  const seenUserKeys = new Set<string>();
  const userModels: Array<Omit<T, 'readonly'> & { readonly: boolean }> = [];

  for (const m of existingModels) {
    const key = normalizeKey(m.name);
    if (!key) continue;

    // Defaults always win, so drop any colliding entry.
    if (defaultByKey.has(key)) continue;

    if (seenUserKeys.has(key)) continue;
    seenUserKeys.add(key);

    userModels.push(normalizeModel(m, false));
  }

  const enforcedModels: Array<Omit<T, 'readonly'> & { readonly: boolean }> = [
    ...args.defaultModels.map((d) => normalizeModel(d as unknown as T, true)),
    ...userModels,
  ];

  // Canonicalize selection.
  const selectedKey = args.selectedModelName ? normalizeKey(args.selectedModelName) : '';
  const selectedMatch = selectedKey
    ? enforcedModels.find((m) => normalizeKey(m.name) === selectedKey)
    : undefined;
  const selectedModel = selectedMatch ? selectedMatch.name : args.defaultSelectedModelName;

  // Detect whether anything changed.
  let changed = false;

  if (existingModels.length !== enforcedModels.length) {
    changed = true;
  } else {
    for (let i = 0; i < enforcedModels.length; i++) {
      if (!modelsEqual(existingModels[i], enforcedModels[i])) {
        changed = true;
        break;
      }
    }
  }

  if (args.selectedModelName !== selectedModel) {
    changed = true;
  }

  // If aiModels was missing/undefined and we produced models, that is a change.
  if (args.existingModels === undefined && enforcedModels.length > 0) {
    changed = true;
  }

  return { models: enforcedModels, selectedModel, changed };
}
