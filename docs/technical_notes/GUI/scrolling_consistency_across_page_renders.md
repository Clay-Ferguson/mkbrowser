# Scrolling Consistency Across Page Re-renders

## Overview

Some UI actions change the **vertical size of many elements at once** — for example,
toggling every image in the browse view from "small" to "large". When a large list
re-flows like this, the total document height changes and every element below the
change shifts. The net effect is that whatever the user was looking at is suddenly
somewhere else on the page (or scrolled completely off-screen).

This document describes the technique we use to keep the user **visually anchored to
the same element** across this kind of size-changing re-render. The concrete
implementation lives in the image-size toggle (`ImageEntry.tsx` + `BrowseView.tsx`),
but the pattern is general and is worth reusing any time a single action resizes a lot
of content simultaneously.

The problem this solves is specifically a **layout/scroll** problem, not a data
problem. The right content is rendered either way — the goal is purely to stop the
viewport from visually "jumping."

---

## The Problem in Detail

When the user clicks the image-size toggle:

1. A shared store value (`imageSize`) flips from `'small'` to `'large'`.
2. Every `ImageEntry` re-renders with a larger `max-height`, so each grows taller.
3. The document is now much taller, and the **current `scrollTop` no longer points at
   the same content**. The image the user clicked on has moved — often far enough that
   it is no longer on screen.

We can fix the scroll position after the fact by calling `scrollIntoView()` on the
clicked image. But doing only that produces a very jarring experience: the user watches
the page re-flow at the *old* scroll position, and then the viewport visibly **snaps**
to the new position. The snap is the thing we want to eliminate.

---

## The Technique

The core idea is to **perform the re-layout and the re-scroll while the view is
invisible**, then fade it back in. The user never sees the intermediate, wrong-scroll
state — from their perspective the page simply cross-fades from the old layout to the
new one, still centered on the element they were looking at.

The sequence is:

1. **Hide + resize in a single render.** Flip the size flag *and* set the container to
   `opacity: 0` (with `transition: none`, so the hide is instantaneous) in one store
   update / one React render. The larger elements lay out, but nothing is visible.
2. **Wait for the invisible frame to actually paint.** Use a double
   `requestAnimationFrame`. This guarantees the browser has committed and painted the
   `opacity: 0` frame *with the new layout* before we touch it again.
3. **Jump the scroll while still invisible.** Call
   `scrollIntoView({ behavior: 'instant', block: 'center' })` on the anchor element.
   Because the view is at `opacity: 0`, this instant jump is invisible.
4. **Fade back in at the correct position.** Drop the hide flag, which switches the
   container to `opacity: 1` *with* a `transition: opacity ...`. The browser animates
   0 → 1 from the already-correct scroll position.

The user sees: the view goes blank for an instant, then fades in over ~1s, already
scrolled so the anchor element is centered. No snap, no scrollbar lurch.

### Why two `requestAnimationFrame`s?

This is the subtle, easy-to-get-wrong part. A CSS `opacity` transition only fires if
the browser has **painted the starting value** before the ending value is applied. If
you set `opacity: 0` and `opacity: 1` within the same frame, the browser collapses them
and you get an instant show with no fade.

- `rAF #1` runs just before the next paint — at this point the DOM is committed at
  `opacity: 0` but not yet painted.
- The browser paints the `opacity: 0` frame.
- `rAF #2` runs before the following paint — now it is safe to scroll and flip to
  `opacity: 1`, and the transition will animate because the `0` baseline was painted.

So the two rAFs serve two purposes at once: they guarantee the new (larger) layout
exists before we measure/scroll, and they guarantee the fade-in transition actually
runs.

### Why `behavior: 'instant'` and not `'smooth'`?

The repositioning happens *while the view is invisible*, so there is nothing to animate
smoothly — a smooth scroll would only waste time (and could still be mid-flight when
the fade begins, reintroducing a visible jump). The fade itself is the only animation
the user should perceive.

### Anchor identification

We need to find the anchor element in the DOM *after* the re-render. We use the image's
`src` (`local-file://<path>`) as a natural unique key, because file paths are unique
within a folder:

```ts
const imgEl = document.querySelector(`img[src="${thisImageUrl}"]`);
```

No extra `id` or `data-` attribute is required. For other reuse cases, any stable,
unique selector works — capture it *before* the re-render and look it up *after*.

---

## Where This Lives in the Code

### 1. Store: combined "resize + hide" in one update

`src/store/store.ts` exposes the flag and, crucially, a setter that changes **both**
the size and the hide flag in a single state object so they land in one render:

```ts
// state.imageSizeTransitioning: true while hidden/fading
export function setImageSizeTransitioning(value: boolean): void {
  state = { ...state, imageSizeTransitioning: value };
  emitChange();
}

// Resize AND hide in ONE update => one render, no flash of the new size at full opacity
export function setImageSizeWithTransition(size: ImageSize): void {
  state = { ...state, imageSize: size, imageSizeTransitioning: true };
  emitChange();
}
```

The single-update combination matters: if you set the size in one render and the hide
flag in a separate render, the browser can paint the new (larger) layout at full
opacity for one frame before the hide takes effect — a visible flash.

The flag is initialized in `initialState` (`imageSizeTransitioning: false`) and read via
the `useImageSizeTransitioning()` hook.

### 2. The trigger: `handleToggleImageSize` in `src/components/entries/ImageEntry.tsx`

This is the orchestration described above — single hide+resize update, double rAF,
instant scroll while invisible, then drop the flag to fade in. Persisting the new value
to disk is fired off independently (`void (async () => { ... })()`) so the IPC
round-trip can never gate or perturb the animation timing.

### 3. The container: fade styling in `src/components/views/BrowseView.tsx`

The top-level container of the view reads the flag and applies the opacity + transition:

```tsx
const imageSizeTransitioning = useImageSizeTransitioning();
// ...
<div
  className="flex-1 flex flex-col min-h-0"
  style={{
    opacity: imageSizeTransitioning ? 0 : 1,
    // While hidden, no transition (instant). On reveal, fade 0 -> 1 over 1s.
    transition: imageSizeTransitioning ? 'none' : 'opacity 1000ms ease-out',
  }}
>
```

> **Layout gotcha:** this wrapper `<div>` participates in the parent flex column. It
> must carry `flex-1 flex flex-col min-h-0` so the inner scrollable `<main>` can still
> grow to fill height and show its scrollbar. A bare `<div>` here collapses the layout
> and the scrollbar disappears.

---

## Reusing This Pattern

To anchor the viewport across any action that resizes a lot of content at once:

1. Add a boolean "transitioning" flag to the relevant store slice.
2. Provide a setter that applies the **content change and the flag in a single update**.
3. On the container, drive `opacity` + `transition` from the flag — `opacity: 0` /
   `transition: none` when hiding, `opacity: 1` / `transition: opacity <dur>` when
   revealing. Ensure the container keeps whatever flex/height classes the layout needs.
4. In the trigger handler:
   - capture a unique selector for the anchor element **before** changing state,
   - call the combined "change + hide" setter,
   - `requestAnimationFrame(() => requestAnimationFrame(() => { ... }))`,
   - inside the inner rAF: `scrollIntoView({ behavior: 'instant', block: 'center' })`
     on the anchor, then clear the transitioning flag,
   - keep the fade duration and any follow-up scroll timing in sync.

The key invariants to preserve, in order of how easy they are to break:

- **Resize and hide in the same render** (no full-opacity flash of the new layout).
- **Two rAFs before revealing** (so the `opacity: 0` baseline paints and the fade fires;
  also so the new layout exists before you scroll).
- **Instant scroll, not smooth** (the move must be invisible and complete before the fade).
- **Container keeps its flex/height classes** (so scrolling still works).

---

## Related

- `scroll_position_persistence.md` — saving/restoring scroll position across tab
  switches (unmount/remount), a separate concern from the within-view re-layout
  anchoring described here.
