#!/bin/bash

# PDF Generation Script for MkBrowser
# Converts a markdown file to PDF using Pandoc
# Uses XeLaTeX for full Unicode support
#
# Usage: generate-pdf.sh <input.md> <output.pdf>

# Keep the terminal open on error so the user can read the message
_on_exit() {
  local code=$?
  if [ $code -ne 0 ]; then
    echo ""
    echo "Script exited with error (code $code)."
    echo "Press Enter to close this terminal..."
    read
  fi
}
trap _on_exit EXIT

# Check arguments
if [ "$#" -lt 2 ]; then
    echo "Usage: $0 <input.md> <output.pdf> [glossary.md]"
    echo "Example: $0 /path/to/document.md /path/to/output.pdf"
    echo "         $0 /path/to/document.md /path/to/output.pdf /path/to/Glossary_of_Terms.md"
    exit 1
fi

INPUT_FILE="$1"
OUTPUT_FILE="$2"
GLOSSARY_FILE="${3:-}"  # Optional third argument: full path to Glossary_of_Terms.md

# Check if input file exists
if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: Input file not found: $INPUT_FILE"
    exit 1
fi

echo "========================================"
echo "MkBrowser PDF Export"
echo "========================================"
echo "Input:  $INPUT_FILE"
echo "Output: $OUTPUT_FILE"
if [ -n "$GLOSSARY_FILE" ]; then
    echo "Glossary: $GLOSSARY_FILE"
    export GLOSSARY_PATH="$GLOSSARY_FILE"
fi
echo "======================================="
echo ""

# Check if pandoc is installed
if ! command -v pandoc &> /dev/null; then
    echo "Pandoc is not installed on this system."
    read -p "Would you like to install Pandoc now? (y/n): " response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        echo "Installing Pandoc and required LaTeX packages..."
        sudo apt update
        sudo apt install -y pandoc texlive-latex-recommended texlive-pictures texlive-latex-extra texlive-xetex
        if [ $? -ne 0 ]; then
            echo "Error: Failed to install Pandoc. Please check your internet connection and try again."
            exit 1
        fi
        echo "Pandoc installed successfully!"
    else
        echo "Pandoc is required to generate the PDF. Exiting."
        exit 1
    fi
fi

# Check if xelatex is installed
if ! command -v xelatex &> /dev/null; then
    echo "XeLaTeX is not installed on this system."
    read -p "Would you like to install XeLaTeX now? (y/n): " response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        echo "Installing XeLaTeX..."
        sudo apt update
        sudo apt install -y texlive-xetex
        
        if [ $? -ne 0 ]; then
            echo "Error: Failed to install XeLaTeX. Please check your internet connection and try again."
            exit 1
        fi
        echo "XeLaTeX installed successfully!"
    else
        echo "XeLaTeX is required to generate the PDF with Unicode support. Exiting."
        exit 1
    fi
fi

# Check if mermaid-filter is installed (for Mermaid diagram support)
if ! command -v mermaid-filter &> /dev/null; then
    echo "mermaid-filter is not installed on this system."
    echo "This is required to render Mermaid diagrams in the PDF."
    read -p "Would you like to install mermaid-filter now? (y/n): " response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        # Check if npm is installed first
        if ! command -v npm &> /dev/null; then
            echo "npm is not installed. Installing npm first..."
            sudo apt update
            sudo apt install -y npm
            
            if [ $? -ne 0 ]; then
                echo "Error: Failed to install npm. Please check your internet connection and try again."
                exit 1
            fi
            echo "npm installed successfully!"
        fi
        
        echo "Installing mermaid-filter..."
        # Only use sudo when npm's global install dir isn't writable by us.
        # With nvm (or a user-level npm prefix) it lives under $HOME, so no sudo
        # is needed -- and sudo would break it anyway: sudo resets PATH to its
        # secure_path, so it can't find an nvm-installed npm/node at all.
        NPM_BIN="$(command -v npm)"
        NPM_PREFIX="$(npm prefix --global 2>/dev/null)"
        NPM_GLOBAL_DIR="$NPM_PREFIX/lib/node_modules"
        [ -d "$NPM_GLOBAL_DIR" ] || NPM_GLOBAL_DIR="$NPM_PREFIX"
        if [ -n "$NPM_PREFIX" ] && [ -w "$NPM_GLOBAL_DIR" ]; then
            "$NPM_BIN" install --global mermaid-filter
        else
            # Preserve our PATH so root resolves the same npm and node we do
            sudo env "PATH=$PATH" "$NPM_BIN" install --global mermaid-filter
        fi

        if [ $? -ne 0 ]; then
            echo "Error: Failed to install mermaid-filter."
            echo "You may need to install Chromium: sudo apt install chromium-browser"
            exit 1
        fi
        hash -r
        if ! command -v mermaid-filter &> /dev/null; then
            echo "Warning: mermaid-filter was installed but is not on PATH ($NPM_PREFIX/bin)."
            echo "Continuing without Mermaid support..."
        else
            echo "mermaid-filter installed successfully!"
        fi
    else
        echo "Warning: Mermaid diagrams will not render without mermaid-filter."
        echo "Continuing without Mermaid support..."
    fi
fi

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Build the pandoc command with optional mermaid filter
PANDOC_CMD="pandoc \"$INPUT_FILE\" -o \"$OUTPUT_FILE\" --pdf-engine=xelatex --metadata-file=\"$SCRIPT_DIR/pdf-settings.yaml\""

# Add glossary filter (Lua filter for {Term} -> link replacement)
if [ -f "$SCRIPT_DIR/glossary-filter.lua" ]; then
    PANDOC_CMD="$PANDOC_CMD -L \"$SCRIPT_DIR/glossary-filter.lua\""
    if [ -n "$GLOSSARY_FILE" ]; then
        echo "Glossary filter enabled - using glossary: $GLOSSARY_FILE"
    else
        echo "Glossary filter detected - {Term} patterns will be linked (no glossary file provided)."
    fi
fi

# Add mermaid filter if available (must come BEFORE pandoc-crossref)
if command -v mermaid-filter &> /dev/null; then
    PANDOC_CMD="$PANDOC_CMD -F mermaid-filter"
    echo "Mermaid filter detected - diagrams will be rendered."
fi

# Generate the PDF
echo ""
echo "Generating PDF..."
echo ""
eval $PANDOC_CMD

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================"
    echo "Success! PDF generated:"
    echo "$OUTPUT_FILE"
    echo "========================================"
    setsid xdg-open "$OUTPUT_FILE" > /dev/null 2>&1 &
else
    echo ""
    echo "========================================"
    echo "Error: Failed to generate PDF."
    echo "========================================"
    exit 1
fi

echo ""
echo "Terminal will close in 10 seconds. Press ENTER to keep open..."
# Wait up to 5 seconds for the user to press ENTER. If they do, the terminal
# stays open (so they can inspect output); otherwise it closes automatically,
# which keeps automated tests from hanging.
if read -t 10; then
    echo ""
    echo "Press Enter to close this terminal..."
    read
fi
