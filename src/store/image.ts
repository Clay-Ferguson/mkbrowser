import type { ImageSize } from '../types/shared';
import { setState, useStoreValue } from './core';

// ============================================================================
// Image sizing - inline image display size and its transition flag
// ============================================================================

export function useImageSize(): ImageSize {
  return useStoreValue(s => s.imageSize);
}

export function setImageSizeStore(size: ImageSize): void {
  setState({ imageSize: size });
}

export function useImageSizeTransitioning(): boolean {
  return useStoreValue(s => s.imageSizeTransitioning);
}

export function setImageSizeTransitioning(value: boolean): void {
  setState({ imageSizeTransitioning: value });
}

export function setImageSizeWithTransition(size: ImageSize): void {
  setState({ imageSize: size, imageSizeTransitioning: true });
}
