# Dialog Components — Code Review & Recommendations

A review of `src/components/dialogs` against industry-standard TypeScript / React / Electron
best practices. The focus is on *what could be done better* relative to widely-accepted
conventions, not on internal consistency with the rest of this project.

Files reviewed:

- `AlertDialog.tsx`, `BookmarkDialog.tsx`, `ConfirmDialog.tsx`, `CreateFileDialog.tsx`,
  `CreateFolderDialog.tsx`, `EditAIModelDialog.tsx`, `EditCalendarDialog.tsx`,
  `ExifDialog.tsx`, `ExportDialog.tsx`, `NewCalendarFileDialog.tsx`, `RenameDialog.tsx`,
  `ReplaceDialog.tsx`, `SearchDialog.tsx`, `StreamingDialog.tsx`, `TagsEditorDialog.tsx`
- `common/CheckboxField.tsx`, `common/DlgHeader.tsx`, `common/RadioField.tsx`,
  `common/RadioGroup.tsx`

---

## 1. Cross-cutting issues (affect most/all dialogs)

These are the highest-leverage problems. Fixing them once (in a shared wrapper) removes
duplicated, divergent code from every dialog.

### 1.1 Accessibility (a11y) — the biggest gap (DONE)

None of the dialogs implement the WAI-ARIA *dialog (modal)* pattern. Industry standard for
any modal is:

- **Missing ARIA roles.** The outer container should have `role="dialog"` (or
  `role="alertdialog"` for `ConfirmDialog`/`AlertDialog`), `aria-modal="true"`, and
  `aria-labelledby` pointing at the title (`DlgHeader`'s `<h3>`). None of these are present,
  so screen readers don't announce these as dialogs.
- **No focus trap.** Keyboard users can `Tab` out of the dialog into the page behind it.
  A modal must keep focus inside until dismissed (commonly via `focus-trap-react`, Radix,
  Headless UI, or a small custom hook).
- **Focus is never restored.** When a dialog closes, focus should return to the element that
  opened it. Right now focus is left wherever it lands.
- **Background not inert.** The content behind the overlay should be `inert` / `aria-hidden`
  while the modal is open so AT and Tab order ignore it.
- **Clickable `<div>` overlays.** Overlays use `onClick`/`onKeyDown` on a `<div>`
  (`ConfirmDialog`, `EditAIModelDialog`, `BookmarkDialog`, etc.). A `<div>` with a click
  handler is not keyboard-focusable or announced. The native `<dialog>` element, or a button,
  is the accessible primitive.

**Recommendation:** adopt either the native HTML `<dialog>` element (it gives focus trap,
`Esc` handling, backdrop, and `::backdrop` for free) or a headless library (Radix UI Dialog,
Headless UI), and centralize it in a single `<Dialog>` wrapper (see 1.2).

### 1.2 No shared `Dialog`/`Modal` wrapper — heavy duplication (DRY) (DONE)

Every dialog hand-rolls the same scaffold:

```tsx
<div className={DLG_OVERLAY_CLASS} ...>
  <div className={`${DLG_CONTAINER} ... mx-4 overflow-hidden`}>
    <DlgHeader title=... onClose=... />
    <div className="p-6"> ... </div>
  </div>
</div>
```

`DlgHeader` is shared, but the overlay, container, sizing, backdrop behavior, Escape handling,
and focus management are copy-pasted 12+ times — and they've **drifted** (see 1.3, 1.4). A
single `<Dialog title size onClose>{children}</Dialog>` component would absorb all of this,
make a11y fixes one-and-done, and shrink every dialog file substantially.

### 1.3 Escape-key handling is duplicated and inconsistent (functional bug) (DONE)

Three different strategies coexist, and two of them leave dialogs un-closable by keyboard:

- **`document.addEventListener('keydown', ...)`** — `ExifDialog` only.
- **`onKeyDown` on the overlay `<div>`** — `EditAIModelDialog`, `TagsEditorDialog`. This only
  fires when the overlay or a descendant has focus, so it's fragile.
- **`onKeyDown` on the text input** — `BookmarkDialog`, `Rename`, `Create*`, `Replace`,
  `NewCalendarFile`, `Export`, `Search`. Works only while that input is focused.
- **Nothing at all** — `AlertDialog`, `ConfirmDialog`, `EditCalendarDialog`. **Pressing `Esc`
  does not close these dialogs**, which is a real UX regression versus standard modal behavior.

**Recommendation:** handle `Esc` once in the shared wrapper (or use native `<dialog>`, which
does it automatically).

### 1.4 Backdrop-click behavior is inconsistent (DONE)

- `ExifDialog` closes on backdrop click.
- `ConfirmDialog`, `BookmarkDialog`, `EditAIModelDialog`, `NewCalendarFileDialog` attach
  `onClick`/`stopPropagation` to the overlay but **do not** close on backdrop click — the
  handler exists only to stop event propagation, which reads as dead/confusing intent.
- Most others have no backdrop handling.

Pick one documented behavior (e.g. "click backdrop closes, except destructive/edit dialogs")
and implement it in the wrapper. Note: closing an *edit* dialog on an accidental backdrop click
can lose user input, so this should be a deliberate, per-dialog prop.

### 1.5 Dialogs are not rendered through a portal (DONE)

Modals are rendered inline in the component tree. The standard practice is
`ReactDOM.createPortal(..., document.body)` so the overlay isn't subject to ancestor
`overflow`, `transform`, `z-index`, or stacking-context issues. Fold this into the wrapper.

### 1.6 `window.alert()` used for user-facing messaging (Electron + UX)

`ExifDialog` calls `alert(...)` in `handleAddDescription` and `handleSave`. The app already has
an `AlertDialog` component and a dialog system; using the blocking native `alert()`:

- is visually inconsistent with the app,
- blocks the renderer's event loop,
- is discouraged in Electron renderer code.

Route these through the existing `AlertDialog` / app notification mechanism instead.

### 1.7 `type="button"` missing on most buttons (DONE)

Buttons inside dialogs mostly omit `type="button"` (the HTML default is `type="submit"`).
`TagsEditorDialog`/`DlgHeader`/`RadioField` set it; the Cancel/Save/Create buttons in most
other dialogs do not. There are no `<form>`s today so nothing submits, but if any dialog is
ever wrapped in a form (the idiomatic way to get Enter-to-submit, see 1.8) these will
accidentally submit. Add `type="button"` (or adopt forms intentionally).

### 1.8 Enter-to-submit is hand-rolled per input instead of using a `<form>`

Each dialog re-implements `if (e.key === 'Enter') ...` on its input. The idiomatic approach is
to wrap the fields in a `<form onSubmit={...}>` with a `type="submit"` primary button; the
browser then handles Enter, and you get native validation hooks. This would remove most of the
bespoke `handleKeyDown` functions.

### 1.9 Repeated focus-on-mount logic (DONE)

`useEffect(() => { inputRef.current?.focus(); /* + .select() */ }, [])` is duplicated in ~8
dialogs. Extract a tiny `useAutoFocus()` hook (or an `autoFocus` prop on the wrapper / input).

### 1.10 The `React` namespace import / `React.FC`

`CheckboxField`, `RadioField`, and `DlgHeader` `import React` solely for `React.FC` /
`React.ReactNode`. With the modern JSX transform the default `React` import is unnecessary;
prefer `import type { ReactNode } from 'react'`. `React.FC` is also widely discouraged now
(implicit `children`, awkward generics) — plain function components with a typed props
argument are the current convention (as `RadioGroup` already does).

---

## 2. Per-file findings

### `AlertDialog.tsx`
- No `Esc` handling (see 1.3); no `role="alertdialog"` (1.1).
- The conditional `className` string-building (template literals with nested ternaries on
  lines 26–39) is hard to read and error-prone. Use a `clsx`/`classnames` helper.

### `ConfirmDialog.tsx`
- No `Esc` handling (1.3) and no autofocus on the default/safe button. For a Yes/No confirm,
  the destructive "Yes" is `BUTTON_CLASS_DLG_RED` but nothing controls initial focus —
  standard practice is to focus the *safe* (Cancel/No) action by default.
- `handleBackdropClick` only calls `stopPropagation()` and never closes — misleading (1.4).

### `CreateFileDialog.tsx` / `CreateFolderDialog.tsx`
- Near-identical files (state name, placeholder, and the timestamp helper differ). Consider a
  single parameterized dialog or a shared hook to remove the duplication.
- On invalid/empty the handlers silently proceed with a generated name — fine, but there's no
  inline validation feedback pattern shared with the other dialogs.

### `EditAIModelDialog.tsx`
- **Type assertions instead of narrowing.** `inputPer1M as number` / `outputPer1M as number`
  (lines 57–58) defeat type-checking. Restructure `handleSave` so the non-null values are
  proven by control flow (e.g. compute and early-return on `null`) rather than asserted.
- `provider` is cast from `e.target.value as AIModelConfig['provider']` (line 115) — acceptable
  but a typed `onChange` or a guarded parse is safer.
- `AI_PROVIDERS` lists `'LLAMACPP'` etc. as a `const` tuple — good. Ensure it's derived from
  the same source as `AIModelConfig['provider']` so they can't drift.

### `EditCalendarDialog.tsx`
- **Loses type safety by using `string` for finite domains.** `freq`, `endType`, `interval`,
  `count`, `byday` are typed as `string`/`string[]` even though `freq` ∈ `FREQ_OPTIONS` and
  `endType` ∈ `END_OPTIONS`. Use the literal union types (`typeof FREQ_OPTIONS[number]`), and
  type `FREQ_LABELS`/`FREQ_UNITS`/`END_LABELS` as `Record<Freq, string>` so a missing key is a
  compile error.
- **Shadowing a global.** The state setter is named `setInterval` (line 49), shadowing
  `window.setInterval`. Rename (e.g. `repeatInterval`/`setRepeatInterval`) to avoid confusion
  and footguns.
- No `Esc` handling and no autofocus, unlike its siblings (1.3, 1.9).
- Inline Tailwind input classes (`bg-slate-700 text-slate-100 border ...`) are repeated ~6
  times rather than using the `DLG_INPUT_*` constants the other dialogs share — inconsistent
  and harder to maintain.
- Date parsing/formatting helpers (`parseDueStr`, `formatDueDate`) live in the component file;
  these belong in `utils/calendar` next to the related parsing utilities, and would benefit
  from unit tests.

### `ExifDialog.tsx`
- **Expensive work in render body.** The dedupe loop (building `seen`/`deduped`, lines 63–78)
  runs on every render. Wrap in `useMemo` keyed on the active data source.
- **Direct `alert()`** for errors and validation (see 1.6).
- **Business logic in a presentational component.** `handleAddDescription` hard-codes the
  OCR tag mapping (`png`/`xmp-dc` → `Description`) referencing `merlin_ocr.py`. This mapping
  belongs in a shared util so renderer and OCR logic can't drift.
- `saving` state carries a `// Track if saving (future use)` comment — either wire it fully or
  remove dead intent. (It *is* used to disable buttons, so the comment is stale.)
- Uses `\0` as a key delimiter for `textAreaRefs` (`${group}\0${tag}`) — works, but a nested
  map or a stable composite key object is clearer.
- Manual textarea auto-resize via direct DOM style mutation is imperative; acceptable for
  perf but a `field-sizing: content` CSS approach or a small hook would be cleaner.

### `ExportDialog.tsx`
- **Use-before-declaration ordering.** `handleExport` (line 39) references
  `fileNameHasExtension`, which is declared later at line 57. It works because it's a `const`
  arrow read at call time, but reads as fragile; hoist the derived value above the handlers.
- The long positional `onExport(folder, fileName, bool, bool, bool, bool)` signature
  (4 booleans) is error-prone. Prefer a single options object
  (`onExport(opts: ExportOptions)`) so call sites can't transpose the booleans.

### `RenameDialog.tsx`
- Solid. Minor: closing via `onCancel()` when the name is unchanged conflates "no-op" with
  "cancel"; a dedicated no-op path is clearer but not important.

### `ReplaceDialog.tsx`
- Fine. Could share the input + Enter/Escape scaffolding with the other single-field dialogs.

### `SearchDialog.tsx`
- **Dead error state.** `error` is only ever set to `null` (lines 100, 111, 120); it's never
  assigned a message, so the red-border and error `<p>` branches (lines 218, 297–298) are
  unreachable. Either wire real validation errors into it or remove the state and its branches.
- **`setTimeout(adjustTextareaHeight, 0)`** (line 78) to resize after a state update is a
  smell. Use `useLayoutEffect` keyed on `searchQuery`, or a ref callback, so it's deterministic
  and not a magic 0ms delay.
- Largest dialog in the folder (~357 lines) with two panels, sort controls, and saved-search
  CRUD. Consider extracting the saved-definitions list panel and the options panel into
  subcomponents for readability/testability.
- Inline `style={{ width: '33.333%' }}`, `minHeight: '480px'`, etc. mix with Tailwind; prefer
  Tailwind utilities (`w-1/3`, `min-h-[480px]`) for consistency.

### `StreamingDialog.tsx`
- **Bypasses React's declarative model.** Streaming output is built with
  `document.createElement('span'/'div')` and `textContent +=` mutations into a ref'd `<pre>`
  (lines 18–37, 48–53). This is an imperative escape hatch; while it can be justified for
  high-frequency streaming perf, the standard React approach is to accumulate chunks in state/a
  ref and render them. At minimum, document *why* the manual DOM path was chosen.
- **Misleading effect dependency.** The streaming `useEffect` lists `[onClose]` (line 84) but
  doesn't use `onClose`; it *does* depend on `window.electronAPI` callbacks and `appendText`.
  The deps array doesn't reflect actual dependencies — a common source of subtle bugs. With the
  current design it should arguably be `[]` with a comment, but the honest fix is to make the
  dependencies explicit.
- **Confusing two-callback API.** It takes both `onClose` and `onCancel`, and `handleStop`
  calls `onCancel()` then `onClose()`. The contract between them isn't obvious from the props;
  consider a single `onClose(reason)` or clear doc comments.
- Spinner `<svg>` has no `role="img"`/`aria-label`; the streaming region isn't an ARIA live
  region, so screen readers won't announce incoming text.

### `TagsEditorDialog.tsx`
- **Module-level mutable counter.** `let nextId = 1; newId()` (lines 23–24) is module global
  state. It survives across mounts and isn't reset, so IDs keep climbing for the app's lifetime
  — harmless here (IDs only need to be unique within a session) but it's shared mutable module
  state, which is generally discouraged and not test-friendly. Prefer `crypto.randomUUID()` or
  a `useRef` counter scoped to the component.
- Re-sorts categories with `[...categories].sort(...)` in multiple render paths (lines 75, 207)
  and in the load effect; memoize the sorted list with `useMemo`.
- `onClick` handlers on non-button `<div>` rows (line 215) for selection — should be a
  `<button>`/`role="button"` with keyboard support for a11y.
- Otherwise well-structured (good use of `useCallback`, immutable updates, validation).

### `common/CheckboxField.tsx` / `common/RadioField.tsx`
- `CheckboxField` returns a fragment with the `<label>` and a sibling `<p>` description. Because
  the description is a *sibling* of the label (not inside it), it isn't associated with the
  input for AT. Use `aria-describedby` linking the input to the description's `id`.
- Both use `React.FC`; see 1.10.
- The large number of class-override props (`inputClassName`, `spanClassName`, `className`,
  `descriptionClassName`) is a sign styling variance is being pushed through props. A
  variant/size prop (or a `clsx`-based variant map) scales better than four override slots.

### `common/RadioGroup.tsx`
- Good: generic over `T extends string`, proper `<fieldset>`/`<legend>`. This is the cleanest
  component in the folder and a good model for the others.

### `common/DlgHeader.tsx`
- The close `<button>` correctly has `type="button"` and `aria-label="Close"` — good. When the
  shared `Dialog` wrapper lands, this header's `<h3>` should receive the `id` referenced by the
  dialog's `aria-labelledby`.

---

## 3. Suggested priority order

1. **Introduce a shared `<Dialog>` wrapper** (portal + `role="dialog"`/`aria-modal` +
   focus trap + focus restore + `Esc` + optional backdrop-close). Fixes 1.1–1.5, 1.9 at once
   and removes large amounts of duplication. (Native `<dialog>` is the lowest-effort route.)
2. **Replace `window.alert()`** in `ExifDialog` with the in-app dialog/notification path (1.6).
3. **Fix the misleading/incorrect effect deps and dead state** (`StreamingDialog` deps,
   `SearchDialog` `error`).
4. **Tighten types**: remove `as number` assertions (`EditAIModelDialog`) and replace `string`
   domains with literal unions (`EditCalendarDialog`); rename the `setInterval` shadow.
5. **Convert option-bag callbacks** (`ExportDialog`'s 4-boolean signature) to options objects.
6. **De-duplicate** the single-field dialogs and the focus-on-mount logic via the wrapper/hooks.
7. Smaller cleanups: `type="button"` everywhere, `useMemo` for per-render computations
   (`ExifDialog`, `TagsEditorDialog`), drop `React.FC`/namespace imports, move parsing/util and
   business-logic helpers out of components.
