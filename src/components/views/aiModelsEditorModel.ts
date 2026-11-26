// See: (USER_GUIDE.md#configuring-ai-models)
import type { AIModelConfig, AIProvider } from '../../shared/shared';

/**
 * Pure model for the AI Models tab (AIModelsView): converts the persisted
 * `aiModels` list to an id-keyed editor model and back, validates it before
 * save, and works out which model is active after a save. Kept free of React
 * so it can be unit tested.
 */

export interface EditorModel {
  /** Stable per-row key for the editor session. */
  id: string;
  /** The name this row had when loaded (undefined for a row added in this session). Used to follow the active model across a rename. */
  originalName?: string;
  name: string;
  provider: AIProvider;
  model: string;
  baseUrl: string;
  vision: boolean;
  /** Prices are held as raw text so the fields can be plain text inputs; parsed on save. */
  inputText: string;
  outputText: string;
}

// Stable per-row keys for the editor's local model; only need to be unique within a session.
function newId() { return crypto.randomUUID(); }

/** Trim and lowercase a model name for case-insensitive comparison. */
export function modelNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** A finite number ≥ 0 parsed from the text, or null. Blank text is invalid. */
export function parsePrice(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** True when the text is an absolute http(s) URL. */
function isHttpUrl(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const { protocol } = new URL(text);
  return protocol === 'http:' || protocol === 'https:';
}

/** A new, empty model row. */
export function newEditorModel(): EditorModel {
  return {
    id: newId(),
    name: '',
    provider: 'ANTHROPIC',
    model: '',
    baseUrl: '',
    vision: false,
    inputText: '0',
    outputText: '0',
  };
}

/** Convert the persisted model list into the editor model. Inverse of toConfig. */
export function fromConfig(models: AIModelConfig[]): EditorModel[] {
  return models.map((m) => ({
    id: newId(),
    originalName: m.name,
    name: m.name,
    provider: m.provider,
    model: m.model,
    baseUrl: m.baseUrl ?? '',
    vision: m.vision,
    inputText: String(m.inputPer1M),
    outputText: String(m.outputPer1M),
  }));
}

/**
 * Convert the editor model back to the persisted shape: trim text fields, parse
 * prices (an unparseable price becomes 0 — callers validate first), and omit a
 * blank Base URL. Inverse of fromConfig.
 */
export function toConfig(editor: EditorModel[]): AIModelConfig[] {
  return editor.map((m) => {
    const baseUrl = m.baseUrl.trim();
    return {
      name: m.name.trim(),
      provider: m.provider,
      model: m.model.trim(),
      ...(baseUrl ? { baseUrl } : {}),
      vision: m.vision,
      inputPer1M: parsePrice(m.inputText) ?? 0,
      outputPer1M: parsePrice(m.outputText) ?? 0,
    };
  });
}

/** Rows sorted by name, the order the list displays them in. */
export function sortByName(editor: EditorModel[]): EditorModel[] {
  return [...editor].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Return the first problem that should block a save, or null when the model is
 * valid. Messages name the offending model so they make sense without a selection.
 *
 * See: (USER_GUIDE.md#configuring-ai-models)
 */
export function validate(editor: EditorModel[]): string | null {
  const seen = new Set<string>();
  for (const m of editor) {
    const name = m.name.trim();
    if (!name) return 'Every model needs a name.';
    const key = modelNameKey(name);
    if (seen.has(key)) return `Two models are named "${name}". Model names must be unique.`;
    seen.add(key);
    if (!m.model.trim()) return `Model "${name}" needs a Model ID.`;
    if (parsePrice(m.inputText) === null) return `Model "${name}": Input $/1M must be a number of 0 or more.`;
    if (parsePrice(m.outputText) === null) return `Model "${name}": Output $/1M must be a number of 0 or more.`;
    const baseUrl = m.baseUrl.trim();
    if (baseUrl && !isHttpUrl(baseUrl)) return `Model "${name}": Base URL must start with http:// or https://.`;
  }
  return null;
}

/**
 * The active model's name after saving `editor`, given the active name at save
 * time. Follows the active row across a rename (matched by its loaded name);
 * when it was deleted, or nothing was active, the first model in display order
 * becomes active, or '' when no models remain.
 */
export function resolveActive(editor: EditorModel[], currentActive: string): string {
  const key = modelNameKey(currentActive);
  const row = key ? editor.find((m) => m.originalName !== undefined && modelNameKey(m.originalName) === key) : undefined;
  if (row) return row.name.trim();
  return sortByName(editor)[0]?.name.trim() ?? '';
}

/**
 * The editor rows as they stand after a successful save: text trimmed (as
 * persisted) and each row's `originalName` reset to its saved name, so the next
 * save follows renames from this point. Row ids are kept, so the selection survives.
 */
export function markSaved(editor: EditorModel[]): EditorModel[] {
  return editor.map((m) => {
    const name = m.name.trim();
    return { ...m, originalName: name, name, model: m.model.trim(), baseUrl: m.baseUrl.trim(), inputText: m.inputText.trim(), outputText: m.outputText.trim() };
  });
}
