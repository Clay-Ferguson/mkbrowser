# 011 — Buttons missing `type="button"` (default `type="submit"` hazard)

## Role / Goal
You are working in `mkbrowser`. Add explicit `type="button"` to `<button>` elements that lack it, so they never accidentally submit a form.

## Affected files (buttons without an explicit `type`)
- `src/components/IndexInsertBar.tsx` — both the insert-file and insert-folder buttons.
- `src/components/CustomPre.tsx` — both copy buttons (also covered structurally by issue 004).
- Audit the rest of the folder while here; most buttons in `AppTabButtons.tsx`, `EditableCombobox.tsx`, and `PathBreadcrumb.tsx` already set `type="button"` correctly, so use them as the reference.

## Background
A `<button>` with no `type` defaults to `type="submit"` in HTML. If any of these components is ever rendered inside a `<form>` (directly or via composition), clicking the button will submit that form and can trigger a full reload / navigation in a web context — a notoriously hard-to-trace bug. The defensive industry-standard practice is: **every non-submit button explicitly declares `type="button"`.**

## Proposed solution
Add `type="button"` to each affected `<button>`:

```tsx
<button type="button" data-testid="insert-file-here" onClick={onInsertFile} ...>
```

## Acceptance criteria
- Every `<button>` in the `src/components` (non-recursive) set that is not an actual form-submit control has an explicit `type="button"`.
- No behavioral change otherwise.
