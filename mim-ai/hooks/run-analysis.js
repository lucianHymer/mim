#!/usr/bin/env node

/**
 * Run Analysis Hook for Mim
 *
 * Uses the Inquisitor Swarm pattern:
 * 1. Read all knowledge entries
 * 2. Spawn parallel Haiku inquisitors (one per entry)
 * 3. Each inquisitor investigates ONE entry against the codebase
 * 4. Collect and synthesize results into reviews
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { logInfo, logWarn, logError, AGENTS } from '../dist/utils/logger.js';
import {
  writePendingReview,
  writeLastAnalysis,
} from '../dist/agents/changes-reviewer.js';
import {
  INQUISITOR_SYSTEM_PROMPT,
  getInquisitorOutputJsonSchema,
  parseKnowledgeEntries,
} from '../dist/agents/inquisitor.js';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const AGENT = AGENTS.CHANGES_REVIEWER;
const KNOWLEDGE_DIR = '.claude/knowledge';
const PENDING_DIR = `${KNOWLEDGE_DIR}/pending-review`;
const CATEGORIES = ['architecture', 'patterns', 'dependencies', 'workflows', 'gotchas'];
const LOCK_FILE = path.join(KNOWLEDGE_DIR, '.analysis-lock');

// Concurrency limit for inquisitor agents
const MAX_CONCURRENT_INQUISITORS = 5;

/**
 * Check if a process with the given PID exists
 */
function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire a lock for the analysis process
 * Returns true if lock was acquired, false if another process is already running
 */
function acquireLock() {
  const lockPath = path.join(process.cwd(), LOCK_FILE);

  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      if (processExists(lock.pid)) {
        logInfo(AGENT, `Analysis already running (PID ${lock.pid}), skipping`);
        return false;
      }
      logInfo(AGENT, `Clearing stale lock from dead process ${lock.pid}`);
    } catch {
      // Corrupted lock file, clear it
    }
  }

  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    started_at: new Date().toISOString()
  }, null, 2));

  return true;
}

/**
 * Release the lock file
 */
function releaseLock() {
  const lockPath = path.join(process.cwd(), LOCK_FILE);
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
}

/**
 * Check if a pending review already exists for the given entry ID
 */
function pendingReviewExists(entryId) {
  const reviewPath = path.join(process.cwd(), PENDING_DIR, `${entryId}.json`);
  return fs.existsSync(reviewPath);
}

/**
 * Read existing pending reviews
 */
function getPendingReviews() {
  const reviews = [];
  const dir = path.join(process.cwd(), PENDING_DIR);

  if (!fs.existsSync(dir)) return reviews;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      const review = JSON.parse(content);
      if (!review.answer) {  // Only unanswered reviews
        reviews.push({ ...review, _filename: file });
      }
    } catch (e) {
      logWarn(AGENT, `Failed to read review file: ${file}`);
    }
  }

  return reviews;
}

/**
 * Delete a pending review file
 */
function deletePendingReview(filename) {
  const filepath = path.join(process.cwd(), PENDING_DIR, filename);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    logInfo(AGENT, `Deleted stale review: ${filename}`);
  }
}

/**
 * Get the current git HEAD commit hash
 */
function getCurrentHead() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch (error) {
    return null;
  }
}

/**
 * Read all knowledge files and parse into individual entries
 */
function getAllKnowledgeEntries() {
  const entries = [];
  const baseDir = path.join(process.cwd(), KNOWLEDGE_DIR);

  for (const category of CATEGORIES) {
    const categoryDir = path.join(baseDir, category);

    if (!fs.existsSync(categoryDir)) {
      continue;
    }

    const files = fs.readdirSync(categoryDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      const filepath = path.join(categoryDir, file);
      try {
        const content = fs.readFileSync(filepath, 'utf-8');
        const parsed = parseKnowledgeEntries(category, file, content);
        entries.push(...parsed);
      } catch (error) {
        logWarn(AGENT, `Failed to read knowledge file: ${filepath}`);
      }
    }
  }

  return entries;
}

/**
 * Check if a pending review is still relevant
 * Returns true if the review should be kept, false if it's now moot
 */
async function checkReviewRelevance(review) {
  const prompt = `Check if this pending review is still relevant:

**Review ID:** ${review.id}
**Subject:** ${review.subject}
**Type:** ${review.type}
**Question:** ${review.question}
**Context:** ${review.context}
**Knowledge File:** ${review.knowledge_file}

Investigate if this issue still exists. The review was created because of a detected issue in the knowledge base. Check if:
1. The knowledge file still exists
2. The issue described is still present
3. Code changes may have resolved the conflict

Respond with:
- still_relevant: true if the issue persists and needs human review
- still_relevant: false if the issue was resolved (explain why)
- reason: explanation of your finding`;

  try {
    const session = query({
      prompt,
      options: {
        model: 'haiku',
        systemPrompt: 'You are checking if a pending knowledge review is still relevant. Be brief and direct.',
        canUseTool: async (tool, input) => {
          const allowedTools = ['Read', 'Glob', 'Grep'];
          if (allowedTools.includes(tool)) {
            return { behavior: 'allow', updatedInput: input };
          }
          return { behavior: 'deny', message: 'Tool not allowed' };
        },
      },
    });

    for await (const event of session) {
      if (event.type === 'result' && event.subtype === 'success') {
        const text = event.text || '';
        // Simple heuristic: if response contains "still_relevant: false" or "no longer", it's moot
        const isMoot = text.toLowerCase().includes('still_relevant: false') ||
                       text.toLowerCase().includes('no longer relevant') ||
                       text.toLowerCase().includes('issue resolved') ||
                       text.toLowerCase().includes('has been fixed');
        return { review, stillRelevant: !isMoot, reason: text };
      }
    }
    return { review, stillRelevant: true, reason: 'Could not determine' };
  } catch (error) {
    logWarn(AGENT, `Failed to check review relevance: ${error.message}`);
    return { review, stillRelevant: true, reason: 'Error checking' };
  }
}

/**
 * Run a single inquisitor agent on one knowledge entry
 */
async function runInquisitor(entry) {
  const prompt = `Investigate this knowledge entry:

**Entry ID:** ${entry.id}
**Category:** ${entry.category}
**File:** ${entry.file}
**Topic:** ${entry.topic}

**Content:**
${entry.content}

Verify this knowledge against the actual codebase. Check if the referenced code exists, if the claims are accurate, and recommend the best location for this knowledge.`;

  try {
    const session = query({
      prompt,
      options: {
        model: 'sonnet',
        systemPrompt: INQUISITOR_SYSTEM_PROMPT,
        canUseTool: async (tool, input) => {
          // Allow read-only tools and specific git commands
          const allowedTools = ['Read', 'Glob', 'Grep'];
          const allowedBashPrefixes = ['git log', 'git show', 'git diff', 'git blame'];

          if (allowedTools.includes(tool)) {
            return { behavior: 'allow', updatedInput: input };
          }

          if (tool === 'Bash') {
            const cmd = input?.command || '';
            if (allowedBashPrefixes.some(prefix => cmd.startsWith(prefix))) {
              return { behavior: 'allow', updatedInput: input };
            }
            return { behavior: 'deny', message: 'Only git read commands allowed' };
          }

          return { behavior: 'deny', message: 'Tool not allowed for inquisitor' };
        },
        outputFormat: {
          type: 'json_schema',
          schema: getInquisitorOutputJsonSchema(),
        },
      },
    });

    // Collect result
    for await (const event of session) {
      if (event.type === 'result' && event.subtype === 'success') {
        return {
          entry,
          output: event.structured_output,
          success: true,
        };
      } else if (event.type === 'result' && event.subtype === 'error') {
        return {
          entry,
          error: event.error,
          success: false,
        };
      }
    }

    return { entry, error: 'No result received', success: false };
  } catch (error) {
    return { entry, error: error.message, success: false };
  }
}

/**
 * Run inquisitors in parallel with concurrency limit
 */
async function runInquisitorSwarm(entries) {
  // Filter out entries that already have pending reviews
  const entriesToProcess = entries.filter(entry => {
    if (pendingReviewExists(entry.id)) {
      logInfo(AGENT, `Skipping ${entry.id} - pending review already exists`);
      return false;
    }
    return true;
  });

  if (entriesToProcess.length < entries.length) {
    logInfo(AGENT, `Filtered ${entries.length - entriesToProcess.length} entries with existing reviews`);
  }

  const results = [];
  const pending = [...entriesToProcess];

  while (pending.length > 0 || results.length < entriesToProcess.length) {
    // Start new inquisitors up to concurrency limit
    const batch = pending.splice(0, MAX_CONCURRENT_INQUISITORS);

    if (batch.length > 0) {
      logInfo(AGENT, `Launching ${batch.length} inquisitors (${pending.length} remaining)`);
      const batchResults = await Promise.all(batch.map(entry => runInquisitor(entry)));
      results.push(...batchResults);
    }
  }

  return results;
}

/**
 * Synthesize inquisitor results into reviews and auto-fixes
 */
function synthesizeResults(results) {
  const autoFixes = [];
  const reviews = [];

  for (const result of results) {
    if (!result.success) {
      logWarn(AGENT, `Inquisitor failed for ${result.entry.id}: ${result.error}`);
      continue;
    }

    const output = result.output;
    if (!output) continue;

    // Skip valid entries
    if (output.status === 'valid') {
      logInfo(AGENT, `Entry ${output.entry_id} is valid`);
      continue;
    }

    // Process issues
    if (output.issue) {
      if (output.issue.severity === 'auto_fix' && output.issue.suggested_fix) {
        autoFixes.push({
          entry_id: output.entry_id,
          description: output.issue.description,
          fix: output.issue.suggested_fix,
        });
      } else if (output.issue.severity === 'needs_review') {
        reviews.push({
          id: result.entry.id,
          subject: `${result.entry.topic} - ${output.status}`,
          type: output.status,
          question: output.issue.review_question || output.issue.description,
          context: `Category: ${result.entry.category}\nFile: ${result.entry.file}\n\nFindings: ${output.findings.current_behavior}\n\nLocation recommendation: ${output.location_context.scope} - ${output.location_context.reason}`,
          options: output.issue.review_options || ['Keep current documentation', 'Update to match code', 'Remove this entry'],
          knowledge_file: `${result.entry.category}/${result.entry.file}`,
        });
      }
    }
  }

  return { autoFixes, reviews };
}

/**
 * Main function to run the analysis
 */
async function main() {
  // Acquire lock - exit early if another analysis is already running
  if (!acquireLock()) {
    return;
  }

  try {
    logInfo(AGENT, 'Starting knowledge analysis (Inquisitor Swarm)');

    // Get current git HEAD
    const currentHead = getCurrentHead();
    if (!currentHead) {
      logError(AGENT, 'Failed to get current git HEAD - not a git repository?');
      process.exit(1);
    }
    logInfo(AGENT, `Current HEAD: ${currentHead}`);

    try {
      // PHASE 1: Check existing pending reviews first
      const pendingReviews = getPendingReviews();
      if (pendingReviews.length > 0) {
        logInfo(AGENT, `Checking ${pendingReviews.length} existing pending reviews...`);

        const reviewChecks = await Promise.all(
          pendingReviews.map(review => checkReviewRelevance(review))
        );

        let staleCount = 0;
        for (const check of reviewChecks) {
          if (!check.stillRelevant) {
            deletePendingReview(check.review._filename);
            staleCount++;
          }
        }

        if (staleCount > 0) {
          logInfo(AGENT, `Cleaned up ${staleCount} stale reviews`);
        }
      }

      // PHASE 2: Investigate knowledge entries
      const entries = getAllKnowledgeEntries();
      if (entries.length === 0) {
        logInfo(AGENT, 'No knowledge entries found to analyze');
        writeLastAnalysis({
          timestamp: new Date().toISOString(),
          commit_hash: currentHead,
        });
        return;
      }
      logInfo(AGENT, `Found ${entries.length} knowledge entries to investigate`);

      // Run inquisitor swarm
      const results = await runInquisitorSwarm(entries);
      logInfo(AGENT, `Inquisitor swarm complete: ${results.filter(r => r.success).length}/${results.length} successful`);

      // Synthesize results
      const { autoFixes, reviews } = synthesizeResults(results);

      // PHASE 3: Apply auto-fixes
      for (const fix of autoFixes) {
        logInfo(AGENT, `Auto-fix: ${fix.entry_id} - ${fix.description}`);
        // Auto-fixes are logged but manual for now
        // In future: could use Edit tool to apply them
      }

      // PHASE 4: Write new pending reviews
      for (const review of reviews) {
        writePendingReview(review);
        logInfo(AGENT, `Created pending review: ${review.id} - ${review.subject}`);
      }

      logInfo(AGENT, `Analysis complete: ${autoFixes.length} auto-fixes, ${reviews.length} new reviews`);

      // Update last analysis state
      writeLastAnalysis({
        timestamp: new Date().toISOString(),
        commit_hash: currentHead,
      });
      logInfo(AGENT, 'Analysis state updated');

    } catch (error) {
      logError(AGENT, `Analysis failed: ${error.message}`);
      process.exit(1);
    }

    logInfo(AGENT, 'Analysis completed successfully');
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  logError(AGENT, `Unhandled error: ${error.message}`);
  process.exit(1);
});
