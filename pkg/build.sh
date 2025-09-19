#!/bin/bash
set -e

echo "Building mim TypeScript to CommonJS..."

# Use TypeScript from dev dependencies
cd "$(dirname "$0")"
npx tsc

# The TypeScript compiler outputs to scripts/mim.js as configured in tsconfig.json
# Rename to .cjs for clarity
if [ -f "scripts/mim.js" ]; then
    mv scripts/mim.js scripts/mim.cjs
    chmod +x scripts/mim.cjs
    echo "Build complete: scripts/mim.cjs"
else
    echo "Error: Build output not found at scripts/mim.js"
    exit 1
fi