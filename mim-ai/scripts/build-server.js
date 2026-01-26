#!/usr/bin/env node

/**
 * Build script for bundling the MCP server and hooks with all dependencies
 * This creates self-contained .cjs files that can run without node_modules
 */

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// Node.js built-ins that are always available
const nodeBuiltins = [
  'readline',
  'fs',
  'path',
  'child_process',
  'os',
  'util',
  'events',
  'stream',
  'buffer',
  'crypto',
  'http',
  'https',
  'net',
  'tls',
  'url',
  'zlib',
  'assert',
  'tty',
  'worker_threads',
  'async_hooks',
  'perf_hooks',
  'v8',
  'vm',
  'module',
];

async function bundleFile(entry, outfile, description, format = 'cjs') {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format,
    outfile,
    external: nodeBuiltins,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    banner: {
      js: `// Bundled ${description} for Mim\n// Built with esbuild - all dependencies included\n`,
    },
    minify: false,
    sourcemap: false,
  });
  console.log(`✓ ${description} bundled: ${outfile}`);
}

async function build() {
  try {
    // Bundle MCP server
    await bundleFile(
      join(projectRoot, 'dist/servers/mim-server.js'),
      join(projectRoot, 'servers/mim-server.bundled.cjs'),
      'MCP Server'
    );

    // Bundle hooks from compiled TypeScript output
    // ESM format is required to preserve import.meta.url for claude-agent-sdk
    await bundleFile(
      join(projectRoot, 'dist/hooks/run-analysis.js'),
      join(projectRoot, 'hooks/run-analysis.bundled.mjs'),
      'Analysis Hook',
      'esm'
    );

    await bundleFile(
      join(projectRoot, 'dist/hooks/session-start.js'),
      join(projectRoot, 'hooks/session-start.bundled.mjs'),
      'Session Start Hook',
      'esm'
    );

    console.log('\n✓ All bundles created successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
