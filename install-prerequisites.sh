#!/bin/bash

# install-prerequisites.sh
# Installs system dependencies on a fresh Ubuntu system
# This prepares the system to build and run MkBrowser
# NOTE: Node.js (with npm) is installed separately via install-node.sh

set -e  # Exit on any error

echo "🚀 MkBrowser Prerequisites Installer"
echo "===================================="
echo ""
echo "This script will install:"
echo "  • ffmpeg (video encoding for test captures)"
echo "  • xdotool (window manipulation for test automation)"
echo "  • exiftool (reading/writing image EXIF metadata)"
echo ""
echo "Note: For Node.js and npm, run install-node.sh instead."
echo ""

# Check if running on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "❌ Error: This script is designed for Linux systems only."
    exit 1
fi

# Check for Ubuntu/Debian
if ! command -v apt-get &> /dev/null; then
    echo "⚠️  Warning: This script is optimized for Ubuntu/Debian systems."
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Function to check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Function to get version
get_version() {
    if command_exists "$1"; then
        "$1" --version 2>/dev/null | head -n 1
    else
        echo "not installed"
    fi
}

echo "📋 Current status:"
echo "  ffmpeg:   $(get_version ffmpeg)"
echo "  xdotool:  $(get_version xdotool)"
echo "  exiftool: $(get_version exiftool)"
echo ""

# Ask if user wants to proceed
read -p "Would you like to proceed with installation? (Y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo "Installation cancelled."
    exit 0
fi

echo ""
echo "🔄 Updating package lists..."
sudo apt-get update

echo ""
echo "📦 Installing system prerequisites..."
echo "  • Build tools (curl, ca-certificates, gnupg)"
echo "  • Test automation tools (ffmpeg, xdotool)"
echo "  • ExifTool (libimage-exiftool-perl)"
# MkBrowser runs the system `exiftool` from the PATH to write image metadata — it
# does not ship the perl distribution vendored in exiftool-vendored (see the comment
# in src/main/exifUtil.ts). Without it, only EXIF saving fails; the app still runs.
sudo apt-get install -y curl ca-certificates gnupg ffmpeg xdotool libimage-exiftool-perl

# Final status
echo ""
echo "🎉 All prerequisites installed successfully!"
echo ""
echo "📋 Final versions:"
echo "  ffmpeg:   $(ffmpeg -version | head -n 1)"
echo "  xdotool:  $(xdotool --version 2>&1 | head -n 1)"
echo "  exiftool: $(exiftool -ver 2>&1 | head -n 1)"
echo ""
echo "✨ Next steps:"
echo "  1. Run './install-node.sh' to install Node.js (includes npm)"
echo "  2. Run 'npm install' to install project dependencies"
echo "  3. Run 'npm run start:linux' to start the development server"
echo "  4. Run './build.sh' to create a distributable package and install it"
echo "  5. Run tests: npm run test:e2e"
echo "  6. Create user guide videos: npm run test:e2e -- create-file-demo.spec.ts && ../kocreator/create-video.sh \"\$PWD\" create-file-demo"
echo ""
