# TypeScript 7 — Why We Haven't Upgraded Yet

**Investigated:** 2026-07-13
**Decision:** Stay on TypeScript 6.0.3. Revisit when `typescript-eslint` supports TS 7.x.
**Blocker:** `typescript-eslint` (all packages) — its peer range explicitly excludes TypeScript 7.

---

## TL;DR

TypeScript 7.0.2 is real, released, and is the `latest` tag on npm. Our **code is fully ready for it**:
it typechecks with **zero errors** and roughly **6x faster** than TS 6. Nothing in our source needs to change.

We are blocked purely on **tooling**. TypeScript 7 is the Go-native compiler rewrite, and that rewrite
removed the classic in-process JavaScript compiler API. `typescript-eslint` is built entirely on that API.
Installing TS 7 today does not *degrade* our lint — it **crashes** it, taking `npm run lint` (and therefore
`prebuild`) down with it.

---

## Background: what TypeScript 7 actually is

TypeScript 7 is not an incremental release. It is the **native (Go) port** of the compiler — the project
previously previewed as "Corsa" / `@typescript/native-preview` (the `tsgo` binary).

Consequences visible in the published package:

- The `typescript` npm package is now a **~360 KB JS shim** (`lib/getExePath.js`) that shells out to a
  platform-specific **native Go binary**, delivered via `optionalDependencies`
  (`@typescript/typescript-linux-x64`, `-darwin-arm64`, `-win32-x64`, …).
- The compiler no longer runs *in* your Node process. It runs as a **separate Go process**, reachable over
  **JSON-RPC** (the package vendors `vscode-jsonrpc`).
- The API surface is entirely new and lives under **`./unstable/*`** export subpaths — and is, per its own
  naming, **explicitly unstable**.

### The `exports` map is the whole story

From `typescript@7.0.2`'s `package.json`:

```jsonc
"exports": {
  ".":                "./lib/version.cjs",        // <-- the main entry point is now JUST A VERSION STRING
  "./unstable/sync":  "./dist/api/sync/api.js",   // <-- the real API, marked unstable
  "./unstable/async": "./dist/api/async/api.js",
  "./unstable/ast":   "./dist/ast/index.js",
  // ...
}
```

Importing `typescript` no longer gives you a compiler. It gives you a version number.

---

## Evidence

### 1. TS 7.0.2 is genuinely the current release

```
$ npm view typescript dist-tags
{
  beta:   '6.0.0-beta',
  rc:     '7.0.1-rc',
  latest: '7.0.2',            <-- current
  next:   '7.1.0-dev.20260713.1'
}
```

### 2. The classic compiler API is gone from the main entry

Installed `typescript@7.0.2` in a scratch dir and imported it:

```js
import * as ts from 'typescript';
console.log(Object.keys(ts));
console.log(typeof ts.createProgram, typeof ts.SyntaxKind, typeof ts.createSourceFile);
```

Result:

```
exports:              [ 'default', 'version', 'versionMajorMinor' ]
ts.createProgram    = undefined
ts.SyntaxKind       = undefined
ts.createSourceFile = undefined
```

**This is the blocker in one output block.** Any tool doing `import ts from 'typescript'` and calling
`ts.createProgram(...)` / reading `ts.SyntaxKind` gets `undefined` and throws. It is a hard runtime crash,
not a compatibility warning.

### 3. `typescript-eslint` has no TS 7 support, and says so

```
$ npm view typescript-eslint dist-tags
{ latest: '8.63.0', canary: '8.63.1-alpha.17' }

$ npm view typescript-eslint@latest peerDependencies
{
  eslint:     "^8.57.0 || ^9.0.0 || ^10.0.0",
  typescript: ">=4.8.4 <6.1.0"        <-- upper bound excludes 7.x outright
}
```

Every package in the family carries that same `<6.1.0` ceiling:

| Package | typescript peer range |
|---|---|
| `typescript-eslint` | `>=4.8.4 <6.1.0` |
| `@typescript-eslint/eslint-plugin` | `>=4.8.4 <6.1.0` |
| `@typescript-eslint/parser` | `>=4.8.4 <6.1.0` |
| `@typescript-eslint/typescript-estree` | `>=4.8.4 <6.1.0` |
| `@typescript-eslint/project-service` | `>=4.8.4 <6.1.0` |
| `@typescript-eslint/tsconfig-utils` | `>=4.8.4 <6.1.0` |
| `@typescript-eslint/type-utils` | `>=4.8.4 <6.1.0` |
| `@typescript-eslint/utils` | `>=4.8.4 <6.1.0` |
| `ts-api-utils` | `>=4.8.4` (loose range, but also uses the classic API — would break too) |

### 4. …and it is the ONLY blocker

Scanned every installed package for a `typescript` peer dependency. The **only** hits are the
`typescript-eslint` family plus `ts-api-utils` (which is typescript-eslint's own dependency).

Nothing else in the tree touches the TypeScript JS API:

- **Vite / Vitest** — transpile via esbuild, never load the TS compiler.
- **Electron Forge / plugin-vite** — unaffected.
- **babel-plugin-react-compiler** — runs on Babel, not the TS API.
- **`compiler-coverage.mjs`** — drives the React Compiler, not the TS API.

Also confirmed: **no file in `src/` or at the repo root imports `typescript` directly.** Our own code never
touches the compiler API.

### 5. Our code is already TS 7-clean — and TS 7 is much faster

Ran both compilers against our real, unmodified `tsconfig.json`:

| Compiler | Result | Wall time |
|---|---|---|
| TS 6.0.3 (current) | clean, 0 errors | **3.79s** |
| TS 7.0.2 (native)  | clean, 0 errors | **0.63s** |

**Zero errors on TS 7, ~6x faster.** No source changes, no `tsconfig.json` changes required. The upgrade is
sitting there ready the moment the linter can come along.

---

## Why we can't just eat the lint breakage

`package.json` wires the typecheck and the lint together, and gates the build on both:

```jsonc
"prebuild": "npm run lint",
"lint":     "tsc --noEmit && eslint .",
```

If `eslint .` crashes, we don't just lose style nits. We lose:

- **Type-aware correctness rules** (require a TS Program via `projectService: true` in `eslint.config.mjs`):
  `@typescript-eslint/no-floating-promises`, `no-misused-promises`, `return-await`,
  `switch-exhaustiveness-check`, `no-deprecated`, and the four `no-unsafe-*` rules
  (`no-unsafe-assignment` / `-call` / `-member-access` / `-return`) that catch `any` leaking out of
  third-party libraries.
- **The React Compiler bailout guards** — `react-hooks/todo` and `react-hooks/syntax`, plus the rest of the
  `eslint-plugin-react-hooks@7` set.

That second one is the real reason this is non-negotiable. Per `AGENTS.md`, this codebase **removed all manual
`useCallback`/`useMemo`** in favor of the React Compiler. The compiler **bails out silently** on constructs it
can't handle (`try/finally`, ref writes during render, mutating module globals, `this`), leaving a component
fully de-memoized with **no error and no warning**. Those ESLint rules are what turn a silent perf regression
into a failed lint. Running without them means flying blind on exactly the failure mode we can't otherwise see.

Trading a 3-second typecheck speedup for that is a bad deal.

---

## Options considered

| Option | Verdict |
|---|---|
| **Full TS 7 now** — replace `typescript@6` outright | ❌ Rejected. `eslint .` crashes; loses type-aware rules + React Compiler bailout guards. |
| **Side-by-side** — keep `typescript@6` as the resolved `typescript` (so typescript-eslint works), add TS 7 under an npm alias (e.g. `"typescript7": "npm:typescript@7.0.2"`) and point the typecheck step at its binary by explicit path | ⚠️ Viable, and it's the migration path MS designed the native compiler for. Gets the native typecheck now with lint intact. **Not taken for now** — we opted to keep the toolchain simple rather than run two compilers. Note: both packages declare a `tsc` bin, so `node_modules/.bin/tsc` would collide; the alias must be invoked by full path. |
| **Wait for typescript-eslint** | ✅ **Chosen.** Stay on 6.0.3, upgrade in one clean step later. |

---

## When to revisit

Re-check periodically:

```bash
npm view typescript-eslint@latest peerDependencies
```

**The upgrade is unblocked when that `typescript` range admits `7.x`** (i.e. the `<6.1.0` ceiling is lifted).

At that point the upgrade should be close to trivial, because we already proved the code compiles clean:

1. `npm install -D typescript@^7 typescript-eslint@<whatever version lands>`
2. Bump the other `@typescript-eslint/*` devDeps to match.
3. `npm run lint` — expect `tsc --noEmit` clean (already verified) and `eslint .` to work again.
4. `npm test` and a `npm run package` smoke test.

No `tsconfig.json` changes are anticipated — TS 7.0.2 accepted our existing config as-is.

---

## Note for our OTHER TypeScript projects

**Installing TS 7 in one project does not affect any other project.** There is no machine-wide TypeScript
install; it is a per-project `devDependency` resolved out of that project's own `node_modules/typescript`.
Every other repo stays on whatever version its own `package.json` pins. Nothing breaks on its own, and there is
no forced migration.

When upgrading those projects, the triage is the same one that decided this project — and it is **not** about
your source code. It's about whether **anything in the project consumes TypeScript's JS API**.

Quick test in any repo:

```bash
npm ls typescript
grep -rn "from 'typescript'\|require('typescript')" --include=*.ts --include=*.js --include=*.mjs . | grep -v node_modules
```

…and check for any of these usual suspects:

- `typescript-eslint` / `@typescript-eslint/*`  ← the big one
- `ts-node`, `ts-jest`, `ts-patch`, `tsup`, TypeDoc
- anything else that builds a TS Program

**Rule of thumb:**

- Projects with **none** of the above — a plain library, or a Vite/esbuild/SWC app whose lint is *not*
  type-aware — can typically go **straight to TS 7** and just enjoy the speedup.
- Projects with **type-aware ESLint** (like this one) hit the **identical wall** and should wait.
