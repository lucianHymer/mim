#!/usr/bin/env node

/**
 * Build script for bundling the MCP server with all dependencies
 * This creates a self-contained .cjs file that can run without node_modules
 */

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

async function build() {
  try {
    await esbuild.build({
      entryPoints: [join(projectRoot, 'servers/mim-server.cjs')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: join(projectRoot, 'servers/mim-server.bundled.cjs'),
      // Mark Node.js built-ins as external (they're always available)
      external: [
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
      ],
      // Inject shims if needed
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      // Handle dynamic imports
      banner: {
        js: `
// Bundled MCP Server for Mim
// Built with esbuild - all dependencies included
`,
      },
      minify: false, // Keep readable for debugging
      sourcemap: false,
    });

    console.log('✓ Server bundled successfully: servers/mim-server.bundled.cjs');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
