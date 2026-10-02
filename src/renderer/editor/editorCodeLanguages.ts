import { StreamLanguage } from '@codemirror/language';
import type { Language } from '@codemirror/language';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';

// Defined once: StreamLanguage.define builds a new Language (with its own parser and node
// set) on every call, and lang-markdown asks for a fenced block's language on every parse.
const yamlLanguage = StreamLanguage.define(yaml);

/**
 * Languages highlighted inside a Markdown document's fenced code blocks, keyed by the fence's
 * info string (the word after the opening ```), lower-cased.
 *
 * YAML is here because typed object blocks (see DEVELOPER_GUIDE § "Typed Object Blocks") are
 * edited as YAML: colouring keys apart from values makes a block read as fields and values.
 */
const FENCED_CODE_LANGUAGES = new Map<string, Language>([
  ['yaml', yamlLanguage],
  ['yml', yamlLanguage],
]);

/**
 * `codeLanguages` callback for lang-markdown's `markdown()`: returns the language to parse a
 * fenced block's content with, or null to leave it as plain (uniformly coloured) code text.
 */
export function fencedCodeLanguage(info: string): Language | null {
  return FENCED_CODE_LANGUAGES.get(info.toLowerCase()) ?? null;
}
