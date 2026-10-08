/**
 * Pure path logic for the folder HTML export ("Export to Folder (HTML)"): maps
 * source paths to their mirrored output paths and rewrites the links and image
 * references of a page so they work inside the exported tree. The output mirrors
 * the source except for the names in `ExportManifest.renamed` (the ordinal
 * prefixes given to the entries of Document Mode folders), so every href is built
 * from output paths, never from the source-relative path.
 *
 * Every existence check goes against the export's manifest (the set of files and
 * folders found by the source walk), never the disk, so all of this is testable
 * without touching the file system.
 */
import path from 'node:path';
import { decodeMarkdownUrl, splitHeadingFragment } from '../../shared/markdownLinks';

/** File name of the generated per-folder navigation page. */
export const INDEX_PAGE_NAME = '_index.html';

/** Matches the Markdown extension a converted page swaps for `.html`. */
const MD_EXT_RE = /\.md$/i;

/** Ancestor folders tried when resolving an image, matching the in-app resolver (markdownImgResolver.tsx). */
const MAX_IMAGE_SEARCH_DEPTH = 10;

/** A leading URL scheme (`https:`, `mailto:`, …). */
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

/** Schemes a link keeps and opens in a new browser tab. */
const EXTERNAL_SCHEMES = new Set(['http', 'https']);

/**
 * Schemes a link keeps as written, in the same tab: local files (the target lives outside
 * the export), and `mailto:` / `tel:` links, which the browser hands to the system's mail
 * client or dialer (a new tab would just be left blank).
 */
const KEPT_SCHEMES = new Set(['file', 'local-file', 'mailto', 'tel']);

/** What the source walk found: everything the export mirrors. */
export interface ExportManifest {
  /** The folder being exported (absolute, resolved). */
  root: string;
  /** Absolute paths of every exported folder, the root included. */
  dirs: Set<string>;
  /** Absolute paths of every exported file (Markdown and otherwise). */
  files: Set<string>;
  /** Front-matter id → absolute path of the `.md` file carrying it (link auto-repair). */
  idToPath: Map<string, string>;
  /**
   * Absolute source path → the name its output carries, for entries exported under a
   * different name (`0003_Intro.md` for `Intro.md` in a Document Mode folder). The name
   * is still in source form: a `.md` file's `.html` swap is applied on top of it.
   */
  renamed: Map<string, string>;
}

/** Everything link rewriting needs to know about the page being converted. */
export interface PageLinkContext {
  manifest: ExportManifest;
  /** Absolute source path of the Markdown file being converted. */
  mdPath: string;
  /** Whether folders get a generated `_index.html` (folder links then point at it). */
  indexPages: boolean;
}

/** The rewritten form of a link: its new href (null drops it) and whether it opens in a new tab. */
export interface RewrittenLink {
  href: string | null;
  external: boolean;
}

export function isMarkdownPath(p: string): boolean {
  return MD_EXT_RE.test(p);
}

/** True when `p` is `root` itself or lies somewhere beneath it. */
export function isInsideOrEqual(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** A source path's mirrored path in the output: `.md` files become `.html`, everything else keeps its name. */
export function toOutputPath(p: string): string {
  return p.replace(MD_EXT_RE, '.html');
}

/**
 * The output path of the source path `p` (inside `manifest.root`) as segments
 * relative to the export root: each folder or file keeps its source name unless the
 * manifest renamed it. A `.md` file's last segment keeps its `.md` extension here.
 */
export function outputSegments(manifest: ExportManifest, p: string): string[] {
  const rel = path.relative(manifest.root, p);
  if (rel === '') return [];
  let current = manifest.root;
  return rel.split(path.sep).map((name) => {
    current = path.join(current, name);
    return manifest.renamed.get(current) ?? name;
  });
}

/**
 * The relative URL from the page generated for `fromSrcFile` to the output of
 * `toSrc` (both source paths, resolved to their output paths through the manifest,
 * so renamed folders and files are linked by their exported names). Each segment is
 * percent-encoded so names with spaces, `#`, `?` and the like survive as URLs. A
 * folder target links to its `_index.html` when index pages are generated, else to
 * the folder itself.
 */
export function hrefBetween(
  manifest: ExportManifest,
  fromSrcFile: string,
  toSrc: string,
  kind: 'file' | 'dir',
  indexPages: boolean,
): string {
  // Posix paths under a fake root, so the relative path joins with '/' on every platform.
  const fromDir = `/${outputSegments(manifest, path.dirname(fromSrcFile)).join('/')}`;
  const to = `/${outputSegments(manifest, toSrc).join('/')}`;
  const rel = path.posix.relative(fromDir, to);
  const segments = rel === '' ? [] : rel.split('/');
  if (kind === 'file') {
    const last = segments.length - 1;
    segments[last] = toOutputPath(segments[last]!);
  } else {
    segments.push(indexPages ? INDEX_PAGE_NAME : '');
  }
  const href = segments.map(encodeURIComponent).join('/');
  return href === '' ? './' : href;
}

/** Looks an absolute source path up in the manifest. */
function kindOf(manifest: ExportManifest, p: string): 'file' | 'dir' | null {
  if (manifest.files.has(p)) return 'file';
  if (manifest.dirs.has(p)) return 'dir';
  return null;
}

/**
 * Rewrites a link (`<a href>`) on the page `ctx.mdPath` for the exported tree:
 *   - `#fragment` — kept as is (headings carry GitHub-style slug ids).
 *   - http/https (and protocol-relative `//host`) — kept; opens in a new tab.
 *   - file://, local-file://, mailto: and tel: — kept as written.
 *   - any other scheme (javascript:, …) — dropped, mirroring `safeUrlTransform`.
 *   - a relative or absolute path — resolved against the page's folder, as the app's
 *     link handler does (CustomAnchor). A target inside the export links to its output
 *     (`.md` → `.html`, keeping a `#heading` fragment; folder → its index page). When the
 *     target is missing, a link titled `id:…` is repaired through the target's front-matter
 *     id (as linkRepair.ts does in the app), and an extension-less wikilink target finds its
 *     `.md` file. A target outside the export, or still missing, is left unchanged.
 */
export function resolveExportLink(href: string, title: string | undefined, ctx: PageLinkContext): RewrittenLink {
  const unchanged: RewrittenLink = { href, external: false };
  if (href === '' || href.startsWith('#')) return unchanged;
  if (href.startsWith('//')) return { href, external: true };

  const scheme = SCHEME_RE.exec(href)?.[1]?.toLowerCase();
  if (scheme) {
    if (EXTERNAL_SCHEMES.has(scheme)) return { href, external: true };
    if (KEPT_SCHEMES.has(scheme)) return unchanged;
    return { href: null, external: false };
  }

  const { manifest, mdPath, indexPages } = ctx;
  const { path: linkPath, fragment } = splitHeadingFragment(href);
  const decoded = decodeMarkdownUrl(linkPath);
  if (decoded === '') return unchanged;

  let target = path.resolve(path.dirname(mdPath), decoded);
  let kind = kindOf(manifest, target);

  if (!kind) {
    const id = /^id:(.+)$/.exec(title?.trim() ?? '')?.[1]?.trim();
    const byId = id && isMarkdownPath(target) ? manifest.idToPath.get(id) : undefined;
    if (byId) {
      target = byId;
      kind = 'file';
    } else if (path.extname(target) === '' && manifest.files.has(`${target}.md`)) {
      target = `${target}.md`;
      kind = 'file';
    }
  }

  if (!kind || !isInsideOrEqual(manifest.root, target)) return unchanged;

  const rewritten = hrefBetween(manifest, mdPath, target, kind, indexPages);
  return { href: fragment ? `${rewritten}#${fragment}` : rewritten, external: false };
}

/**
 * Rewrites an image reference (`<img src>`) on the page `ctx.mdPath` to point at
 * the copied image. Mirrors the app's resolver (markdownImgResolver.tsx): the path
 * is tried relative to the page's folder first, then relative to each ancestor
 * folder in turn (up to 10), for images written against a different project root.
 * URLs with a scheme (http, data:, …) and images that can't be found inside the
 * export are left unchanged.
 */
export function resolveExportImage(src: string, ctx: PageLinkContext): string {
  if (src === '' || src.startsWith('//') || SCHEME_RE.test(src)) return src;

  const { manifest, mdPath } = ctx;
  const decoded = decodeMarkdownUrl(src);

  const candidates: string[] = [];
  if (path.isAbsolute(decoded)) {
    candidates.push(path.normalize(decoded));
  } else {
    let dir = path.dirname(mdPath);
    for (let depth = 0; depth < MAX_IMAGE_SEARCH_DEPTH; depth++) {
      candidates.push(path.join(dir, decoded));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  const found = candidates.find((c) => manifest.files.has(c));
  return found ? hrefBetween(manifest, mdPath, found, 'file', ctx.indexPages) : src;
}
