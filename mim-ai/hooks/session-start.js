#!/usr/bin/env node

/**
 * Session Start Hook for Mim
 *
 * Ensures knowledge structure exists and checks if analysis is needed.
 */

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const KNOWLEDGE_DIR = '.claude/knowledge';
const LAST_ANALYSIS_FILE = path.join(KNOWLEDGE_DIR, '.last-analysis');
const PENDING_DIR = path.join(KNOWLEDGE_DIR, 'pending-review');

function runMimInit() {
  try {
    // Run mim init silently - it's idempotent
    execSync('mim init', { stdio: 'pipe', encoding: 'utf-8' });
  } catch {
    // mim command might not be in PATH, try via npx or direct
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const mimBin = path.join(__dirname, '..', 'bin', 'mim.js');
      execSync(`node ${mimBin} init`, { stdio: 'pipe', encoding: 'utf-8' });
    } catch {
      // Silently fail - structure may already exist
    }
  }
}

function spawnBackgroundAnalysis() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // Use bundled version - it includes all npm dependencies
  const analysisScript = path.join(__dirname, 'run-analysis.bundled.cjs');

  // Spawn detached so it doesn't block the session
  const child = spawn('node', [analysisScript], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd()
  });

  child.unref(); // Allow parent to exit independently
}

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

/**
 * Output hook result as JSON to stdout
 * Claude Code hooks communicate via structured JSON, not plain text
 */
function outputResult(message) {
  const result = {
    continue: true,
  };
  if (message) {
    result.systemMessage = message;
  }
  console.log(JSON.stringify(result));
}

async function main() {
  const currentHead = getCurrentHead();
  if (!currentHead) {
    // Not a git repo, skip silently
    outputResult(null);
    return;
  }

  // Ensure knowledge structure exists (idempotent)
  runMimInit();

  const lastAnalysis = readLastAnalysis();
  const pendingCount = countPendingReviews();
  const messages = [];

  // Check if analysis is needed
  if (lastAnalysis && lastAnalysis.commit_hash === currentHead) {
    // Already analyzed this commit
    if (pendingCount > 0) {
      messages.push(`🗣️ ${pendingCount} pending review${pendingCount > 1 ? 's' : ''} await your decision.`);
      messages.push('   Run "mim review" to begin.');
    }
    outputResult(messages.length > 0 ? messages.join('\n') : null);
    return;
  }

  // HEAD has changed - spawn background analysis
  if (lastAnalysis) {
    messages.push('📜 The codebase has changed since last analysis.');
    messages.push('   Mím is analyzing in the background...');
  } else {
    // First time - also spawn analysis
    messages.push('📜 First time seeing this codebase.');
    messages.push('   Mím is analyzing in the background...');
  }
  spawnBackgroundAnalysis();

  if (pendingCount > 0) {
    messages.push('');
    messages.push(`🗣️ ${pendingCount} pending review${pendingCount > 1 ? 's' : ''} await your decision.`);
    messages.push('   Run "mim review" to begin.');
  }

  outputResult(messages.join('\n'));
}

main().catch((err) => {
  // On error, still output valid JSON so hook doesn't break
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
});
