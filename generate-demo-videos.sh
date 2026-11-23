#!/bin/bash

# Generate demo videos (via the sibling kocreator project) from the screenshots
# and narration files that the Playwright E2E tests leave in screenshots/<test>/.
# Assumes the tests have already been run (see playwright-test.sh). Presents a
# menu of the screenshot folders; pick one to build its video, or ALL.
# See: (docs/technical_notes/tests/screen_recording_videos.md)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Seconds to pause between videos when building ALL, so the CPU can cool down
COOLDOWN_SECONDS=90

# Generate the video (kocreator) for a single test from its screenshots/wavs
generate_video_for_test() {
    local test_name="$1"
    echo ""
    echo "Generating video for $test_name..."
    local kocreator_dir="$SCRIPT_DIR/../kocreator"
    if [ ! -f "$kocreator_dir/uv-env.sh" ]; then
        echo "kocreator not found at $kocreator_dir — skipping video generation."
        return 1
    fi
    if ! command -v uv >/dev/null 2>&1; then
        echo "uv not found in PATH (kocreator requires it) — skipping video generation."
        return 1
    fi
    # kocreator keeps a per-machine venv (.venv-<hostname>) so a host and a VM
    # sharing the folder don't break each other's interpreter symlinks.
    # Subshell so UV_PROJECT_ENVIRONMENT doesn't leak into the rest of this script.
    (
        source "$kocreator_dir/uv-env.sh"
        uv run --directory "$kocreator_dir" python "$kocreator_dir/create-video.py" "$SCRIPT_DIR" "$test_name" --no-intro
    )
}

# Open the generated test-videos folder in the file manager (Linux only)
open_videos_folder() {
    if [[ "$OSTYPE" == "linux-gnu"* ]] && [ -d "$SCRIPT_DIR/test-videos" ]; then
        xdg-open "$SCRIPT_DIR/test-videos"
    fi
}

# Every screenshots/ subfolder except intro/ (kocreator's intro asset, not a test)
if [ ! -d screenshots ]; then
    echo "No screenshots/ folder found. Run the Playwright tests first (./playwright-test.sh)."
    exit 1
fi
FOLDERS=()
for dir in screenshots/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    [ "$name" = "intro" ] && continue
    FOLDERS+=("$name")
done
if [ ${#FOLDERS[@]} -eq 0 ]; then
    echo "No video folders found under screenshots/. Run the Playwright tests first (./playwright-test.sh)."
    exit 1
fi

ALL_CHOICE=$(( ${#FOLDERS[@]} + 1 ))

echo ""
echo "Available demo video folders:"
for i in "${!FOLDERS[@]}"; do
    echo "$((i+1))) ${FOLDERS[$i]}"
done
echo "$ALL_CHOICE) ALL"
echo ""
read -p "Enter choice [1-$ALL_CHOICE]: " choice

if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "$ALL_CHOICE" ]; then
    echo "Invalid selection."
    exit 1
fi

if [ "$choice" -eq "$ALL_CHOICE" ]; then
    SELECTED=("${FOLDERS[@]}")
else
    SELECTED=("${FOLDERS[$((choice-1))]}")
fi

FAILED=()
for i in "${!SELECTED[@]}"; do
    if [ "$i" -gt 0 ]; then
        echo ""
        echo "CPU Cooldown ${COOLDOWN_SECONDS}s..."
        sleep "$COOLDOWN_SECONDS"
    fi
    generate_video_for_test "${SELECTED[$i]}" || FAILED+=("${SELECTED[$i]}")
done

echo ""
if [ ${#FAILED[@]} -eq 0 ]; then
    echo "✓ Generated ${#SELECTED[@]} video(s)."
else
    echo "✗ ${#FAILED[@]} of ${#SELECTED[@]} video(s) failed: ${FAILED[*]}"
fi

open_videos_folder

[ ${#FAILED[@]} -eq 0 ]
