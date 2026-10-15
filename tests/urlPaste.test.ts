/**
 * Pasting a URL into the Markdown editor: which pasted text counts as a URL, how the
 * `[title](url)` link is written, and how the page title is read (only from HTML, and only
 * from the start of the body).
 */
import { describe, it, expect, vi } from 'vitest';
import { formatUrlMarkdownLink, isPastedUrl } from '../src/components/editor/urlPaste';
import { decodeHtmlEntities, extractHtmlTitle, fetchUrlTitle, MAX_TITLE_BYTES } from '../src/main/urlTitle';

describe('isPastedUrl', () => {
  it('accepts a lone http or https URL', () => {
    expect(isPastedUrl('https://example.com/a?b=c#d')).toBe(true);
    expect(isPastedUrl('http://example.com')).toBe(true);
    expect(isPastedUrl('HTTPS://EXAMPLE.COM')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(isPastedUrl('  https://example.com\n')).toBe(true);
  });

  it('rejects other schemes and plain text', () => {
    expect(isPastedUrl('ftp://example.com')).toBe(false);
    expect(isPastedUrl('see https://example.com')).toBe(false);
    expect(isPastedUrl('https://')).toBe(false);
  });

  it('rejects multi-line text and text with spaces', () => {
    expect(isPastedUrl('https://example.com\nhttps://example.org')).toBe(false);
    expect(isPastedUrl('https://example.com/a b')).toBe(false);
  });

  it('rejects text of 500 characters or more', () => {
    const base = 'https://example.com/';
    expect(isPastedUrl(base + 'a'.repeat(499 - base.length))).toBe(true);
    expect(isPastedUrl(base + 'a'.repeat(500 - base.length))).toBe(false);
  });
});

describe('formatUrlMarkdownLink', () => {
  it('writes [title](url)', () => {
    expect(formatUrlMarkdownLink('Example', 'https://example.com')).toBe('[Example](https://example.com)');
  });

  it('escapes brackets and backslashes in the title', () => {
    expect(formatUrlMarkdownLink('a [b] \\c', 'https://x.io')).toBe('[a \\[b\\] \\\\c](https://x.io)');
  });

  it('falls back to the URL for a blank title', () => {
    expect(formatUrlMarkdownLink('  ', 'https://x.io')).toBe('[https://x.io](https://x.io)');
  });

  it('keeps balanced parentheses bare and wraps unbalanced ones', () => {
    expect(formatUrlMarkdownLink('W', 'https://en.wikipedia.org/wiki/Foo_(bar)')).toBe('[W](https://en.wikipedia.org/wiki/Foo_(bar))');
    expect(formatUrlMarkdownLink('W', 'https://x.io/a)b')).toBe('[W](<https://x.io/a)b>)');
  });
});

describe('extractHtmlTitle', () => {
  it('reads the <title> element, decoding entities and collapsing whitespace', () => {
    expect(extractHtmlTitle('<html><head><title lang="en">\n  Tom &amp; Jerry &#8212; &#x41;\n</title>')).toBe('Tom & Jerry — A');
  });

  it('falls back to og:title, in either attribute order', () => {
    expect(extractHtmlTitle('<meta property="og:title" content="OG one">')).toBe('OG one');
    expect(extractHtmlTitle("<meta content='OG two' property='og:title'/>")).toBe('OG two');
  });

  it('prefers a non-empty <title> over og:title, and skips an empty one', () => {
    expect(extractHtmlTitle('<title>T</title><meta property="og:title" content="O">')).toBe('T');
    expect(extractHtmlTitle('<title> </title><meta property="og:title" content="O">')).toBe('O');
  });

  it('returns empty when there is no title', () => {
    expect(extractHtmlTitle('<html><body>hi</body></html>')).toBe('');
  });
});

describe('decodeHtmlEntities', () => {
  it('leaves unknown and out-of-range entities alone', () => {
    expect(decodeHtmlEntities('&bogus; &#0; &lt;')).toBe('&bogus; &#0; <');
  });
});

/** A streamed Response whose body yields `chunks`, recording how many were pulled. */
function streamedResponse(chunks: string[], contentType: string, status = 200) {
  const enc = new TextEncoder();
  const state = { pulled: 0, cancelled: false };
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      state.pulled++;
      controller.enqueue(enc.encode(chunks[i++]));
    },
    cancel() {
      state.cancelled = true;
    },
  }, { highWaterMark: 0 });
  const res = new Response(body, { status, headers: { 'content-type': contentType } });
  return { res, state };
}

describe('fetchUrlTitle', () => {
  it('returns the title of an HTML page', async () => {
    const { res } = streamedResponse(['<html><head><title>Hello</title></head>'], 'text/html; charset=utf-8');
    expect(await fetchUrlTitle('https://example.com', () => Promise.resolve(res))).toBe('Hello');
  });

  it('finds a title split across chunks and stops reading once it has it', async () => {
    const { res, state } = streamedResponse(['<title>Hel', 'lo</title>', 'x'.repeat(1000), 'y'.repeat(1000)], 'text/html');
    expect(await fetchUrlTitle('https://example.com', () => Promise.resolve(res))).toBe('Hello');
    expect(state.pulled).toBe(2);
    expect(state.cancelled).toBe(true);
  });

  it('reads no further than MAX_TITLE_BYTES', async () => {
    const filler = 'x'.repeat(64 * 1024);
    const chunks = [...Array.from({ length: MAX_TITLE_BYTES / filler.length + 4 }, () => filler), '<title>Too late</title>'];
    const { res, state } = streamedResponse(chunks, 'text/html');
    expect(await fetchUrlTitle('https://example.com', () => Promise.resolve(res))).toBe('');
    expect(state.pulled).toBe(MAX_TITLE_BYTES / filler.length);
  });

  it('does not read the body of a non-HTML response', async () => {
    const { res, state } = streamedResponse(['<title>video?</title>'], 'video/mp4');
    expect(await fetchUrlTitle('https://example.com/a.mp4', () => Promise.resolve(res))).toBe('');
    expect(state.pulled).toBe(0);
  });

  it('returns empty on an error status or a network failure', async () => {
    const { res } = streamedResponse(['<title>Not Found</title>'], 'text/html', 404);
    expect(await fetchUrlTitle('https://example.com', () => Promise.resolve(res))).toBe('');
    expect(await fetchUrlTitle('https://example.com', () => Promise.reject(new Error('offline')))).toBe('');
  });

  it('never fetches a non-http URL', async () => {
    const fetchFn = vi.fn();
    expect(await fetchUrlTitle('file:///etc/passwd', fetchFn)).toBe('');
    expect(await fetchUrlTitle('not a url', fetchFn)).toBe('');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
