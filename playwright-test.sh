#!/bin/bash

# Run Playwright E2E tests and show report
# This script runs the tests, then automatically opens the HTML report in the browser

# Function to select a specific test from available E2E tests
select_specific_test() {
    local test_files=(tests/e2e/*.spec.ts)
    local test_names=()
    
    # Extract test names without path and extension
    for file in "${test_files[@]}"; do
        local basename=$(basename "$file" .spec.ts)
        test_names+=("$basename")
    done
    
    # Display menu (redirect to stderr so it's visible to user)
    echo "" >&2
    echo "Available E2E tests:" >&2
    for i in "${!test_names[@]}"; do
        echo "$((i+1))) ${test_names[$i]}" >&2
    done
    echo "" >&2
    
    # Get user selection
    read -p "Enter test number [1-${#test_names[@]}]: " test_choice
    
    # Validate and return selection (only this goes to stdout for capture)
    if [[ "$test_choice" =~ ^[0-9]+$ ]] && [ "$test_choice" -ge 1 ] && [ "$test_choice" -le "${#test_names[@]}" ]; then
        echo "${test_names[$((test_choice-1))]}"
    else
        echo "" >&2
        return 1
    fi
}

# Build the app first so the Playwright fixture loads the latest code
echo "Building app with electron-forge..."
npm run build
if [ $? -ne 0 ]; then
    echo "Build failed. Exiting."
    exit 1
fi
echo ""

# Prompt user to choose test scope
echo ""
echo "Select test scope:"
echo "1) Run all tests"
echo "2) Run specific test"
echo ""
read -p "Enter choice [1-2]: " choice

SPECIFIC_TEST=""

case $choice in
    1)
        echo "Running all Playwright E2E tests..."
        npm run test:e2e
        ;;
    2)
        SPECIFIC_TEST=$(select_specific_test)
        if [ $? -ne 0 ] || [ -z "$SPECIFIC_TEST" ]; then
            echo "Invalid test selection. Exiting."
            exit 1
        fi
        echo "Cleaning up screenshots for $SPECIFIC_TEST..."
        rm -f screenshots/$SPECIFIC_TEST/*
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
        CURRENT_FOLDER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        KOCREATOR_DIR="$CURRENT_FOLDER/../kocreator"
        source "$KOCREATOR_DIR/.venv/bin/activate"
        python "$KOCREATOR_DIR/create-video.py" "$CURRENT_FOLDER" "$SPECIFIC_TEST"
        deactivate
        echo ""
        # open nautilus at the test-videos
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            xdg-open "$CURRENT_FOLDER/test-videos"
        fi
    fi
fi

read -p "Open HTML report? [Y/n]: " show_report
if [[ ! "$show_report" =~ ^[Nn]$ ]]; then
    # Kill any existing playwright report server
    pkill -f "playwright show-report" 2>/dev/null
    sleep 1

    npx playwright show-report
fi
