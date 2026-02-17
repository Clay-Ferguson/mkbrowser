#!/bin/bash

# Run Playwright E2E tests and show report
# This script runs the tests, then automatically opens the HTML report in the browser

echo "Cleanup to force build..."
rm -rf .vite
rm -rf out

# Prompt user to choose test scope
echo ""
echo "Select test scope:"
echo "1) Run all tests"
echo "2) Run specific test (create-file-demo.spec.ts)"
echo ""
read -p "Enter choice [1-2]: " choice

SPECIFIC_TEST=""

case $choice in
    1)
        echo "Running all Playwright E2E tests..."
        npm run test:e2e
        ;;
    2)
        SPECIFIC_TEST="create-file-demo"
        echo "Cleaning up screenshots for $SPECIFIC_TEST..."
        rm -rf screenshots/$SPECIFIC_TEST
        echo "Running specific test: $SPECIFIC_TEST.spec.ts..."
        npx playwright test tests/e2e/$SPECIFIC_TEST.spec.ts
        ;;
    *)
        echo "Invalid choice. Running all tests..."
        npm run test:e2e
        ;;
esac

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

# Offer to generate video if a specific test was run
if [ -n "$SPECIFIC_TEST" ]; then
    echo ""
    read -p "Generate video from screenshots? [y/N]: " generate_video
    if [[ "$generate_video" =~ ^[Yy]$ ]]; then
        echo ""
        echo "Generating video for $SPECIFIC_TEST..."
        ./create-video-from-screenshots.sh "$SPECIFIC_TEST"
        echo ""
    fi
fi

# Kill any existing playwright report server
pkill -f "playwright show-report" 2>/dev/null
sleep 1

npx playwright show-report
