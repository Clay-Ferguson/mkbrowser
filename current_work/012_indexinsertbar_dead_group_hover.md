# 012 — `IndexInsertBar` icons use `group-hover:` with no `group` ancestor (dead classes)

## Role / Goal
You are working in `mkbrowser`. Remove (or make functional) Tailwind `group-hover:` utility classes that can never activate.

## Affected file
- `src/components/IndexInsertBar.tsx`

## Background
```tsx
<button ... className="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-slate-700 ...">
  <DocumentPlusIcon className="w-5 h-5 text-blue-400 group-hover:text-blue-300" />
</button>
```

The icon has `group-hover:text-blue-300`, but Tailwind's `group-hover:` modifier only applies when an **ancestor element carries the `group` class**. Neither the button nor any ancestor here is marked `group`, so `group-hover:text-blue-300` is inert dead code. The same applies to the folder button / `FolderPlusIcon`.

## Why it still "looks fine"
The button itself has `hover:text-blue-300`, and `currentColor`-based heroicons inherit the button's text color, so hovering does change the icon color anyway — via the button's own `hover:`, not via `group-hover:`. The `group-hover:` classes contribute nothing.

## Proposed solution
Pick one consistent approach:
- **Simplest:** delete the redundant `group-hover:text-blue-300` (and the amber equivalent) from the icons, and rely on color inheritance from the button's `hover:text-*`. Optionally drop the explicit `text-blue-400` on the icon too, letting it inherit the button color entirely.
- **Or**, if a distinct icon hover color is genuinely wanted, add `group` to the `<button>` className so `group-hover:` actually fires.

## Acceptance criteria
- No `group-hover:` utilities remain without a corresponding `group` ancestor.
- Hover color behavior of the two insert buttons is visually unchanged (or intentionally improved).
