import { isPathInside, isSamePath } from './pathUtil';

/**
 * Adds a symbolic link's "Link to: <target>" line to a row's flyover: appended on
 * a new line when the row already has one, or as the whole flyover when it has
 * none. Returns `title` unchanged for anything that isn't a link.
 *
 * The target is shown relative to `rootPath` (the folder the app browses as its
 * top level, the breadcrumb's home icon), which is shorter and still unambiguous.
 * A target outside the root, or the root itself, keeps its full path.
 *
 * See: (USER_GUIDE.md#symbolic-links)
 */
export function withLinkFlyover(title: string | undefined, linkTarget: string | undefined, rootPath: string): string | undefined {
  if (!linkTarget) return title;
  const shown = rootPath && isPathInside(rootPath, linkTarget) && !isSamePath(rootPath, linkTarget)
    ? linkTarget.slice(rootPath.replace(/[/\\]+$/, '').length + 1)
    : linkTarget;
  const line = `Link to: ${shown}`;
  return title ? `${title}\n${line}` : line;
}
