#!/bin/bash

# Pre-package checks for MkBrowser
# Runs the unit tests and the linter before the app is packaged. Shared by both
# build.sh (which then runs `npm run make`) and playwright-test.sh (which then
# runs `npm run package`), so every packaged build goes through the same checks.
#
# The two React Compiler gates (compiler-coverage.mjs / bundle-fingerprint.mjs)
# are NOT here: they run as prePackage/postPackage hooks in forge.config.ts, so
# every `npm run package` / `npm run make` runs them even without this script.
#
# Exits non-zero on the first failed gate; callers should check $? and abort.

# Run tests first and abort if any fail
echo "🧪 Running tests..."
echo ""
npm test
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
npm run lint
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Lint failed! Build aborted."
  echo "   Fix the lint errors and try again."
  exit 1
fi
echo ""
echo "✅ Lint passed!"
echo ""
