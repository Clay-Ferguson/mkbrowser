import { useState, useEffect } from 'react';

// Cache for resolved image paths to avoid repeated file system lookups
// Key format: `${markdownFilePath}|${imageSrc}` -> resolved absolute path or null if not found
const imagePathCache = new Map<string, string | null>();

// Maximum number of parent directories to search when looking for images
const MAX_IMAGE_SEARCH_DEPTH = 10;

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
  
  // Check cache first
  if (imagePathCache.has(cacheKey)) {
    return imagePathCache.get(cacheKey) ?? null;
  }
  
  // Get the directory containing this markdown file
  const currentDir = entryPath.substring(0, entryPath.lastIndexOf('/'));
  
  // Resolve relative path components (../, ./, etc.) to get the "clean" relative path
  const resolveRelativePath = (baseDir: string, relativePath: string): string => {
    const parts = baseDir.split('/').filter(p => p !== '');
    const relParts = relativePath.split('/');
    
    for (const part of relParts) {
      if (part === '..') {
        parts.pop();
      } else if (part !== '.' && part !== '') {
        parts.push(part);
      }
    }
    return '/' + parts.join('/');
  };
  
  // First, try resolving relative to the markdown file's directory (standard behavior)
  const standardPath = resolveRelativePath(currentDir, imageSrc);
  if (await window.electronAPI.pathExists(standardPath)) {
    imagePathCache.set(cacheKey, standardPath);
    return standardPath;
  }
  
  // If standard resolution failed, walk up directories trying to find the image
  // This handles cases where the image path assumes a different project root
  const pathParts = currentDir.split('/').filter(p => p !== '');
  
  for (let depth = 0; depth < MAX_IMAGE_SEARCH_DEPTH && pathParts.length > 0; depth++) {
    // Try the image path relative to this ancestor directory
    const ancestorDir = '/' + pathParts.join('/');
    const candidatePath = ancestorDir + '/' + imageSrc;
    
    // Normalize the path (handle any ../ in the imageSrc itself)
    const normalizedPath = resolveRelativePath('/', candidatePath.substring(1));
    
    if (await window.electronAPI.pathExists(normalizedPath)) {
      imagePathCache.set(cacheKey, normalizedPath);
      return normalizedPath;
    }
    
    // Move up one directory
    pathParts.pop();
  }
  
  // Image not found anywhere
  imagePathCache.set(cacheKey, null);
  return null;
}

/**
 * Custom image component factory for rendering images in markdown.
 * Handles relative paths by resolving them from the markdown file's location,
 * with fallback to walking up the directory tree.
 */
export function createCustomImage(entryPath: string) {
  return function CustomImage({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
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
          console.error('Error resolving image path:', err);
          if (isMounted) {
            setHasError(true);
            setIsLoading(false);
          }
        }
      }
      
      resolve();
      
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
        onError={() => setHasError(true)}
        className="max-w-full h-auto"
      />
    );
  };
}
