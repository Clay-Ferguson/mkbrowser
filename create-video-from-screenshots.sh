#!/bin/bash

# Create a video from Playwright screenshots for user guide documentation
# Each screenshot is shown for a configurable duration

set -e

SCREENSHOT_DIR="screenshots"
OUTPUT_DIR="test-videos"
OUTPUT_FILE="$OUTPUT_DIR/user-guide-$(date +%Y%m%d-%H%M%S).mp4"
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
    echo "Run the demo test first: npm run test:e2e -- open-folder-demo.spec.ts"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Count screenshots
SCREENSHOT_COUNT=$(ls -1 $SCREENSHOT_DIR/*.png 2>/dev/null | wc -l)
echo "Found $SCREENSHOT_COUNT screenshots"
echo "Duration per frame: ${FRAME_DURATION}s"
echo "Total video length: $((SCREENSHOT_COUNT * FRAME_DURATION))s"
echo ""

# Create video with ffmpeg
# Each image is shown for FRAME_DURATION seconds
# -framerate 1/FRAME_DURATION means 1 frame every FRAME_DURATION seconds
echo "Creating video..."
ffmpeg -y \
    -framerate "1/$FRAME_DURATION" \
    -pattern_type glob \
    -i "$SCREENSHOT_DIR/*.png" \
    -c:v libx264 \
    -preset slow \
    -crf 18 \
    -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" \
    -movflags +faststart \
    "$OUTPUT_FILE" \
    2>&1 | grep -E "(frame=|Duration:|Output|error)" || true

if [ -f "$OUTPUT_FILE" ]; then
    SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
    echo ""
    echo -e "${GREEN}✓ Video created successfully!${NC}"
    echo "  File: $OUTPUT_FILE"
    echo "  Size: $SIZE"
    echo ""
    echo "To view: mpv $OUTPUT_FILE"
else
    echo -e "${RED}✗ Failed to create video${NC}"
    exit 1
fi
