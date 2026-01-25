#!/usr/bin/env node

/**
 * Session Start Hook for Mim
 *
 * Checks if knowledge analysis is needed based on git commits.
 * If HEAD has changed since last analysis, notifies the user.
 */

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const KNOWLEDGE_DIR = '.claude/knowledge';
const LAST_ANALYSIS_FILE = path.join(KNOWLEDGE_DIR, '.last-analysis');
const PENDING_DIR = path.join(KNOWLEDGE_DIR, 'pending-review');
const INSTRUCTIONS_FILE = path.join(KNOWLEDGE_DIR, 'INSTRUCTIONS.md');
const KNOWLEDGE_MAP_CLAUDE = path.join(KNOWLEDGE_DIR, 'KNOWLEDGE_MAP_CLAUDE.md');
const KNOWLEDGE_MAP = path.join(KNOWLEDGE_DIR, 'KNOWLEDGE_MAP.md');

function spawnBackgroundAnalysis() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const analysisScript = path.join(__dirname, 'run-analysis.js');

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
 * Check if knowledge structure is properly initialized
 * Returns: { initialized: boolean, missing: string[] }
 */
function checkKnowledgeStructure() {
  const cwd = process.cwd();
  const requiredFiles = [
    INSTRUCTIONS_FILE,
    KNOWLEDGE_MAP_CLAUDE,
    KNOWLEDGE_MAP,
  ];

  const missing = [];

  // Check base directory
  if (!fs.existsSync(path.join(cwd, KNOWLEDGE_DIR))) {
    return { initialized: false, missing: [KNOWLEDGE_DIR] };
  }

  // Check required files
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(cwd, file))) {
      missing.push(file);
    }
  }

  return {
    initialized: missing.length === 0,
    missing
  };
}

/**
 * Check if CLAUDE.md has required @ references
 */
function checkClaudeMdReferences() {
  const cwd = process.cwd();
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');

  if (!fs.existsSync(claudeMdPath)) {
    return { configured: false, missing: ['CLAUDE.md does not exist'] };
  }

  const content = fs.readFileSync(claudeMdPath, 'utf-8');
  const requiredRefs = [
    '@.claude/knowledge/INSTRUCTIONS.md',
    '@.claude/knowledge/KNOWLEDGE_MAP_CLAUDE.md',
  ];

  const missing = requiredRefs.filter(ref => !content.includes(ref));

  return {
    configured: missing.length === 0,
    missing
  };
}

async function main() {
  const currentHead = getCurrentHead();
  if (!currentHead) {
    // Not a git repo, skip
    return;
  }

  // Check if knowledge structure is initialized
  const structureCheck = checkKnowledgeStructure();
  const claudeMdCheck = checkClaudeMdReferences();

  if (!structureCheck.initialized || !claudeMdCheck.configured) {
    console.log('\n📜 Mím knowledge structure needs initialization.');
    console.log('   Run "mim init" to set up persistent memory for this project.\n');

    if (!structureCheck.initialized) {
      console.log('   Missing structure:');
      structureCheck.missing.forEach(m => console.log(`     - ${m}`));
    }
    if (!claudeMdCheck.configured) {
      console.log('   Missing CLAUDE.md references:');
      claudeMdCheck.missing.forEach(m => console.log(`     - ${m}`));
    }
    console.log('');
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

  // HEAD has changed - spawn background analysis
  if (lastAnalysis) {
    console.log('\n📜 The codebase has changed since last analysis.');
    console.log('   Mím is analyzing in the background...\n');
    spawnBackgroundAnalysis();
  } else {
    // First time - also spawn analysis
    console.log('\n📜 First time seeing this codebase.');
    console.log('   Mím is analyzing in the background...\n');
    spawnBackgroundAnalysis();
  }

  if (pendingCount > 0) {
    console.log(`🗣️ ${pendingCount} pending review${pendingCount > 1 ? 's' : ''} await your decision.`);
    console.log('   Run "mim review" to begin.\n');
  }
}

main().catch(console.error);
