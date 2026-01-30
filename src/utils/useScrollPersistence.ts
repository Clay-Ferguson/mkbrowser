import { useRef, useEffect, useCallback } from 'react';

/**
 * Custom hook for persisting scroll position across view switches.
 * 
 * @param getPosition - Function to retrieve the saved scroll position
 * @param setPosition - Function to save the current scroll position
 * @returns Object containing the container ref and scroll handler to attach to the scrollable element
 * 
 * @example
 * ```tsx
 * const { containerRef, handleScroll } = useScrollPersistence(
 *   getSearchResultsScrollPosition,
 *   setSearchResultsScrollPosition
 * );
 * 
 * return (
 *   <main ref={containerRef} onScroll={handleScroll} className="overflow-y-auto">
 *     ...
 *   </main>
 * );
 * ```
 */
export function useScrollPersistence(
  getPosition: () => number,
  setPosition: (position: number) => void
) {
  // Ref to the scrollable container
  const containerRef = useRef<HTMLElement | null>(null);
  
  // Debounce timer for scroll position saving
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Restore scroll position on mount
  useEffect(() => {
    const savedPosition = getPosition();
    if (savedPosition > 0 && containerRef.current) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        containerRef.current?.scrollTo({ top: savedPosition, behavior: 'instant' });
      }, 50);
    }
  }, [getPosition]);
  
  // Cleanup scroll save timer on unmount
  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current);
      }
    };
  }, []);
  
  // Handle scroll events on the container (debounced save)
  const handleScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    // Clear any pending save timer
    if (scrollSaveTimerRef.current) {
      clearTimeout(scrollSaveTimerRef.current);
    }
    // Debounce: save scroll position after 150ms of no scrolling
    scrollSaveTimerRef.current = setTimeout(() => {
      setPosition(e.currentTarget.scrollTop);
    }, 150);
  }, [setPosition]);
  
  return { containerRef, handleScroll };
}
