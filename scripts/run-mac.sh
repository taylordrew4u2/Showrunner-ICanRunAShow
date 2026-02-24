#!/usr/bin/env bash
# run-mac.sh — quick start for Mac users
set -e

# Check for Node
if ! command -v node &>/dev/null; then
  echo "Node.js is not installed. Install it from https://nodejs.org/ and re-run this script."
  exit 1
fi

# Check for npm
if ! command -v npm &>/dev/null; then
  echo "npm is not installed. It usually comes with Node.js — please reinstall Node from https://nodejs.org/"
  exit 1
fi

# Install / sync dependencies
echo "Installing dependencies..."
npm --prefix "$(dirname "$0")/.." install

# Start the web app
echo "Starting Showrunner in your browser..."
npm --prefix "$(dirname "$0")/.." run web
