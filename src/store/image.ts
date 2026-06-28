import type { ImageSize } from '../shared/shared';
import { setState, useStoreValue } from './core';

// ============================================================================
// Image sizing - inline image display size and its transition flag
// ============================================================================

/**
 * Hook to subscribe to the inline image display size.
 */
export function useImageSize(): ImageSize {
  return useStoreValue(s => s.imageSize);
}

/**
 * Set the inline image display size.
 */
export function setImageSize(size: ImageSize): void {
  setState({ imageSize: size });
}

/**
 * Hook to subscribe to whether the image size is mid-transition.
 */
export function useImageSizeTransitioning(): boolean {
  return useStoreValue(s => s.imageSizeTransitioning);
}

/**
 * Flag the image size as transitioning (drives the CSS animation).
 */
export function setImageSizeTransitioning(value: boolean): void {
  setState({ imageSizeTransitioning: value });
}

/**
 * Change the image size and start a transition in a single state update.
 */
export function setImageSizeWithTransition(size: ImageSize): void {
  setState({ imageSize: size, imageSizeTransitioning: true });
}
