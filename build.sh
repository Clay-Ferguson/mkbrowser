#!/bin/bash

# Build script for MkBrowser Electron app
# This creates distributable packages for the application

echo "🔨 Building MkBrowser..."
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

# Prompt user to run install script
read -p "Would you like to run the install script now? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 Running install script..."
    ./install.sh
else
    echo "Skipping installation. You can run ./install.sh manually later."
fi
