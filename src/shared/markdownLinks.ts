/**
 * Pure Markdown link-syntax helpers, shared by the renderer (link clicks, link
 * repair) and the main process (the folder graph's file-to-file link scan).
 * No Node or DOM dependencies.
 */
import { FENCED_BLOCK } from './mkUtil';

/**
 * Decode a percent-encoded markdown URL back into a filesystem path.
 * Markdown links encode spaces and other special characters (e.g. `%20`),
 * but the on-disk path uses the literal characters, so the URL must be
 * decoded before it can be resolved against the file system. Falls back to
 * the original string if it is not validly encoded.
 */
export function decodeMarkdownUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/**
 * Split a (still encoded) Markdown link destination into the file part and a
 * heading fragment: `../a/README.md#requirements` → `{ path: '../a/README.md',
 * fragment: 'requirements' }`. Only a `#` directly after a `.md` file name counts —
 * file names may themselves contain `#` (`formatLinkDestination` leaves a non-leading
 * one literal), so splitting on any `#` would break links to such files. The fragment
 * is a heading slug (see `appendLinkFragment`); null when there is none.
 */
export function splitHeadingFragment(dest: string): { path: string; fragment: string | null } {
  const match = /^(.*?\.md)#([^#/]*)$/i.exec(dest);
  if (!match) return { path: dest, fragment: null };
  return { path: match[1]!, fragment: match[2] || null };
}

/** A link destination found in Markdown source. */
export interface LinkDestination {
  /**
   * The destination as written: still percent-encoded for an inline/reference
   * link (and possibly ending in a `.md#heading` fragment); the literal target
   * with any `#section` removed for a wikilink.
   */
  dest: string;
  /** True for a `[[wikilink]]`, whose target is literal text (not URL-encoded) and may omit `.md`. */
  wiki: boolean;
}

// Link text: anything but brackets, allowing escapes and one level of nested
// brackets, so `[![img](i.png)](target.md)` still reads as a link to target.md.
const LINK_TEXT = String.raw`(?:[^\[\]\\]|\\.|\[(?:[^\[\]\\]|\\.)*\])*`;

/**
 * One alternation scanned left to right, so whatever starts first wins: fenced
 * blocks and inline code spans are consumed (and ignored) whole, which keeps the
 * links inside them from being picked up. Group names identify the alternative.
 */
const LINK_SCANNER = new RegExp(
  [
    FENCED_BLOCK.source,
    // Inline code span (single-line, any backtick run length).
    String.raw`(?<code>(?<ticks>` + '`+' + String.raw`)[^\n]*?\k<ticks>)`,
    // [[target]], [[target|alias]], [[target#section]]; a leading ! is an embed (image).
    String.raw`(?<wikiBang>!?)\[\[(?<wiki>[^\]\n]+)\]\]`,
    // [text](dest "title") / [text](<dest>); a leading ! is an image.
    String.raw`(?<bang>!?)\[${LINK_TEXT}\]\(\s*(?:<(?<angleDest>[^<>\n]*)>|(?<dest>[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*))(?:\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\([^)]*\)))?\s*\)`,
    // Reference definition: [ref]: dest
    String.raw`^[ \t]{0,3}\[(?:[^\[\]\\\n]|\\.)+\]:[ \t]*(?:<(?<refAngleDest>[^<>\n]*)>|(?<refDest>\S+))`,
  ].join('|'),
  'gm',
);

/** A URL scheme of two or more characters (so a Windows drive letter `C:` isn't one). */
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]+:/i;

/**
 * Extracts the destinations of every local link in `content`: inline links,
 * reference definitions, and wikilinks. Images and embeds, links inside fenced
 * code blocks or inline code, external URLs (any scheme), and in-page `#anchor`
 * links are skipped. Destinations are returned unresolved and in document order,
 * duplicates included.
 */
export function extractLinkDestinations(content: string): LinkDestination[] {
  const out: LinkDestination[] = [];
  for (const m of content.matchAll(LINK_SCANNER)) {
    const g = m.groups ?? {};
    if (g.wiki !== undefined) {
      if (g.wikiBang) continue;
      // Wikilink: the target is everything before `|`, minus any `#section`.
      const target = g.wiki.split('|')[0]!.split('#')[0]!.trim();
      if (target) out.push({ dest: target, wiki: true });
      continue;
    }
    if (g.bang) continue;
    const dest = (g.angleDest ?? g.dest ?? g.refAngleDest ?? g.refDest ?? '').trim();
    if (!dest || dest.startsWith('#') || URL_SCHEME_RE.test(dest)) continue;
    out.push({ dest, wiki: false });
  }
  return out;
}
