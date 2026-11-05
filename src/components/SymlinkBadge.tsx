import { ArrowUpRightIcon } from '@heroicons/react/16/solid';

/**
 * Marks a file or folder that is a symbolic link, shown after its name in the
 * browse view and the index tree: a solid light-gray circle with an arrow
 * pointing up and to the right, the same cue the GNOME Files (Nautilus) link
 * emblem gives. The circle is the span's own rounded background around a stock
 * Heroicons arrow, and the arrow takes the app's background color so it reads
 * as cut out of the circle.
 *
 * See: (USER_GUIDE.md#symbolic-links)
 */
function SymlinkBadge() {
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-400"
      title="Symbolic link"
      data-testid="symlink-indicator"
    >
      <ArrowUpRightIcon className="w-4 h-4 text-slate-900" />
    </span>
  );
}

export default SymlinkBadge;
