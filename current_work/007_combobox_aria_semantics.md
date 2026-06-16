# 007 — `EditableCombobox` is missing standard ARIA combobox semantics

## Role / Goal
You are working in `mkbrowser`. Bring `EditableCombobox` up to the WAI-ARIA combobox pattern so it is accessible to screen readers and keyboard users.

## Affected file
- `src/components/EditableCombobox.tsx`

## Background
The component already implements the hard parts: filtering, arrow-key navigation, highlighted index, scroll-into-view, click-outside close, and a `role="listbox"` / `role="option"` list. What's missing is the wiring that assistive tech relies on to understand the relationship between the input and the popup.

## The problems (per the ARIA Authoring Practices "combobox" pattern)
1. The `<input>` has no `role="combobox"`.
2. No `aria-expanded={isOpen}` on the input — screen readers can't announce open/closed.
3. No `aria-controls` pointing at the listbox `<ul>` (the `<ul>` needs a stable `id`).
4. No `aria-activedescendant` referencing the currently highlighted `<li>` (each `<li>` needs an `id`). Without this, AT users navigating with arrows don't hear the active option.
5. `aria-autocomplete="list"` is not set.

## Proposed solution
- Generate a stable base id (e.g. `const baseId = useId();`) and derive `listId = `${baseId}-list`` and per-option ids `` `${baseId}-opt-${index}` ``.
- On the `<input>`:
  ```tsx
  role="combobox"
  aria-expanded={isOpen}
  aria-controls={listId}
  aria-autocomplete="list"
  aria-activedescendant={highlightedIndex >= 0 ? `${baseId}-opt-${highlightedIndex}` : undefined}
  ```
- On the `<ul>`: `id={listId}`.
- On each `<li>`: `id={`${baseId}-opt-${index}`}` (keep existing `role="option"` and `aria-selected`).

Also consider: the option `<li>` elements use `onClick` but `aria-selected` currently tracks the *highlighted* (hover/arrow) item rather than the *selected value*. That's acceptable for this pattern, but document the intent.

## Acceptance criteria
- The input exposes `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `aria-autocomplete`.
- The listbox and each option have matching ids so `aria-controls` / `aria-activedescendant` resolve.
- Keyboard and mouse behavior is unchanged.
