import { dump, load, visit } from 'js-yaml';

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

const NULL_TAG = 'tag:yaml.org,2002:null';

/**
 * `js-yaml`'s `dump()` for front matter: no line wrapping, and a null value is written as
 * nothing at all (`name:`) instead of `name: null`.
 *
 * An inserted object leaves its properties blank (`name: `), which parses to null. Without
 * this, the next rewrite of the front matter (a tag edit, a calendar save, …) would spell
 * every one of them out as `null`. Both forms load back as null, so nothing else changes.
 * Use this for every front-matter write.
 */
export function dumpYaml(value: unknown): string {
  return dump(value, {
    lineWidth: -1,
    transform: (documents) => {
      visit(documents, (node) => {
        if (node.kind === 'scalar' && node.tag === NULL_TAG) node.value = '';
      });
    },
  });
}
