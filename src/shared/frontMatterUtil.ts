import { load, dump } from 'js-yaml';
import { logger } from './logUtil';

export interface FrontMatterResult {
  /** Parsed YAML front matter as a plain object, or null if none was found. */
  yaml: Record<string, unknown> | null;
  /** The body of the file with the front matter block removed. */
  content: string;
}

export interface FrontMatterSplit {
  /** Raw YAML text between the fences — no fences, no surrounding newlines, no stray `\r`. */
  yamlStr: string;
  /** Document body after the closing fence and its trailing newline. */
  body: string;
}

/**
 * Single source of truth for front-matter fence detection. Opening `---` (with optional
 * trailing whitespace) on its own line; lazy body; closing `---` (optional trailing
 * whitespace) anchored to its own line or end-of-file. CRLF-tolerant so reads and writes
 * never disagree on line endings.
 */
const FRONT_MATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Split markdown into its raw front-matter YAML text and body, or null if there is no
 * closed fence. Unlike {@link parseFrontMatter}, this does NOT parse the YAML — callers
 * that only need the raw block (e.g. regex-based property editing) avoid the parse cost.
 */
export function splitFrontMatter(content: string): FrontMatterSplit | null {
  const m = FRONT_MATTER_RE.exec(content);
  if (!m) return null;
  return { yamlStr: m[1] ?? '', body: content.slice(m[0].length) };
}

/**
 * Parses YAML front matter from the beginning of a file's content, using the same fence
 * grammar as {@link splitFrontMatter} so the read and write paths can never disagree about
 * what counts as front matter. Everything after the closing fence is returned as `content`.
 *
 * Returns `yaml: null` when no valid front matter block is detected.
 */
export function parseFrontMatter(rawContent: string): FrontMatterResult {
  const parts = splitFrontMatter(rawContent);
  if (!parts) {
    return { yaml: null, content: rawContent };
  }

  try {
    const parsed = load(parts.yamlStr);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { yaml: parsed as Record<string, unknown>, content: parts.body };
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
    parsed = load(parts.yamlStr) ?? {};
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
    const parsed = load(yamlStr) as Record<string, unknown> | null;
    if (!parsed) return {};
    const { tags: _tags, ...rest } = parsed;
    return rest;
  } catch {
    return {};
  }
}
