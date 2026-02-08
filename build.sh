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

echo "🚀 Running install script..."
./install.sh
