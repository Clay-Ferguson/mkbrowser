import { ExclamationTriangleIcon } from '@heroicons/react/16/solid';

/**
 * Marks a broken symbolic link (one whose target no longer exists), shown after
 * its name in the browse view and the index tree in place of the SymlinkBadge: a
 * solid bright-red warning triangle.
 *
 * See: (USER_GUIDE.md#broken-links)
 */
function BrokenLinkBadge() {
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center"
      title="Broken symbolic link: target not found"
      data-testid="broken-link-indicator"
    >
      <ExclamationTriangleIcon className="w-4 h-4 text-red-500" />
    </span>
  );
}

export default BrokenLinkBadge;
