#!/bin/bash

# Build script for MkBrowser Electron app
# This creates distributable packages for the application

echo "🔨 Building MkBrowser..."
echo ""

# Run the shared quality gate (tests, lint, React Compiler coverage) and abort
# if anything fails.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/pre-package.sh"
if [ $? -ne 0 ]; then
  exit 1
fi

# Run the electron-forge make command to create distributables
# This will create .deb and .rpm packages in the 'out' directory
npm run make
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ npm run make failed! Build aborted."
  exit 1
fi

# Post-package gate: verify the React Compiler's output actually shipped in the
# renderer bundle. pre-package.sh's compiler-coverage check runs the compiler
# standalone, so only this check against the built bundle can catch the compiler
# being configured out of the Vite pipeline (see bundle-fingerprint.mjs).
echo ""
echo "🔎 Checking React Compiler output in the built bundle..."
node bundle-fingerprint.mjs
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Bundle fingerprint check failed! The renderer was built de-memoized."
  echo "   Check the compiler wiring in vite.renderer.config.mts."
  exit 1
fi

echo ""
echo "✅ Build complete!"
echo ""
echo "📦 Your distributable packages can be found in:"
echo "   ./out/make/"
echo ""
echo "For Ubuntu, look for the .deb file which you can install with:"
echo "   sudo dpkg -i ./out/make/deb/x64/*.deb"
echo "-- or -- run the install script: ./install.sh"
echo ""

# Install script for MkBrowser Electron app
# This installs the .deb package created by build.sh

echo "📦 Installing MkBrowser..."
echo ""

# Look for the .deb file in the expected location
DEB_FILE=$(find ./out/make/deb/x64/ -name "*.deb" 2>/dev/null | head -n 1)

if [ -z "$DEB_FILE" ]; then
    echo "❌ Error: No .deb file found!"
    echo ""
    echo "Please run ./build.sh first to create the distributable package."
    exit 1
fi

echo "Found: $DEB_FILE"
echo ""
echo "Installing (this requires sudo privileges)..."
echo ""

sudo dpkg -i "$DEB_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Installation complete!"
    echo ""
    echo "You can now run MkBrowser from your application menu or by typing:"
    echo "   mk-browser"
else
    echo ""
    echo "❌ Installation failed!"
    echo ""
    echo "If you see dependency errors, try running:"
    echo "   sudo apt-get install -f"
    exit 1
fi

