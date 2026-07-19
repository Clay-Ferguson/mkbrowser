#!/bin/bash

# Build script for MkBrowser Electron app
# This creates distributable packages for the application
#
# Remember to bump `version` in package.json when cutting a release, so the
# installed .deb identifies which build it is (dpkg -s mk-browser).

VERSION=$(node -p "require('./package.json').version")
echo "🔨 Building MkBrowser v$VERSION..."
echo ""

# Run the shared quality gate (tests, lint) and abort if anything fails.
# The React Compiler gates (compiler-coverage / bundle-fingerprint) run inside
# `npm run make` itself, as Forge prePackage/postPackage hooks (forge.config.ts).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/pre-package.sh"
if [ $? -ne 0 ]; then
  exit 1
fi

# Run the electron-forge make command to create distributables
# This will create a .deb package in the 'out' directory
npm run make
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ npm run make failed! Build aborted."
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

