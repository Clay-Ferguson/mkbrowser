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
 * Whether `title` adds nothing as link text for `url`: blank, or just the URL itself. Such a
 * title is never suggested in the dialog, and a link with one is written as the bare URL.
 */
export function isUselessLinkTitle(title: string, url: string): boolean {
  const trimmed = title.trim();
  return !trimmed || trimmed === url.trim();
}

/**
 * `[title](url)`, with the title's `\`, `[` and `]` escaped so it can't end the link text
 * early, and the URL wrapped in `<…>` when it holds characters a bare link destination can't
 * (whitespace, unbalanced parentheses, `<`/`>`). A blank title, or one that is just the URL,
 * gives the bare URL instead — `[url](url)` is never better than `url`.
 */
export function formatUrlMarkdownLink(title: string, url: string): string {
  if (isUselessLinkTitle(title, url)) return url;
  const label = title.trim().replace(/[\\[\]]/g, '\\$&');
  const dest = /[\s<>]/.test(url) || !hasBalancedParens(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
  return `[${label}](${dest})`;
}
