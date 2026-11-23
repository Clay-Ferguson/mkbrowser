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

# List the spec files covered by "run all": every tests/e2e/*.spec.ts, skipping
# the ones prefixed with `private-` unless the first argument is "include-private".
all_test_files() {
    local include_private="$1"
    local file
    for file in tests/e2e/*.spec.ts; do
        [ -e "$file" ] || continue
        if [ "$include_private" != "include-private" ]; then
            case "$(basename "$file")" in
                private-*) continue ;;
            esac
        fi
        echo "$file"
    done
}

# Clean up and run every E2E test (private-* only when passed "include-private")
run_all_tests() {
    local include_private="$1"
    local file
    mapfile -t ALL_TEST_FILES < <(all_test_files "$include_private")
    if [ ${#ALL_TEST_FILES[@]} -eq 0 ]; then
        echo "No E2E tests found. Exiting."
        exit 1
    fi
    for file in "${ALL_TEST_FILES[@]}"; do
        cleanup_test_artifacts "$(basename "$file" .spec.ts)"
    done
    if [ "$include_private" = "include-private" ]; then
        echo "Running all Playwright E2E tests (including private-* tests)..."
    else
        echo "Running all Playwright E2E tests (skipping private-* tests)..."
    fi
    npx playwright test "${ALL_TEST_FILES[@]}"
}

# Remove previously generated screenshots/wavs for a single test
cleanup_test_artifacts() {
    local test_name="$1"
    echo "Cleaning up screenshots for $test_name..."
    rm -f screenshots/$test_name/*.png
    rm -f screenshots/$test_name/*.txt
    rm -rf screenshots/$test_name/generated-wav
}

# Optionally build the app so the Playwright fixture loads the latest code
read -p "Build app before running tests? [Y/n]: " do_build
if [[ ! "$do_build" =~ ^[Nn]$ ]]; then
    # Run the same quality gate (tests, lint) that build.sh runs. The React
    # Compiler gates (compiler-coverage / bundle-fingerprint) run inside
    # `npm run package` itself, as Forge hooks (forge.config.ts).
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    "$SCRIPT_DIR/pre-package.sh"
    if [ $? -ne 0 ]; then
        echo "Pre-package checks failed. Exiting."
        exit 1
    fi

    echo "Building app with electron-forge..."
    npm run package
    if [ $? -ne 0 ]; then
        echo "Build failed. Exiting."
        exit 1
    fi
    echo ""
else
    echo "Skipping build, using existing build output."
    echo ""
fi

# Prompt user to choose test scope
echo ""
echo "Select test scope:"
echo "1) Run all tests (except private ones)"
echo "2) Run all tests (including private ones)"
echo "3) Run specific test"
echo ""
read -p "Enter choice [1-3]: " choice

# Options 1 and 2 both "run all"; option 2 also includes the private-* tests
INCLUDE_PRIVATE=""
if [ "$choice" = "2" ]; then
    INCLUDE_PRIVATE="include-private"
fi


case $choice in
    1|2)
        run_all_tests "$INCLUDE_PRIVATE"
        ;;
    3)
        SPECIFIC_TEST=$(select_specific_test)
        if [ $? -ne 0 ] || [ -z "$SPECIFIC_TEST" ]; then
            echo "Invalid test selection. Exiting."
            exit 1
        fi
        cleanup_test_artifacts "$SPECIFIC_TEST"
        echo "Running specific test: $SPECIFIC_TEST.spec.ts..."
        npx playwright test tests/e2e/$SPECIFIC_TEST.spec.ts
        ;;
    *)
        echo "Invalid choice."
        exit 1
        ;;
esac

# Capture the exit code
TEST_EXIT_CODE=$?

echo ""
echo "Tests completed with exit code: $TEST_EXIT_CODE"
echo ""

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo "✓ All tests passed!"
else
    echo "✗ Some tests failed."
fi

echo ""
echo "To build demo videos from these screenshots, run ./generate-demo-videos.sh"
echo ""

read -p "Open HTML report? [Y/n]: " show_report
if [[ ! "$show_report" =~ ^[Nn]$ ]]; then
    # Kill any existing playwright report server
    pkill -f "playwright show-report" 2>/dev/null
    sleep 1

    npx playwright show-report
fi
