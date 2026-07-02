import type { ImageSize } from '../shared/shared';
import { getState, useStoreValue } from './core';
import type { StoreSet } from './core';

// ============================================================================
// Image sizing - inline image display size and its transition flag
// ============================================================================

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts` (Zustand slices pattern — see ZUSTAND_CONVERSION.md §2b).
 */
export interface ImageSlice {
  setImageSize: (size: ImageSize) => void;
  setImageSizeTransitioning: (value: boolean) => void;
  setImageSizeWithTransition: (size: ImageSize) => void;
}

/**
 * Slice creator called by `core.ts` inside `create()`. A function declaration
 * (not a `const`) so it is hoisted and safe under the core ↔ slice import
 * cycle regardless of module load order.
 */
export function createImageSlice(set: StoreSet): ImageSlice {
  return {
    /** Set the inline image display size. */
    setImageSize: (size) => set({ imageSize: size }),

    /** Flag the image size as transitioning (drives the CSS animation). */
    setImageSizeTransitioning: (value) => set({ imageSizeTransitioning: value }),

    /** Change the image size and start a transition in a single state update. */
    setImageSizeWithTransition: (size) =>
      set({ imageSize: size, imageSizeTransitioning: true }),
  };
}

/**
 * Hook to subscribe to the inline image display size.
 */
export function useImageSize(): ImageSize {
  return useStoreValue(s => s.imageSize);
}

/**
 * Hook to subscribe to whether the image size is mid-transition.
 */
export function useImageSizeTransitioning(): boolean {
  return useStoreValue(s => s.imageSizeTransitioning);
}

// Thin non-hook wrappers so the barrel API (and every caller) is unchanged;
// they delegate to the actions living inside the store.

export function setImageSize(size: ImageSize): void {
  getState().setImageSize(size);
}

export function setImageSizeTransitioning(value: boolean): void {
  getState().setImageSizeTransitioning(value);
}

export function setImageSizeWithTransition(size: ImageSize): void {
  getState().setImageSizeWithTransition(size);
}
