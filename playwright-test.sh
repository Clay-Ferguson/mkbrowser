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

# Remove previously generated screenshots/wavs for a single test
cleanup_test_artifacts() {
    local test_name="$1"
    echo "Cleaning up screenshots for $test_name..."
    rm -f screenshots/$test_name/*.png
    rm -f screenshots/$test_name/*.txt
    rm -rf screenshots/$test_name/generated-wav
}

# Generate the video (kocreator) for a single test from its screenshots/wavs
generate_video_for_test() {
    local test_name="$1"
    echo ""
    echo "Generating video for $test_name..."
    local current_folder="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local kocreator_dir="$current_folder/../kocreator"
    source "$kocreator_dir/.venv/bin/activate"
    python "$kocreator_dir/create-video.py" "$current_folder" "$test_name"
    deactivate
    echo ""
    echo "CPU Cooldown 90s..."
    sleep 90
}

# Open the generated test-videos folder in the file manager (Linux only)
open_videos_folder() {
    local current_folder="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        xdg-open "$current_folder/test-videos"
    fi
}

# Optionally build the app so the Playwright fixture loads the latest code
read -p "Build app before running tests? [Y/n]: " do_build
if [[ ! "$do_build" =~ ^[Nn]$ ]]; then
    echo "Building app with electron-forge..."
    # todo-0: Need to be calling ./build.sh here, for a more robust set of linting.
    yarn package
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
echo "1) Run all tests"
echo "2) Run specific test"
echo "3) Build Video from Existing Images/Wavs"
echo ""
read -p "Enter choice [1-3]: " choice

SPECIFIC_TEST=""
GENERATE_VIDEO=""

# For "run all" and "run specific", ask up front whether to also generate
# video(s) so the user can start the run and walk away.
if [ "$choice" = "1" ] || [ "$choice" = "2" ]; then
    echo ""
    read -p "Generate video(s) after running the test(s)? [y/N]: " gen_choice
    if [[ "$gen_choice" =~ ^[Yy]$ ]]; then
        GENERATE_VIDEO="yes"
    fi
fi

case $choice in
    1)
        for file in tests/e2e/*.spec.ts; do
            cleanup_test_artifacts "$(basename "$file" .spec.ts)"
        done
        echo "Running all Playwright E2E tests..."
        yarn test:e2e
        ;;
    2)
        SPECIFIC_TEST=$(select_specific_test)
        if [ $? -ne 0 ] || [ -z "$SPECIFIC_TEST" ]; then
            echo "Invalid test selection. Exiting."
            exit 1
        fi
        cleanup_test_artifacts "$SPECIFIC_TEST"
        echo "Running specific test: $SPECIFIC_TEST.spec.ts..."
        yarn playwright test tests/e2e/$SPECIFIC_TEST.spec.ts
        ;;
    3) 
        SPECIFIC_TEST=$(select_specific_test)
        if [ $? -ne 0 ] || [ -z "$SPECIFIC_TEST" ]; then
            echo "Invalid test selection. Exiting."
            exit 1
        fi
        echo "Selected $SPECIFIC_TEST. Skipping actual test run."
        ;;
    *)
        echo "Invalid choice. Running all tests..."
        yarn test:e2e
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

# Generate video(s) based on the choice and the up-front prompt
if [ "$choice" = "1" ] && [ -n "$GENERATE_VIDEO" ]; then
    # Generate a video for every E2E test that just ran
    for file in tests/e2e/*.spec.ts; do
        test_name=$(basename "$file" .spec.ts)
        generate_video_for_test "$test_name"
    done
    open_videos_folder
elif [ "$choice" = "2" ] && [ -n "$GENERATE_VIDEO" ] && [ -n "$SPECIFIC_TEST" ]; then
    generate_video_for_test "$SPECIFIC_TEST"
    open_videos_folder
elif [ "$choice" = "3" ] && [ -n "$SPECIFIC_TEST" ]; then
    # Option 3 exists specifically to build a video from existing images/wavs
    echo ""
    read -p "Generate video from screenshots? [y/N]: " generate_video
    if [[ "$generate_video" =~ ^[Yy]$ ]]; then
        generate_video_for_test "$SPECIFIC_TEST"
        open_videos_folder
    fi
fi

read -p "Open HTML report? [Y/n]: " show_report
if [[ ! "$show_report" =~ ^[Nn]$ ]]; then
    # Kill any existing playwright report server
    pkill -f "playwright show-report" 2>/dev/null
    sleep 1

    yarn playwright show-report
fi
