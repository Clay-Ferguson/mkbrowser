#!/bin/bash

# Build script for MkBrowser Electron app
# This creates distributable packages for the application

echo "🔨 Building MkBrowser..."
echo ""

# Run tests first and abort if any fail
echo "🧪 Running tests..."
echo ""
yarn test
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Tests failed! Build aborted."
  echo "   Fix the failing tests and try again."
  exit 1
fi
echo ""
echo "✅ All tests passed!"
echo ""

# Run the electron-forge make command to create distributables
# This will create .deb and .rpm packages in the 'out' directory
yarn make

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

