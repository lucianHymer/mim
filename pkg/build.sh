#!/bin/bash
set -e

echo "Building mim TypeScript to CommonJS..."

# Use TypeScript from dev dependencies
cd "$(dirname "$0")"
npx tsc

echo "Build complete: scripts/mim.js"