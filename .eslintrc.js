module.exports = {
  env: {
    browser: true,
    es6: true,
    node: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  plugins: ["react-hooks"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/recommended",
    "plugin:import/electron",
    "plugin:import/typescript",
  ],
  // Directories to skip entirely during linting.
  ignorePatterns: [".vite/", "out/", "dist/", "node_modules/"],

  rules: {
    // ─── Type Safety ──────────────────────────────────────────────────────────

    // Disallow the `any` type. "warn" allows it with a warning; "error" prohibits it; "off" permits freely.
    "@typescript-eslint/no-explicit-any": "warn",

    // Require explicit return type annotations on all functions and methods.
    "@typescript-eslint/explicit-function-return-type": "off",

    // Require explicit return types on exported functions/methods only.
    "@typescript-eslint/explicit-module-boundary-types": "off",

    // Disallow the non-null assertion operator (!). "error" to ban it outright.
    "@typescript-eslint/no-non-null-assertion": "warn",

    // The four rules below require type-checked linting. To enable them, add
    // parserOptions.project = "./tsconfig.json" above, then set to "error" or "warn".
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-return": "off",

    // Disallow async functions whose returned Promise is never awaited or handled.
    // Requires type-checked linting, so it is enabled as "error" for src/** in
    // the overrides block below (root configs and tests/ are outside tsconfig).
    "@typescript-eslint/no-floating-promises": "off",

    // Disallow await on non-Promise values. Requires type-checked linting.
    "@typescript-eslint/await-thenable": "off",

    // ─── Code Quality ─────────────────────────────────────────────────────────

    // Warn/error on console.log/warn/error calls. Common to set "warn" during development,
    // "error" before shipping, or "off" for Electron apps that rely on console output.
    "no-console": "warn",

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
    "@typescript-eslint/no-empty-interface": "warn",

    // ─── Import Rules ─────────────────────────────────────────────────────────

    // Enforce a consistent import ordering: built-ins → external → internal → relative.
    // Set to "off" to disable ordering enforcement entirely.
    "import/order": [
      "warn",
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

    // Subpath exports from some packages (e.g. @langchain/langgraph/prebuilt) are not
    // resolved by eslint-import-resolver-node; ignore them to avoid false positives.
    "import/no-unresolved": ["error", { "ignore": ["@langchain/langgraph/.*"] }],

    // Disallow importing the same module more than once in a file.
    "import/no-duplicates": "error",

    // Detect circular import dependencies. Expensive on large codebases; enable selectively.
    "import/no-cycle": "off",

    // ─── Style & Syntax Preferences ───────────────────────────────────────────

    // Require `const` for variables that are never reassigned.
    "prefer-const": "error",

    // Require === and !== instead of == and !=.
    "eqeqeq": ["error", "always"],

    // Prefer `??` (nullish coalescing) over `||` when testing for null/undefined.
    "@typescript-eslint/prefer-nullish-coalescing": "off",

    // Prefer optional chaining `a?.b` over `a && a.b`. Requires typed linting.
    "@typescript-eslint/prefer-optional-chain": "off",

    // Require curly braces around all if/else/for/while blocks.
    "curly": "off",

    // Enforce `import type` for type-only imports (keeps runtime bundle clean).
    "@typescript-eslint/consistent-type-imports": "off",
  },

  overrides: [
    // Type-checked rules need parserOptions.project, which only covers files in
    // tsconfig.json's include (src/**). Root-level configs (forge.config.ts,
    // vite.*.config.ts) and tests/ would fail to parse with it, so the typed
    // rules are scoped here instead of being enabled globally.
    {
      files: ["src/**/*.ts", "src/**/*.tsx"],
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
      rules: {
        "@typescript-eslint/no-floating-promises": "error",

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

        // The remaining v7 recommended rules (React-19 / React-Compiler era checks)
        // are introduced as warnings so they surface in lint output without failing
        // `prebuild`. Promote individual rules to "error" once their findings are
        // addressed. Current hit counts noted where non-trivial.
        "react-hooks/set-state-in-effect": "error",        // ~7 hits — setState inside an effect (extra render passes)
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
      },
    },
  ],
};
