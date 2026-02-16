#!/bin/bash

# Create a video from Playwright screenshots for user guide documentation
# Each screenshot is shown for a configurable duration
# Usage: ./create-video-from-screenshots.sh <subfolder-name>

set -e

# Validate argument
if [ $# -eq 0 ]; then
    echo "Error: Missing required argument"
    echo "Usage: $0 <subfolder-name>"
    echo "Example: $0 open-folder-demo"
    exit 1
fi

SUBFOLDER="$1"

# Check for empty string
if [ -z "$SUBFOLDER" ]; then
    echo "Error: Subfolder name cannot be empty"
    exit 1
fi

SCREENSHOT_DIR="screenshots/$SUBFOLDER"
OUTPUT_DIR="test-videos"
MP4_FILE="$OUTPUT_DIR/$SUBFOLDER.mp4"
GIF_FILE="$OUTPUT_DIR/$SUBFOLDER.gif"
PALETTE_FILE="$OUTPUT_DIR/$SUBFOLDER-palette.png"
FRAME_DURATION=2  # seconds per screenshot

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}=== Create Video from Screenshots ===${NC}"
echo ""

# Check if screenshots exist
if [ ! -d "$SCREENSHOT_DIR" ] || [ -z "$(ls -A $SCREENSHOT_DIR/*.png 2>/dev/null)" ]; then
    echo -e "${RED}✗ No screenshots found in $SCREENSHOT_DIR/${NC}"
    echo "Run a demo test with screenshots enabled first."
    echo "Example: npm run test:e2e -- open-folder-demo.spec.ts"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Delete previous files if they exist
rm -f "$MP4_FILE" "$GIF_FILE"

# Count screenshots
SCREENSHOT_COUNT=$(ls -1 $SCREENSHOT_DIR/*.png 2>/dev/null | wc -l)
echo "Found $SCREENSHOT_COUNT screenshots"
echo "Duration per frame: ${FRAME_DURATION}s"
echo "Total video length: $((SCREENSHOT_COUNT * FRAME_DURATION))s"
echo ""

# Create MP4 video with ffmpeg
# Each image is shown for FRAME_DURATION seconds
# -framerate 1/FRAME_DURATION means 1 frame every FRAME_DURATION seconds
echo "Creating MP4 video..."
ffmpeg -y \
    -framerate "1/$FRAME_DURATION" \
    -pattern_type glob \
    -i "$SCREENSHOT_DIR/*.png" \
    -c:v libx264 \
    -preset slow \
    -crf 18 \
    -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" \
    -movflags +faststart \
    "$MP4_FILE" \
    2>&1 | grep -E "(frame=|Duration:|Output|error)" || true

if [ ! -f "$MP4_FILE" ]; then
    echo -e "${RED}✗ Failed to create MP4 video${NC}"
    exit 1
fi

MP4_SIZE=$(du -h "$MP4_FILE" | cut -f1)
echo -e "${GREEN}✓ MP4 created successfully${NC} ($MP4_SIZE)"
echo ""

# Create GIF with palette for better quality
echo "Generating GIF palette..."
ffmpeg -y \
    -framerate "1/$FRAME_DURATION" \
    -pattern_type glob \
    -i "$SCREENSHOT_DIR/*.png" \
    -vf "palettegen" \
    "$PALETTE_FILE" \
    2>&1 | grep -E "(frame=|Duration:|Output|error)" || true

if [ ! -f "$PALETTE_FILE" ]; then
    echo -e "${RED}✗ Failed to generate palette${NC}"
    exit 1
fi

echo "Creating GIF..."
ffmpeg -y \
    -framerate "1/$FRAME_DURATION" \
    -pattern_type glob \
    -i "$SCREENSHOT_DIR/*.png" \
    -i "$PALETTE_FILE" \
    -lavfi "paletteuse" \
    "$GIF_FILE" \
    2>&1 | grep -E "(frame=|Duration:|Output|error)" || true

# Clean up palette file
rm -f "$PALETTE_FILE"

if [ ! -f "$GIF_FILE" ]; then
    echo -e "${RED}✗ Failed to create GIF${NC}"
    exit 1
fi

GIF_SIZE=$(du -h "$GIF_FILE" | cut -f1)
echo -e "${GREEN}✓ GIF created successfully${NC} ($GIF_SIZE)"
echo ""
echo -e "${GREEN}=== Both formats created successfully! ===${NC}"
echo "  MP4: $MP4_FILE ($MP4_SIZE)"
echo "  GIF: $GIF_FILE ($GIF_SIZE)"
echo "  Subfolder: $SUBFOLDER"
echo ""
echo "To view MP4: mpv $MP4_FILE"
echo "To view GIF: mpv $GIF_FILE"
