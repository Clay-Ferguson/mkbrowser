import { dump } from 'js-yaml';
import { loadYaml } from './yamlUtil';
import { logger } from './logUtil';

export interface FrontMatterResult {
  /** Parsed YAML front matter as a plain object, or null if none was found. */
  yaml: Record<string, unknown> | null;
  /** The body of the file with the front matter block removed. */
  content: string;
}

export interface FrontMatterSplit {
  /**
   * Raw YAML text between the fences — no fences, no surrounding newlines, and LF-only:
   * a CRLF document's interior `\r` are stripped here so the regex-based property editors
   * downstream can match on a bare `\n`. The write helpers emit LF fences regardless, so
   * front matter is LF-only either way.
   */
  yamlStr: string;
  /** Document body after the closing fence and its trailing newline, verbatim (CRLF preserved). */
  body: string;
}

/**
 * Single source of truth for front-matter fence detection. Opening `---` (with optional
 * trailing whitespace) on its own line; lazy body; closing `---` (optional trailing
 * whitespace) anchored to its own line or end-of-file. CRLF-tolerant so reads and writes
 * never disagree on line endings.
 *
 * The body (and the newline ending it) is optional, so the degenerate `---\n---\n` — a
 * block with no lines at all between the fences — is recognized as *empty* front matter
 * rather than as no front matter. Requiring at least one line there meant the writers
 * fell through to their "no front matter" branch and wrapped a fresh block around the
 * old fences, producing `---\nkey: v\n---\n---\n---\nBody.`. When the body is absent the
 * capture group is undefined, which the `?? ''` in splitFrontMatter already handles.
 */
const FRONT_MATTER_RE = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/**
 * Split markdown into its raw front-matter YAML text and body, or null if there is no
 * closed fence. Unlike {@link parseFrontMatter}, this does NOT parse the YAML — callers
 * that only need the raw block (e.g. regex-based property editing) avoid the parse cost.
 */
export function splitFrontMatter(content: string): FrontMatterSplit | null {
  const m = FRONT_MATTER_RE.exec(content);
  if (!m) return null;
  return { yamlStr: (m[1] ?? '').replace(/\r\n/g, '\n'), body: content.slice(m[0].length) };
}

/**
 * Parses YAML front matter from the beginning of a file's content, using the same fence
 * grammar as {@link splitFrontMatter} so the read and write paths can never disagree about
 * what counts as front matter. Everything after the closing fence is returned as `content`.
 *
 * Returns `yaml: null` when no front matter block yielded a mapping. `content` then depends
 * on *why*, and the distinction matters because callers rebuild the document as
 * `---\n<dump(yaml)>---\n<content>`:
 *
 *  - An **empty** block (blank, whitespace, or comments only) is a real block that simply
 *    holds no data, so its fences are consumed and `content` is the body. Returning the raw
 *    text here would make those callers wrap a fresh block around the old one and emit
 *    `---\nid: x\n---\n---\n\n---\nBody.`
 *  - **Malformed** YAML, or a block whose top level is a scalar or list rather than a
 *    mapping, returns the content untouched — we can't represent it, so we refuse to
 *    consume the fences and risk destroying data the user can still recover by hand.
 */
export function parseFrontMatter(rawContent: string): FrontMatterResult {
  const parts = splitFrontMatter(rawContent);
  if (!parts) {
    return { yaml: null, content: rawContent };
  }

  try {
    const parsed = loadYaml(parts.yamlStr);
    if (parsed !== null && parsed !== undefined && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { yaml: parsed as Record<string, unknown>, content: parts.body };
    }
    if (parsed === null || parsed === undefined) {
      // An empty block: no data, but the fences are still front matter and are consumed.
      return { yaml: null, content: parts.body };
    }
  } catch (err) {
    // Malformed YAML — treat as no front matter
    logger.debug(`parseFrontMatter: ignoring malformed YAML front matter: ${err}`);
  }

  return { yaml: null, content: rawContent };
}

/** Wrap a YAML string and body back into a front-matter document. Empty YAML yields just the body. */
export function assembleFrontMatter(yamlContent: string, body: string): string {
  const trimmed = yamlContent.trim();
  return trimmed ? `---\n${trimmed}\n---\n${body}` : body;
}

/**
 * Sets or replaces a single property in a markdown document's front matter using a
 * real YAML parse/dump. The whole block is re-serialized in canonical form — comments
 * and hand formatting are not preserved (accepted app-wide, same as tag edits). If no
 * front matter exists, a block is created. If the existing YAML can't be parsed (or
 * isn't a mapping), the content is returned unchanged rather than risking data loss.
 */
export function setFrontMatterProperty(content: string, key: string, value: unknown): string {
  const parts = splitFrontMatter(content);
  if (!parts) {
    return assembleFrontMatter(dump({ [key]: value }, { lineWidth: -1 }), content);
  }
  let parsed: unknown;
  try {
    parsed = loadYaml(parts.yamlStr) ?? {};
  } catch {
    return content;
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return content;
  const yaml = parsed as Record<string, unknown>;
  yaml[key] = value;
  return assembleFrontMatter(dump(yaml, { lineWidth: -1 }), parts.body);
}

/** Returns all front matter properties except 'tags', preserving their parsed types. */
export function getPropsFromYaml(yamlStr: string): Record<string, unknown> {
  try {
    const parsed = loadYaml(yamlStr) as Record<string, unknown> | null;
    if (!parsed) return {};
    const { tags: _tags, ...rest } = parsed;
    return rest;
  } catch {
    return {};
  }
}
