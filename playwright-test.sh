#!/bin/bash

# Run Playwright E2E tests and show report
# This script runs the tests, then automatically opens the HTML report in the browser

echo "Cleanup to force build..."
rm -rf .vite
rm -rf out

echo "Running Playwright E2E tests..."
npm run test:e2e

# Capture the exit code
TEST_EXIT_CODE=$?

echo ""
echo "Tests completed with exit code: $TEST_EXIT_CODE"
echo ""

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo "✓ All tests passed! Opening HTML report..."
else
    echo "✗ Some tests failed. Opening HTML report for details..."
fi

echo ""

# Kill any existing playwright report server
pkill -f "playwright show-report" 2>/dev/null
sleep 1

npx playwright show-report
