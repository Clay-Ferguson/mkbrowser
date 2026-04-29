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
    // Also requires type-checked linting (parserOptions.project).
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
    "@typescript-eslint/no-unused-vars": [
      "error",
      { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" },
    ],

    // Disallow `var`; require `const` or `let` instead.
    "no-var": "error",

    // Disallow empty function bodies. "off" to permit no-op callbacks freely.
    "@typescript-eslint/no-empty-function": "warn",

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
};
