import { load } from 'js-yaml';
import { logger } from './logUtil';

export interface FrontMatterResult {
  /** Parsed YAML front matter as a plain object, or null if none was found. */
  yaml: Record<string, unknown> | null;
  /** The body of the file with the front matter block removed. */
  content: string;
}

/** Length of the opening front-matter delimiter (`---`). */
const OPEN_DELIM_LEN = 3;

/**
 * Parses YAML front matter from the beginning of a file's content.
 *
 * Front matter is a block delimited by `---` on its own line at the very start
 * of the content and a closing `---` (or `...`) on its own line. Everything
 * after the closing delimiter is returned as `content`.
 *
 * Returns `yaml: null` when no valid front matter block is detected.
 */
export function parseFrontMatter(rawContent: string): FrontMatterResult {
  // Front matter must start at the very beginning of the file
  if (!rawContent.startsWith('---')) {
    return { yaml: null, content: rawContent };
  }

  // Find the closing delimiter (--- or ...) on its own line.
  // Allow only spaces/tabs (not newlines) after the delimiter so a blank line
  // following the front matter is preserved as part of the body rather than
  // being silently swallowed — Markdown is whitespace-sensitive.
  const afterOpen = rawContent.slice(OPEN_DELIM_LEN);
  const closingMatch = afterOpen.match(/\n(---|\.\.\.)[^\S\n]*(\n|$)/);
  if (!closingMatch || closingMatch.index === undefined) {
    return { yaml: null, content: rawContent };
  }

  const yamlSource = afterOpen.slice(0, closingMatch.index);
  const bodyStart = closingMatch.index + closingMatch[0].length + OPEN_DELIM_LEN;
  const body = rawContent.slice(bodyStart);

  try {
    const parsed = load(yamlSource);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { yaml: parsed as Record<string, unknown>, content: body };
    }
  } catch (err) {
    // Malformed YAML — treat as no front matter
    logger.debug(`parseFrontMatter: ignoring malformed YAML front matter: ${err}`);
  }

  return { yaml: null, content: rawContent };
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
  return { yamlStr: m[1], body: content.slice(m[0].length) };
}

/** Wrap a YAML string and body back into a front-matter document. Empty YAML yields just the body. */
export function assembleFrontMatter(yamlContent: string, body: string): string {
  const trimmed = yamlContent.trim();
  return trimmed ? `---\n${trimmed}\n---\n${body}` : body;
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
