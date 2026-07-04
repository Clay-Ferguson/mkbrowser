# Linter Improvements — Backlog

This file contains a list of future Linter improvements we're going to be adding.

Single source of truth for the remaining findings from the linter audit of **2026-07-04**.
The "free wins" tier from that audit is already applied (see Appendix A). Everything below
is future work, ordered roughly by value-for-effort — tackle one at a time and check items
off / delete them as they land.

Hit counts below are as of the audit date. To re-measure any candidate rule without
touching config:

```bash
npx eslint src --rule '{"<rule-name>": "error"}'
```

(Typed `@typescript-eslint/*` rules only work under `src/**`, where the `eslint.config.mjs`
override supplies a TypeScript program via `parserOptions.projectService`. The flat config
derives file extensions from its `files` globs, so `--ext` is gone.)

---

## 1. `react/no-array-index-key` — 1 hit ✅ DONE (2026-07-04)

- [x] `src/components/PathBreadcrumb.tsx:112` — replaced `key={`${part}-${index}`}` with
  `key={segmentPath}` (the cumulative path prefix, already computed and unique per segment).
- [x] Enabled `"react/no-array-index-key": "error"` in the config (global `rules` block).
- [x] `npx eslint src` passes clean.

Catches: stale/duplicated component state when a keyed-by-index list is reordered,
inserted into, or filtered.

## 2. `@typescript-eslint/prefer-nullish-coalescing` — 39 hits

Currently `"off"` in `eslint.config.mjs`. Each `a || b` where `a` can legitimately be `0`, `''`,
or `false` is a latent bug (the fallback fires on valid values); the rest are stylistic.
This needs a **one-time human triage** of all 39 sites — decide per site whether `||` is
intended — then flip the rule to `"error"` in the `src/**` override (it requires typed
linting) so new code gets checked. Options like `ignorePrimitives: { string: true }` can
cut noise if string-`||` turns out to be always-intentional here.

## 3. The four `no-unsafe-*` rules ✅ DONE (2026-07-04)

`no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`
were `"off"` — enabled all four as `"error"` in the `src/**` typed override (they close
the third-party-`any` gap left by `no-explicit-any`, which only bans first-party `any`).
Only **14 hits** total (the LangChain code was already tightly typed); each was a genuine
untyped-`any` escape, all fixed at the source rather than suppressed:

- [x] `FolderGraphView.tsx` — the d3 `'drag'`/`'end'` `.on()` callbacks had untyped
  `event`; added the explicit `D3DragEvent<SVGGElement, SimNode, SimNode>` annotation the
  `'start'` handler already carried.
- [x] `IndexTreeView.tsx`, `linkUtil.ts` — `Array(ups).fill('..')` is `any[]`; typed as
  `Array<string>(ups)` so the spread is safe.
- [x] `exportUtil.ts` — the `String.replace` `<img>` callback's `attrs` param defaulted to
  `any`; typed the callback params `(fullMatch: string, attrs: string)`.
- [x] `asyncUtil.ts` — `new Array(items.length)` is `any[]` assigned to `R[]`; typed
  `new Array<R>(...)`.
- [x] Enabled all four as `"error"` in the `src/**` override; `yarn lint` clean.

## 4. `noUncheckedIndexedAccess` (tsconfig) — 98 errors

The single highest-value strictness upgrade for this codebase: it makes `map.get(k)`,
`arr[i]`, and object index reads return `T | undefined`, forcing misses to be handled —
directly relevant to the `Map<path, ItemData>` store at the heart of the app. **98 errors**
as of the audit, so this is a real adoption project (probably one directory at a time,
fixing genuine miss-handling and adding narrowing where the value is provably present),
not a toggle. Re-measure with:

```bash
npx tsc --noEmit --noUncheckedIndexedAccess | grep -c 'error TS'
```

## 5. `@typescript-eslint/no-unnecessary-condition` — 68 hits (one-time sweep, not a gate)

Flags conditions the type-checker proves always-true/always-false — a mix of genuine dead
branches, stale defensive checks, and places where the *types* are wrong (claiming
non-nullable when runtime says otherwise). Too noisy as a permanent `error`, but worth a
**one-time manual sweep**: each hit is either dead code to delete or a type to fix. Note
it interacts with item 4 — adopting `noUncheckedIndexedAccess` first will change (and
legitimize) many of these hits, so do the sweep **after** item 4.

## 6. ESLint 9 / flat-config migration — housekeeping ✅ DONE (2026-07-04)

ESLint 8 had been EOL since late 2024. Migrated to ESLint 9 + flat config — done ahead
of items 2–5 on purpose, so those config changes are authored once against the modern
format instead of being written into the legacy `.eslintrc.js` and then re-translated.

- [x] Bumped `eslint` to `^9`; added `@eslint/js`, `globals`, and the `typescript-eslint`
  v8 meta-package (Yarn 1, `yarn add -D`). Kept `eslint-plugin-import` v2.32 (it already
  ships `flatConfigs.recommended/.electron/.typescript`), `eslint-plugin-react` v7.37,
  and `eslint-plugin-react-hooks` v7 — no plugin swaps needed.
- [x] Rewrote config as `eslint.config.mjs` (`tseslint.config(...)`), a 1:1 translation of
  every rule + option + comment. Typed rules stay scoped to `src/**` via a `files` entry
  using `parserOptions.projectService` (v8's replacement for `project`). Deleted `.eslintrc.js`.
- [x] `lint` script: dropped the removed `--ext` flag → `tsc --noEmit && eslint .`.
- [x] Removed two now-flagged dead `eslint-disable` directives (ESLint 9 reports unused
  ones by default): a redundant `no-unused-vars` disable in `BrowseView.tsx` (the `_`
  prefix already exempts it) and a stale `no-var-requires` disable in `search.test.ts`.
- [x] Parity verified: `yarn lint` clean; typed linting confirmed live on `src/**`
  (the audit's 39 `prefer-nullish-coalescing` hits still reproduce); `pre-package.sh`
  (tests + lint + compiler coverage) passes. Docs updated (`AGENTS.md`, `DEVELOPER_GUIDE.md`).

## 7. Optional / nice-to-have

- **`eslint-plugin-jsx-a11y`** — accessibility lints (labels, roles, keyboard handlers).
  For a personal desktop app this is a judgment call, but it's cheap to adopt with the
  `recommended` preset and occasionally catches real UX bugs (e.g. click handlers on
  non-interactive elements).
- **`import/no-cycle` as an occasional audit** — stays `"off"` (19 hits, dominated by the
  deliberate store slices ↔ `core.ts` pattern), but running it ad hoc after big refactors
  can spot *new* accidental cycles outside the store:

  ```bash
  npx eslint src --rule '{"import/no-cycle": ["error", {"maxDepth": 4}]}'
  ```

---

## Evaluated and rejected (recorded so we don't re-litigate)

| Rule | Verdict |
|---|---|
| `react/jsx-no-leaked-render` | 109 hits. The `{count && <X/>}`-renders-`0` pitfall is real, but the rule isn't type-aware, so it flags every safe boolean guard too. Not worth `!!`-noise in a strict-TS codebase; the type-aware alternative (`strict-boolean-expressions`) is even more invasive. |
| `import/no-cycle` (always-on) | 19 hits, nearly all the intentional Zustand slices ↔ `core.ts` architecture. Correctly `"off"`; see "occasional audit" above. |
| `require-atomic-updates` | 6 hits, mostly known false-positive shapes (e.g. `results[i] = await fn(...)` in `src/shared/asyncUtil.ts`, which is intentional and correct). |
| `@typescript-eslint/return-await` full `in-try-catch` mode | The extra hits over the adopted `error-handling-correctness-only` mode were the harmless style direction (`return await` outside try/catch), not bugs. |

---

## Appendix A — already applied (2026-07-04)

For reference, the audit's "free wins" tier shipped alongside this file:

- **tsconfig**: `noImplicitReturns`, `noFallthroughCasesInSwitch` (0 errors at adoption).
- **ESLint global**: `no-constant-binary-expression`, `array-callback-return`
  (`checkForEach: false`), `no-self-compare`, `no-unreachable-loop`,
  `no-promise-executor-return` (15 sleep-style executors braced in `src/main/ai/` + `tests/`).
- **ESLint `src/**` override (typed)**: `return-await` (`error-handling-correctness-only`),
  `switch-exhaustiveness-check` (`considerDefaultExhaustiveForUnions: true`),
  `no-deprecated` (fixed 8 hits: React 19's deprecated `FormEvent` → `SubmitEvent` in 7
  dialogs, Zod 4's deprecated `ZodTypeAny` → `z.ZodType` in `configSchema.ts`).
