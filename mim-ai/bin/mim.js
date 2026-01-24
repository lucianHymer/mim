#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const KNOWLEDGE_DIR = '.claude/knowledge';
const PENDING_DIR = path.join(KNOWLEDGE_DIR, 'pending-review');

const KNOWLEDGE_SUBDIRS = [
  'pending-review',
  'architecture',
  'patterns',
  'dependencies',
  'workflows',
  'gotchas',
];

const args = process.argv.slice(2);
const command = args[0] || 'status';

async function main() {
  switch (command) {
    case 'status':
      await checkStatus();
      break;

    case 'review':
      await runReview();
      break;

    case 'init':
      await initKnowledge();
      break;

    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

/**
 * Check for pending reviews
 */
async function checkStatus() {
  const pendingDir = path.join(process.cwd(), PENDING_DIR);

  if (!fs.existsSync(pendingDir)) {
    console.log('The Wellspring is pure.');
    return;
  }

  try {
    const files = fs.readdirSync(pendingDir).filter((f) => f.endsWith('.json'));

    // Check for unanswered reviews
    let unansweredCount = 0;
    for (const file of files) {
      const content = fs.readFileSync(path.join(pendingDir, file), 'utf-8');
      const review = JSON.parse(content);
      if (!review.answer) {
        unansweredCount++;
      }
    }

    if (unansweredCount > 0) {
      console.log(`Pending reviews found (${unansweredCount}). Run 'mim review' to begin.`);
    } else {
      console.log('The Wellspring is pure.');
    }
  } catch (err) {
    console.log('The Wellspring is pure.');
  }
}

/**
 * Launch the review game UI
 */
async function runReview() {
  try {
    const { startGame } = await import('../dist/tui/main.js');
    const { completion } = await startGame();
    await completion;
  } catch (err) {
    console.error('Failed to start review game:', err.message);
    process.exit(1);
  }
}

/**
 * Initialize knowledge directory structure
 */
async function initKnowledge() {
  const baseDir = path.join(process.cwd(), KNOWLEDGE_DIR);

  // Create base directory
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  // Create subdirectories
  for (const subdir of KNOWLEDGE_SUBDIRS) {
    const dir = path.join(baseDir, subdir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  console.log('Knowledge directory initialized.');
}

/**
 * Print usage help
 */
function printHelp() {
  console.log(`
Mim - Persistent Memory for Claude Code

Usage: mim [command]

Commands:
  (no command)  Check for pending reviews
  status        Check for pending reviews (same as no command)
  review        Launch the review game UI
  init          Initialize knowledge directory structure
  help          Show this help message

The Wellspring awaits.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
