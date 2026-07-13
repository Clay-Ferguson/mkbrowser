import { load } from 'js-yaml';

/**
 * True when a YAML string holds no document at all — empty, whitespace only, or
 * nothing but comments. In YAML a line whose first non-space character is `#` is
 * always a comment, so stripping whole comment lines and checking for leftover
 * content is a complete test. (The stripped copy is only used to decide
 * emptiness — never to parse — so a `#` inside a block scalar is harmless: the
 * lines around it survive and the document reads as non-empty.)
 */
function isEmptyYamlDocument(yamlStr: string): boolean {
  return yamlStr.replace(/^[ \t]*#.*$/gm, '').trim() === '';
}

/**
 * `js-yaml`'s `load()` with the empty-document behaviour of js-yaml 4.
 *
 * js-yaml 5 throws (`expected a document, but the input is empty`) where v4
 * returned `undefined`. Empty front matter (`---\n---\n`) is legitimate and
 * common here, and every caller draws a sharp line between the two outcomes: a
 * nullish parse means "no data, carry on" (`?? {}`, `if (!parsed)`), while a
 * throw means "malformed — refuse to touch this file". Letting empty input
 * throw would push callers down the refuse path and silently decline to add a
 * tag or a front-matter property, or warn the user that valid front matter is
 * corrupt.
 *
 * So: empty input parses to `undefined`, and only genuinely malformed YAML
 * throws. Use this instead of importing `load` directly.
 */
export function loadYaml(yamlStr: string): unknown {
  if (isEmptyYamlDocument(yamlStr)) return undefined;
  return load(yamlStr);
}
