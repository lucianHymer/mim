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

async function bundleFile(entry, outfile, description) {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
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

    // Bundle run-analysis hook (has npm dependencies like @anthropic-ai/claude-agent-sdk)
    await bundleFile(
      join(projectRoot, 'hooks/run-analysis.js'),
      join(projectRoot, 'hooks/run-analysis.bundled.cjs'),
      'Analysis Hook'
    );

    console.log('\n✓ All bundles created successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
