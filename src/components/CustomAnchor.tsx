import React from 'react';
import { setHighlightItem, navigateToBrowserPath } from '../store';
import { decodeMarkdownUrl } from '../utils/linkUtil';

interface CustomAnchorProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  entryPath: string;
}

export default function CustomAnchor({ href, children, entryPath, ...props }: CustomAnchorProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation();
    if (!href) return;

    // Handle external URLs - open in system browser
    if (href.startsWith('http://') || href.startsWith('https://')) {
      e.preventDefault();
      window.electronAPI.openExternalUrl(href);
      return;
    }

    // Handle file:// URLs - open with system default app
    if (href.startsWith('file://')) {
      e.preventDefault();
      window.electronAPI.openExternalUrl(href);
      return;
    }

    // Handle in-page anchor links — native hash navigation doesn't work in Electron
    // SPAs because content scrolls inside a nested container, not at window level.
    if (href.startsWith('#')) {
      e.preventDefault();
      const target = document.getElementById(href.slice(1));
      if (target) target.scrollIntoView();
      return;
    }

    // Handle relative links (./file.md, ../folder/file.md, or just file.md)
    // Skip other protocols
    if (!href.includes('://')) {
      e.preventDefault();

      // Markdown URLs are percent-encoded (e.g. spaces become %20); decode back
      // to the literal filesystem path before resolving.
      const decodedHref = decodeMarkdownUrl(href);

      // Get the directory containing this markdown file
      const currentDir = entryPath.substring(0, entryPath.lastIndexOf('/'));

      // Resolve the relative path
      let targetPath: string;
      if (decodedHref.startsWith('/')) {
        // Absolute path from root - use as-is
        targetPath = decodedHref;
      } else {
        // Relative path - resolve from current directory
        const parts = currentDir.split('/');
        const hrefParts = decodedHref.split('/');

        for (const part of hrefParts) {
          if (part === '..') {
            parts.pop();
          } else if (part !== '.' && part !== '') {
            parts.push(part);
          }
        }
        targetPath = parts.join('/');
      }

      // Extract folder and filename from the resolved path
      const lastSlash = targetPath.lastIndexOf('/');
      const folderPath = lastSlash > 0 ? targetPath.substring(0, lastSlash) : targetPath;

      // Navigate to the folder and scroll to/highlight the file
      setHighlightItem(targetPath);
      navigateToBrowserPath(folderPath, targetPath);
      return;
    }
  };

  // The markdown container initiates editing on `onMouseUp` (so click-drag text
  // selection still works), NOT on click. Stopping click propagation alone won't
  // prevent edit mode — we must also stop the mouseup from bubbling to the container.
  return (
    <a
      href={href}
      onClick={handleClick}
      onMouseUp={(e) => e.stopPropagation()}
      {...props}
    >
      {children}
    </a>
  );
}
