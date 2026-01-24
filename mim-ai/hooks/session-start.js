#!/usr/bin/env node

/**
 * Session Start Hook for Mim
 *
 * Checks if knowledge analysis is needed based on git commits.
 * If HEAD has changed since last analysis, notifies the user.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const KNOWLEDGE_DIR = '.claude/knowledge';
const LAST_ANALYSIS_FILE = path.join(KNOWLEDGE_DIR, '.last-analysis');
const PENDING_DIR = path.join(KNOWLEDGE_DIR, 'pending-review');

function getCurrentHead() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function readLastAnalysis() {
  try {
    const filepath = path.join(process.cwd(), LAST_ANALYSIS_FILE);
    const content = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function countPendingReviews() {
  try {
    const dir = path.join(process.cwd(), PENDING_DIR);
    if (!fs.existsSync(dir)) return 0;

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    let count = 0;
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      const review = JSON.parse(content);
      if (!review.answer) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

async function main() {
  const currentHead = getCurrentHead();
  if (!currentHead) {
    // Not a git repo, skip
    return;
  }

  const lastAnalysis = readLastAnalysis();
  const pendingCount = countPendingReviews();

  // Check if analysis is needed
  if (lastAnalysis && lastAnalysis.commit_hash === currentHead) {
    // Already analyzed this commit
    if (pendingCount > 0) {
      console.log(`\n🗣️ Mím awaits: ${pendingCount} question${pendingCount > 1 ? 's' : ''} require your wisdom.`);
      console.log('   Run "mim review" to visit the Bridge Guardian.\n');
    }
    return;
  }

  // HEAD has changed - analysis may be needed
  // Note: We don't run the full analysis here (too slow for a hook)
  // Just notify the user
  if (lastAnalysis) {
    console.log('\n📜 The codebase has changed since last analysis.');
    console.log('   Consider running knowledge analysis to keep the Wellspring pure.\n');
  }

  if (pendingCount > 0) {
    console.log(`🗣️ ${pendingCount} pending review${pendingCount > 1 ? 's' : ''} await your decision.`);
    console.log('   Run "mim review" to begin.\n');
  }
}

main().catch(console.error);
