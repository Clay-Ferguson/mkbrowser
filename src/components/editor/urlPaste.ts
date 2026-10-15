/**
 * Pure helpers for the Markdown editor's "paste a URL → Insert link dialog" behaviour
 * (see useUrlPaste).
 */

/** Longest pasted text still treated as a URL to link rather than text to paste. */
const MAX_URL_LENGTH = 500;

/**
 * Whether pasted text is a lone http(s) URL: one line, under MAX_URL_LENGTH characters, no
 * whitespace inside. Surrounding whitespace (e.g. a trailing newline from a terminal copy)
 * is ignored.
 */
export function isPastedUrl(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length < MAX_URL_LENGTH && /^https?:\/\/\S+$/i.test(trimmed);
}

/** Whether every `(` in `url` is closed by a later `)` — the only form a bare link destination allows. */
function hasBalancedParens(url: string): boolean {
  let depth = 0;
  for (const ch of url) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * `[title](url)`, with the title's `\`, `[` and `]` escaped so it can't end the link text
 * early, and the URL wrapped in `<…>` when it holds characters a bare link destination can't
 * (whitespace, unbalanced parentheses, `<`/`>`). A blank title falls back to the URL itself.
 */
export function formatUrlMarkdownLink(title: string, url: string): string {
  const label = (title.trim() || url).replace(/[\\[\]]/g, '\\$&');
  const dest = /[\s<>]/.test(url) || !hasBalancedParens(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
  return `[${label}](${dest})`;
}
