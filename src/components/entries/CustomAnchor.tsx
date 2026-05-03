import React from 'react';
import { setHighlightItem, navigateToBrowserPath } from '../../store';

interface CustomAnchorProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  entryPath: string;
}

export default function CustomAnchor({ href, children, entryPath, ...props }: CustomAnchorProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
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

      // Get the directory containing this markdown file
      const currentDir = entryPath.substring(0, entryPath.lastIndexOf('/'));

      // Resolve the relative path
      let targetPath: string;
      if (href.startsWith('/')) {
        // Absolute path from root - use as-is
        targetPath = href;
      } else {
        // Relative path - resolve from current directory
        const parts = currentDir.split('/');
        const hrefParts = href.split('/');

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

  return (
    <a href={href} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}
