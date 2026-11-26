// See: (USER_GUIDE.md#configuring-personas)
import type { AIRewritePromptDef } from '../../shared/shared';
import { DEFAULT_PERSONA_NAME } from '../../shared/ai/aiPrompts';

/**
 * Pure model for the AI Personas tab (AIPersonasView): converts the persisted
 * `aiRewritePrompts` list to an id-keyed editor model and back, validates it
 * before save, and works out which persona is active after a save. Kept free of
 * React so it can be unit tested. The built-in [Default Agent] persona is not
 * part of this model — it isn't editable and is never persisted.
 */

export interface EditorPersona {
  /** Stable per-row key for the editor session. */
  id: string;
  /** The name this row had when loaded (undefined for a row added in this session). Used to follow the active persona across a rename. */
  originalName?: string;
  name: string;
  /** The persona's instructions, kept exactly as typed. */
  prompt: string;
}

// Stable per-row keys for the editor's local model; only need to be unique within a session.
function newId() { return crypto.randomUUID(); }

/** Trim and lowercase a persona name for case-insensitive comparison. */
export function personaNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** A new, empty persona row. */
export function newEditorPersona(): EditorPersona {
  return { id: newId(), name: '', prompt: '' };
}

/** Convert the persisted persona list into the editor model. Inverse of toConfig. */
export function fromConfig(prompts: AIRewritePromptDef[]): EditorPersona[] {
  return prompts.map((p) => ({ id: newId(), originalName: p.name, name: p.name, prompt: p.prompt }));
}

/** Convert the editor model back to the persisted shape (names trimmed). Inverse of fromConfig. */
export function toConfig(editor: EditorPersona[]): AIRewritePromptDef[] {
  return editor.map((p) => ({ name: p.name.trim(), prompt: p.prompt }));
}

/** Rows sorted by name, the order the list displays them in. */
export function sortByName(editor: EditorPersona[]): EditorPersona[] {
  return [...editor].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Return the first problem that should block a save, or null when valid.
 * Empty instructions are allowed (the persona then adds nothing to the prompt).
 *
 * See: (USER_GUIDE.md#configuring-personas)
 */
export function validate(editor: EditorPersona[]): string | null {
  const seen = new Set<string>();
  const reservedKey = personaNameKey(DEFAULT_PERSONA_NAME);
  for (const p of editor) {
    const name = p.name.trim();
    if (!name) return 'Every persona needs a name.';
    const key = personaNameKey(name);
    if (key === reservedKey) return `"${DEFAULT_PERSONA_NAME}" is the built-in persona's name. Choose a different name.`;
    if (seen.has(key)) return `Two personas are named "${name}". Persona names must be unique.`;
    seen.add(key);
  }
  return null;
}

/**
 * The active persona's name after saving `editor`, given the active name at
 * save time. Follows the active row across a rename (matched by its loaded
 * name). Returns '' — meaning the built-in [Default Agent] — when the active
 * persona was deleted or the default was active.
 */
export function resolveActive(editor: EditorPersona[], currentActive: string): string {
  const key = personaNameKey(currentActive);
  if (!key || key === personaNameKey(DEFAULT_PERSONA_NAME)) return '';
  const row = editor.find((p) => p.originalName !== undefined && personaNameKey(p.originalName) === key);
  return row ? row.name.trim() : '';
}

/**
 * The editor rows as they stand after a successful save: names trimmed (as
 * persisted) and each row's `originalName` reset to its saved name, so the next
 * save follows renames from this point. Row ids are kept, so the selection survives.
 */
export function markSaved(editor: EditorPersona[]): EditorPersona[] {
  return editor.map((p) => {
    const name = p.name.trim();
    return { ...p, originalName: name, name };
  });
}
