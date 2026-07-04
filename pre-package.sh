#!/bin/bash

# Pre-package checks for MkBrowser
# Runs the full quality gate — unit tests, linter, and React Compiler coverage —
# that must pass before the app is packaged. Shared by both build.sh (which then
# runs `yarn make`) and playwright-test.sh (which then runs `yarn package`), so
# every packaged build goes through the same checks.
#
# Exits non-zero on the first failed gate; callers should check $? and abort.

# Run tests first and abort if any fail
echo "🧪 Running tests..."
echo ""
yarn test
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Tests failed! Build aborted."
  echo "   Fix the failing tests and try again."
  exit 1
fi
echo ""
echo "✅ All tests passed!"
echo ""

# Run the linter and abort if it fails
echo "🔍 Running linter..."
echo ""
yarn lint
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Lint failed! Build aborted."
  echo "   Fix the lint errors and try again."
  exit 1
fi
echo ""
echo "✅ Lint passed!"
echo ""

# Verify every component/hook compiles under the React Compiler, aborting on any
# bailout. A bailed-out component is silently de-memoized at build time — a real
# perf regression here, since the codebase has no manual useCallback/useMemo left.
# This uses the exact compiler version the renderer build uses, catching bailouts
# the react-hooks ESLint rules can't see (see the compiler-coverage.mjs header).
echo "⚛️  Checking React Compiler coverage..."
echo ""
node compiler-coverage.mjs
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ React Compiler bailout(s) found! Build aborted."
  echo "   Fix the constructs listed above (see REACT_COMPILER_PLAN.md for patterns)."
  exit 1
fi
echo ""
echo "✅ React Compiler coverage clean!"
echo ""
