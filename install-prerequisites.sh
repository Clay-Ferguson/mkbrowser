#!/bin/bash

# install-prerequisites.sh
# Installs Node.js, NPM, and Yarn on a fresh Ubuntu system
# This prepares the system to build and run MkBrowser

set -e  # Exit on any error

echo "🚀 MkBrowser Prerequisites Installer"
echo "===================================="
echo ""
echo "This script will install:"
echo "  • Node.js (latest LTS)"
echo "  • NPM (bundled with Node.js)"
echo "  • Yarn (package manager)"
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
echo "  Node.js: $(get_version node)"
echo "  NPM:     $(get_version npm)"
echo "  Yarn:    $(get_version yarn)"
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
echo "📦 Installing prerequisites (curl, ca-certificates, gnupg)..."
sudo apt-get install -y curl ca-certificates gnupg

# Install Node.js using NodeSource
echo ""
echo "📥 Installing Node.js LTS via NodeSource..."

# Create directory for keyrings if it doesn't exist
sudo mkdir -p /etc/apt/keyrings

# Download and add NodeSource GPG key
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

# Determine Ubuntu version and set up NodeSource repository
# Using Node.js 22.x (current LTS)
NODE_MAJOR=22
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list

# Update and install Node.js
echo ""
echo "🔄 Updating package lists with NodeSource repository..."
sudo apt-get update

echo ""
echo "⬇️  Installing Node.js..."
sudo apt-get install -y nodejs

# Verify Node.js and NPM installation
if command_exists node && command_exists npm; then
    echo ""
    echo "✅ Node.js installed successfully!"
    echo "   Version: $(node --version)"
    echo "   NPM Version: $(npm --version)"
else
    echo ""
    echo "❌ Error: Node.js installation failed!"
    exit 1
fi

# Install Yarn
echo ""
echo "📥 Installing Yarn..."

# Install Yarn globally via npm
sudo npm install -g yarn

# Verify Yarn installation
if command_exists yarn; then
    echo ""
    echo "✅ Yarn installed successfully!"
    echo "   Version: $(yarn --version)"
else
    echo ""
    echo "❌ Error: Yarn installation failed!"
    exit 1
fi

# Final status
echo ""
echo "🎉 All prerequisites installed successfully!"
echo ""
echo "📋 Final versions:"
echo "  Node.js: $(node --version)"
echo "  NPM:     $(npm --version)"
echo "  Yarn:    $(yarn --version)"
echo ""
echo "✨ Next steps:"
echo "  1. Run 'yarn install' to install project dependencies"
echo "  2. Run 'npm run start:linux' to start the development server"
echo "  3. Run './build.sh' to create a distributable package and install it" 
echo ""
