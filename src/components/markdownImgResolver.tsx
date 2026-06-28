import { useState, useEffect } from 'react';
import type { ExtraProps } from 'react-markdown';
import { api } from '../services/api';
import { logger } from '../shared/logUtil';
import { decodeMarkdownUrl } from '../renderer/linkUtil';
import { getParentPath, pathSep, splitPathSegments } from '../renderer/pathUtil';

// Cache for resolved image paths to avoid repeated file system lookups.
// Key format: `${markdownFilePath}|${imageSrc}` -> resolved absolute path.
//
// Only successful resolutions are cached. Negative (not-found) results are
// deliberately NOT stored, so an image created after a failed lookup renders
// without restarting the app. The cache is bounded with simple LRU eviction so
// it cannot grow without bound during a long-lived session.
const imagePathCache = new Map<string, string>();

// Cap on cached resolutions; once exceeded, the least-recently-used entry is evicted.
const MAX_IMAGE_PATH_CACHE_ENTRIES = 500;

// Maximum number of parent directories to search when looking for images
const MAX_IMAGE_SEARCH_DEPTH = 10;

// Read a cached resolution, refreshing its recency (Map preserves insertion
// order, so re-inserting moves the key to the most-recently-used position).
function getCachedImagePath(cacheKey: string): string | undefined {
  const cached = imagePathCache.get(cacheKey);
  if (cached !== undefined) {
    imagePathCache.delete(cacheKey);
    imagePathCache.set(cacheKey, cached);
  }
  return cached;
}

// Store a successful resolution, evicting the oldest entry if we exceed the cap.
function setCachedImagePath(cacheKey: string, resolvedPath: string): void {
  imagePathCache.set(cacheKey, resolvedPath);
  if (imagePathCache.size > MAX_IMAGE_PATH_CACHE_ENTRIES) {
    const oldestKey = imagePathCache.keys().next().value;
    if (oldestKey !== undefined) {
      imagePathCache.delete(oldestKey);
    }
  }
}

/**
 * Resolve a relative image path by walking up the directory tree.
 * First tries to resolve relative to the markdown file's directory,
 * then walks up parent directories until the image is found or we reach the limit.
 * 
 * @param entryPath - Absolute path to the markdown file
 * @param imageSrc - The image src attribute (relative path)
 * @returns The resolved absolute path, or null if not found
 */
async function resolveImagePath(entryPath: string, imageSrc: string): Promise<string | null> {
  const cacheKey = `${entryPath}|${imageSrc}`;

  // Check cache first (only successful resolutions are ever cached)
  const cached = getCachedImagePath(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  // Markdown URLs are percent-encoded (e.g. spaces become %20); decode back to
  // the literal filesystem path before resolving against disk.
  imageSrc = decodeMarkdownUrl(imageSrc);

  // Get the directory containing this markdown file
  const currentDir = getParentPath(entryPath);

  // The leading root of the base dir ('/' on Linux/macOS, '' for 'C:\…' on
  // Windows where the drive letter is the first segment).
  const rootPrefix = currentDir.startsWith('/') || currentDir.startsWith('\\') ? pathSep() : '';

  // Resolve relative path components (../, ./, etc.) to get the "clean" path.
  // The image src uses '/' (markdown convention); the base dir uses the native sep.
  const resolveRelativePath = (baseDir: string, relativePath: string): string => {
    const parts = splitPathSegments(baseDir);
    const relParts = relativePath.split('/');

    for (const part of relParts) {
      if (part === '..') {
        parts.pop();
      } else if (part !== '.' && part !== '') {
        parts.push(part);
      }
    }
    return rootPrefix + parts.join(pathSep());
  };

  // First, try resolving relative to the markdown file's directory (standard behavior)
  const standardPath = resolveRelativePath(currentDir, imageSrc);
  if (await api.pathExists(standardPath)) {
    setCachedImagePath(cacheKey, standardPath);
    return standardPath;
  }

  // If standard resolution failed, walk up directories trying to find the image
  // This handles cases where the image path assumes a different project root
  const pathParts = splitPathSegments(currentDir);

  for (let depth = 0; depth < MAX_IMAGE_SEARCH_DEPTH && pathParts.length > 0; depth++) {
    // Try the image path relative to this ancestor directory (resolveRelativePath
    // also normalizes any ../ inside the imageSrc itself)
    const ancestorDir = rootPrefix + pathParts.join(pathSep());
    const normalizedPath = resolveRelativePath(ancestorDir, imageSrc);

    if (await api.pathExists(normalizedPath)) {
      setCachedImagePath(cacheKey, normalizedPath);
      return normalizedPath;
    }

    // Move up one directory
    pathParts.pop();
  }
  
  // Image not found anywhere. Deliberately not cached, so it will be re-checked
  // on the next render and recover if the file is later created.
  return null;
}

/**
 * Custom image component factory for rendering images in markdown.
 * Handles relative paths by resolving them from the markdown file's location,
 * with fallback to walking up the directory tree.
 */
export function createCustomImage(entryPath: string) {
  // `node` is react-markdown's internal hast node; destructure it out so it isn't
  // spread onto the DOM <img> element (React warns on unknown DOM props).
  return function CustomImage({ src, alt, node, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & ExtraProps) {
    const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);
    
    useEffect(() => {
      let isMounted = true;
      
      async function resolve() {
        if (!src) {
          if (isMounted) {
            setIsLoading(false);
            setHasError(true);
          }
          return;
        }
        
        // Pass through absolute URLs unchanged
        if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
          if (isMounted) {
            setResolvedSrc(src);
            setIsLoading(false);
          }
          return;
        }
        
        // For local paths, resolve and use local-file:// protocol
        try {
          const resolved = await resolveImagePath(entryPath, src);
          if (isMounted) {
            if (resolved) {
              setResolvedSrc(`local-file://${resolved}`);
              setHasError(false);
            } else {
              setHasError(true);
            }
            setIsLoading(false);
          }
        } catch (err) {
          logger.error('Error resolving image path:', err);
          if (isMounted) {
            setHasError(true);
            setIsLoading(false);
          }
        }
      }
      
      void resolve();

      return () => {
        isMounted = false;
      };
    }, [src]);
    
    if (isLoading) {
      return (
        <span className="inline-block bg-slate-700 rounded px-2 py-1 text-slate-400 text-sm">
          Loading image...
        </span>
      );
    }
    
    if (hasError || !resolvedSrc) {
      return (
        <span className="inline-flex items-center gap-1 bg-red-900/30 border border-red-500/50 rounded px-2 py-1 text-red-300 text-sm">
          <span>⚠️</span>
          <span>{alt || src || 'Image not found'}</span>
        </span>
      );
    }
    
    return (
      <img
        src={resolvedSrc}
        alt={alt}
        {...props}
        loading="lazy"
        onError={() => setHasError(true)}
        className="max-w-full h-auto"
      />
    );
  };
}
