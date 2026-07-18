// Flat config (ESLint 9). Migrated 1:1 from the former .eslintrc.js — same rules,
// same options, same scoping. The two config objects below mirror the old file's
// global `rules` block and its single `src/**` typed-linting `overrides` entry.
//
// Only *.ts / *.tsx / *.mts are linted: every config object is constrained to
// those globs, so root .mjs/.js files are left untouched. The .mts glob exists
// because the Vite configs are .mts (Vite 8 is ESM-only) — without it they would
// match no config object at all and be silently skipped by lint entirely.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  // Directories to skip entirely during linting (was `ignorePatterns`).
  { ignores: [".vite/", "out/", "dist/", "node_modules/"] },

  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    // Base rule sets, formerly the string `extends` array. `extends` inside a
    // tseslint.config object applies each set constrained to this `files` glob.
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      importPlugin.flatConfigs.recommended,
      importPlugin.flatConfigs.electron,
      importPlugin.flatConfigs.typescript,
      // eslint-plugin-react recommended rule set.
      reactPlugin.configs.flat.recommended,
      // Disables react-in-jsx-scope / jsx-uses-react, which are obsolete under the
      // automatic JSX runtime used by React 17+ (this app is on React 19), so JSX
      // files don't need to `import React`.
      reactPlugin.configs.flat["jsx-runtime"],
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      // Was the `env: { browser, es6, node }` block.
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    // Detect the installed React version for version-dependent rules.
    settings: {
      react: {
        version: "detect",
      },

      // Add eslint-import-resolver-typescript alongside the plain-node resolver
      // that importPlugin.flatConfigs.typescript installs above (an import is
      // considered resolved if EITHER resolver finds it). The node resolver
      // predates `exports` maps and can't see through them, so on its own it
      // fails on modern ESM-only packages — it could not resolve `vite` itself,
      // whose exports is a bare string with no CJS entry, and that is precisely
      // why the .mts configs were unlintable — and on subpath exports, which is
      // what the old @langchain/langgraph ignore was working around.
      "import/resolver": {
        typescript: true,
      },
    },

    rules: {
      // ─── Type Safety ──────────────────────────────────────────────────────────

      // Disallow the `any` type. "warn" allows it with a warning; "error" prohibits it; "off" permits freely.
      "@typescript-eslint/no-explicit-any": "error",

      // Require explicit return type annotations on all functions and methods.
      "@typescript-eslint/explicit-function-return-type": "off",

      // Require explicit return types on exported functions/methods only.
      "@typescript-eslint/explicit-module-boundary-types": "off",

      // Disallow the non-null assertion operator (!). "error" to ban it outright.
      // NOTE: We needed to use this a lot to satisfy the noUncheckedIndexedAccess TSC rule.
      "@typescript-eslint/no-non-null-assertion": "off",

      // The four no-unsafe-* rules require type-checked linting, so they are
      // enabled as "error" for src/** in the overrides block below (root configs
      // and tests/ are outside tsconfig). They catch `any` leaking out of
      // loosely-typed third-party libraries — closing the gap left by
      // no-explicit-any, which only bans first-party `any`.

      // Disallow async functions whose returned Promise is never awaited or handled.
      // Requires type-checked linting, so it is enabled as "error" for src/** in
      // the overrides block below (root configs and tests/ are outside tsconfig).
      "@typescript-eslint/no-floating-promises": "off",

      // Disallow await on non-Promise values. Requires type-checked linting.
      "@typescript-eslint/await-thenable": "off",

      // ─── Code Quality ─────────────────────────────────────────────────────────

      // Warn/error on console.log/warn/error calls. Common to set "warn" during development,
      // "error" before shipping, or "off" for Electron apps that rely on console output.
      "no-console": "error",

      // Disallow debugger statements left in code.
      "no-debugger": "error",

      // Disallow declared but unused variables. Variables/args prefixed with _ are exempt.
      // ignoreRestSiblings allows the common "destructure to omit" pattern, e.g.
      // `const { node, ...props } = x` to strip `node` before spreading the rest.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_", "ignoreRestSiblings": true },
      ],

      // Disallow `var`; require `const` or `let` instead.
      "no-var": "error",

      // Disallow empty function bodies. "off" to permit no-op callbacks freely.
      "@typescript-eslint/no-empty-function": "off",

      // Disallow empty interface declarations (e.g. `interface Foo {}`).
      "@typescript-eslint/no-empty-interface": "error",

      // ─── Logic-Bug Catchers ───────────────────────────────────────────────────
      // (no-constant-binary-expression joined eslint:recommended in ESLint 9, but is
      // kept explicit here so the intent is documented alongside the others.)

      // Expressions with a constant outcome, e.g. `a ?? b || c` precedence mistakes
      // or comparisons like `x === undefined || null` that are always false.
      "no-constant-binary-expression": "error",

      // A .map/.filter/.some/.sort callback with a code path that forgets to
      // `return` (checkForEach off: forEach callbacks legitimately return nothing).
      "array-callback-return": ["error", { "checkForEach": false }],

      // Comparing a value to itself — almost always a typo for another variable.
      "no-self-compare": "error",

      // A loop whose body guarantees it runs at most once (stray break/return).
      "no-unreachable-loop": "error",

      // Returning a value from a `new Promise((resolve) => …)` executor — the
      // value is silently discarded, which usually means a lost promise. Sleep
      // helpers must use a braced body: `(resolve) => { setTimeout(resolve, ms); }`.
      "no-promise-executor-return": "error",

      // Disallow using an array index as a React `key`. When a keyed-by-index list
      // is reordered, filtered, or inserted into, React reconciles by index and
      // leaks stale/duplicated component state into the wrong item. Keys must be
      // derived from stable, unique data (e.g. a cumulative path prefix).
      "react/no-array-index-key": "error",

      // ─── Import Rules ─────────────────────────────────────────────────────────

      // Enforce a consistent import ordering: built-ins → external → internal → relative.
      // Set to "off" to disable ordering enforcement entirely.
      "import/order": [
        "error",
        {
          "groups": [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"],
          ],
          "newlines-between": "ignore",
        },
      ],

      // Imports must point at something that actually resolves. The TypeScript
      // resolver (settings above) follows `exports` maps, so the subpath exports
      // that the old node resolver choked on (@langchain/langgraph/prebuilt,
      // vitest/config, react-day-picker/style.css) now resolve for real rather
      // than being ignored or suppressed.
      "import/no-unresolved": "error",

      // Disallow importing the same module more than once in a file.
      "import/no-duplicates": "error",

      // Detect circular import dependencies. Expensive on large codebases; enable selectively.
      "import/no-cycle": "off",

      // ─── Style & Syntax Preferences ───────────────────────────────────────────

      // Require `const` for variables that are never reassigned.
      "prefer-const": "error",

      // Require === and !== instead of == and !=.
      "eqeqeq": ["error", "always"],

      // Prefer optional chaining `a?.b` over `a && a.b`. Requires typed linting.
      "@typescript-eslint/prefer-optional-chain": "off",

      // Require curly braces around all if/else/for/while blocks.
      "curly": "off",

      // Enforce `import type` for type-only imports (keeps runtime bundle clean).
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },

  // Type-checked rules need a TypeScript program, which only covers files in
  // tsconfig.json's include (src/**). Root-level configs (forge.config.ts,
  // vite.*.config.ts) and tests/ are outside tsconfig, so the typed rules are
  // scoped here. `projectService` is typescript-eslint v8's simpler replacement
  // for the old `parserOptions.project = "./tsconfig.json"`.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",

      // The four no-unsafe-* rules catch an `any` value (typically escaping from
      // a loosely-typed third-party library) being assigned, called, member-
      // accessed, or returned — where it silently defeats type checking
      // downstream. no-explicit-any already bans first-party `any`; these close
      // the third-party gap. All require type-checked linting, hence src/**.
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",

      // Prefer `??` over `||` when the intent is a null/undefined fallback.
      // `||` also fires on `0`, `''`, and `false`, so a `|| fallback` on a
      // value that can legitimately be one of those is a latent bug (the
      // fallback fires on a valid value). Requires type-checked linting,
      // hence its placement in this src/**-scoped override.
      "@typescript-eslint/prefer-nullish-coalescing": "off",

      // Disallow passing an async function (Promise-returning) where a
      // void-returning callback/prop is expected. Without this, an
      // `async () => Promise<void>` handler can be wired to a `() => void`
      // prop (onClick, ConfirmDialog onConfirm, a native-menu listener, …)
      // and a rejection from an awaited IPC call becomes an unhandled
      // rejection in devtools instead of surfacing through the app's error
      // dialogs. `checksVoidReturn` is the part that catches those handoffs;
      // the other checks are left off so ordinary `if (promise)` style
      // misuse (rare here) doesn't add noise. Requires type-checked linting,
      // hence its placement in this src/**-scoped override.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: true, checksConditionals: false, checksSpreads: false },
      ],

      // Disallow `return somePromise()` inside a try/catch/finally — without
      // an `await`, a rejection from that promise skips the surrounding catch
      // entirely. The "error-handling-correctness-only" mode flags ONLY that
      // bug-prone case and stays silent on the pure style question of
      // `return await` elsewhere. Requires type-checked linting.
      "@typescript-eslint/return-await": ["error", "error-handling-correctness-only"],

      // A switch over a union type must handle every member (or have a
      // `default`, per considerDefaultExhaustiveForUnions) — catches "added a
      // union member, forgot a switch" bugs. Requires type-checked linting.
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],

      // Flag any use of an API whose declaration carries a @deprecated JSDoc
      // tag (e.g. React 19's FormEvent, Zod 4's ZodTypeAny). Requires
      // type-checked linting.
      "@typescript-eslint/no-deprecated": "error",

      // React Hooks rules are scoped to src/** so they don't misfire on
      // Playwright fixture callbacks (the `use` param) in e2e/ and fixtures/.
      //
      // ── eslint-plugin-react-hooks@7 recommended set ──
      // The two core rules stay as errors (the codebase passes them clean):
      // rules-of-hooks: hooks must be called unconditionally, at the top level.
      "react-hooks/rules-of-hooks": "error",
      // exhaustive-deps: effect/callback/memo dependency arrays must list every
      // reactive value referenced in the hook body. Catches stale-closure bugs.
      "react-hooks/exhaustive-deps": "error",

      // The remaining v7 recommended rules (React-19 / React-Compiler era checks),
      // all promoted to "error" — the codebase passes them clean.
      "react-hooks/set-state-in-effect": "error",        // setState inside an effect (extra render passes)
      "react-hooks/refs": "error",                        // ~16 hits — reading/mutating a ref during render
      "react-hooks/set-state-in-render": "error",         // setState during render (infinite-loop risk)
      "react-hooks/purity": "error",                      // render must be a pure function of props/state
      "react-hooks/immutability": "error",                // don't mutate props/state/hook return values
      "react-hooks/static-components": "error",           // don't declare components inside other components
      "react-hooks/use-memo": "error",                    // correct use of useMemo
      "react-hooks/preserve-manual-memoization": "error", // keep manual memo deps consistent for the compiler
      "react-hooks/incompatible-library": "error",        // flag libraries that break hook/compiler assumptions
      "react-hooks/globals": "error",                     // no mutation of module-level/global state in render
      "react-hooks/error-boundaries": "error",            // correct error-boundary usage
      "react-hooks/unsupported-syntax": "error",          // syntax the React Compiler can't optimize
      "react-hooks/config": "error",                      // validity of React Compiler config
      "react-hooks/gating": "error",                      // correct feature-gating of compiled output

      // ── React Compiler bailout guards (not in the recommended set) ──
      // The build compiler (babel-plugin-react-compiler in
      // vite.renderer.config.mts) bails out SILENTLY on components it can't
      // compile, de-memoizing them — and since this codebase removed all
      // manual useCallback/useMemo in favor of the compiler, a bailout is a
      // real perf regression, not a no-op. These rules make bailout-introducing
      // code (e.g. a try/finally inside a component or hook) fail lint instead.
      // Compiler-unsupported constructs belong in module-level helper functions,
      // which the compiler doesn't compile (see REACT_COMPILER_PLAN.md).
      // Caveat: bailouts caused by an eslint-disable of a react-hooks rule
      // cannot be linted (in lint mode the compiler deliberately ignores those
      // comments and validates the code itself) — but those require a visible
      // disable comment in the diff, so they can't slip in silently.
      "react-hooks/todo": "error",                        // constructs the compiler doesn't support YET (try/finally, mutating globals, `this`, …)
      "react-hooks/syntax": "error",                      // invalid JS the compiler rejects outright
    },
  },

  // Typed linting for everything OUTSIDE src/: the test suite and the root
  // build/tool configs, which tsconfig.node.json type-checks (see its header).
  // Uses an explicit `project` rather than `projectService` because these files
  // are not in the root tsconfig.json, which is what the project service would
  // find for them. Same typed rule set as the src/** block above, minus the
  // react-hooks rules — those stay src-scoped so they don't misfire on
  // Playwright fixture callbacks (the `use` param) in e2e/ and fixtures/.
  {
    files: ["tests/**/*.ts", "*.config.ts", "*.config.mts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.node.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: true, checksConditionals: false, checksSpreads: false },
      ],
      "@typescript-eslint/return-await": ["error", "error-handling-correctness-only"],
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
      "@typescript-eslint/no-deprecated": "error",
    },
  },
);
