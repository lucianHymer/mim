#!/bin/bash
set -e

echo "Building mim TypeScript to CommonJS..."

# Use TypeScript from dev dependencies
cd "$(dirname "$0")"
npx typescript

# Concatenate all JS files into a single mim.cjs
echo "#!/usr/bin/env node" > scripts/mim.cjs

# Add all the built files in the right order
cat dist/types.js >> scripts/mim.cjs
echo "" >> scripts/mim.cjs
cat dist/prompts.js >> scripts/mim.cjs
echo "" >> scripts/mim.cjs
cat dist/claude.js >> scripts/mim.cjs
echo "" >> scripts/mim.cjs
cat dist/commands/help.js >> scripts/mim.cjs
echo "" >> scripts/mim.cjs
cat dist/commands/coalesce.js >> scripts/mim.cjs
echo "" >> scripts/mim.cjs
cat dist/commands/distill.js >> scripts/mim.cjs
echo "" >> scripts/mim.cjs
cat dist/index.js >> scripts/mim.cjs

# Make executable
chmod +x scripts/mim.cjs

# Clean up dist directory
rm -rf dist

echo "Build complete: scripts/mim.cjs"