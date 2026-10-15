import { logger } from '../shared/logUtil';

/**
 * Page-title lookup for the editor's "paste a URL → Markdown link" prompt.
 *
 * Only HTML responses are read, and only up to MAX_TITLE_BYTES (or until `</title>` has
 * arrived), so pasting a link to a large media file or archive costs one response header,
 * never the download. The fetch function is injected (main.ts passes Electron's `net.fetch`,
 * which uses Chromium's network stack and so honours the system proxy) so the reading logic
 * can be unit-tested without Electron.
 *
 * MAIN PROCESS ONLY.
 */

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** How much of an HTML page is read looking for the title. */
export const MAX_TITLE_BYTES = 256 * 1024;

/** Give up on slow servers; the dialog is already open and works without a title. */
const FETCH_TIMEOUT_MS = 5000;

const HTML_CONTENT_TYPE = /^\s*(text\/html|application\/xhtml\+xml)\b/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»',
};

/** Decodes numeric entities and the common named ones; unknown names are left as written. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function cleanTitle(raw: string): string {
  return decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim();
}

/**
 * The page title from (possibly truncated) HTML: the `<title>` element, falling back to an
 * Open Graph `og:title` meta tag. Empty string when neither is present.
 */
export function extractHtmlTitle(html: string): string {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title) {
    const cleaned = cleanTitle(title[1] ?? '');
    if (cleaned) return cleaned;
  }
  // og:title, with the attributes in either order.
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bproperty\s*=\s*["']og:title["']/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (content) return cleanTitle(content[1] ?? content[2] ?? '');
  }
  return '';
}

/** The `charset=` of a content-type, if TextDecoder knows it; else UTF-8. */
function decoderFor(contentType: string): TextDecoder {
  const charset = /charset\s*=\s*["']?([^"';\s]+)/i.exec(contentType)?.[1];
  if (charset) {
    try {
      return new TextDecoder(charset);
    } catch {
      // Unknown label — fall through to UTF-8.
    }
  }
  return new TextDecoder('utf-8');
}

/** Reads at most MAX_TITLE_BYTES of the body, stopping early once `</title>` has arrived. */
async function readHead(body: ReadableStream<Uint8Array>, decoder: TextDecoder): Promise<string> {
  const reader = body.getReader();
  let html = '';
  let bytes = 0;
  while (bytes < MAX_TITLE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value.byteLength + bytes > MAX_TITLE_BYTES ? value.subarray(0, MAX_TITLE_BYTES - bytes) : value;
    bytes += chunk.byteLength;
    html += decoder.decode(chunk, { stream: true });
    if (/<\/title>/i.test(html)) break;
  }
  await reader.cancel().catch(() => undefined);
  return html;
}

/**
 * The title of the HTML page at `url`, or '' when it can't be had: not http(s), a network
 * error or timeout, a non-2xx status, a non-HTML content type, or no title in the first
 * MAX_TITLE_BYTES. Never rejects.
 */
export async function fetchUrlTitle(url: string, fetchFn: FetchFn): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';

  return fetchFn(parsed.href, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' },
  })
    .then(async (res) => {
      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok || !res.body || !HTML_CONTENT_TYPE.test(contentType)) {
        // Drop the body unread — this is what keeps media files from being downloaded.
        await res.body?.cancel().catch(() => undefined);
        return '';
      }
      return extractHtmlTitle(await readHead(res.body, decoderFor(contentType)));
    })
    .catch((err: unknown) => {
      logger.warn(`Could not fetch page title for ${parsed.href}:`, err);
      return '';
    });
}
