#!/usr/bin/env node

/**
 * Run Analysis Hook for Mim
 *
 * Executes Agent 2 (On-Changes Reviewer) to analyze knowledge files
 * against the current codebase and identify issues.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { logInfo, logWarn, logError, AGENTS } from '../dist/utils/logger.js';
import {
  CHANGES_REVIEWER_SYSTEM_PROMPT,
  getChangesReviewerOutputJsonSchema,
  writePendingReview,
  writeLastAnalysis,
  generateShortId,
} from '../dist/agents/changes-reviewer.js';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const AGENT = AGENTS.CHANGES_REVIEWER;
const KNOWLEDGE_DIR = '.claude/knowledge';
const CATEGORIES = ['architecture', 'patterns', 'dependencies', 'workflows', 'gotchas'];

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
 * Read all knowledge files from .claude/knowledge/{category}/ directories
 * Returns formatted content string with all knowledge
 */
function readAllKnowledgeFiles() {
  const knowledgeContent = [];
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
        knowledgeContent.push(`## ${category}/${file}\n\n${content}`);
      } catch (error) {
        logWarn(AGENT, `Failed to read knowledge file: ${filepath}`);
      }
    }
  }

  return knowledgeContent.join('\n\n---\n\n');
}

/**
 * Main function to run the analysis
 */
async function main() {
  logInfo(AGENT, 'Starting knowledge analysis');

  // Get current git HEAD
  const currentHead = getCurrentHead();
  if (!currentHead) {
    logError(AGENT, 'Failed to get current git HEAD - not a git repository?');
    process.exit(1);
  }
  logInfo(AGENT, `Current HEAD: ${currentHead}`);

  // Read all knowledge files
  const knowledgeContent = readAllKnowledgeFiles();
  if (!knowledgeContent) {
    logInfo(AGENT, 'No knowledge files found to analyze');
    writeLastAnalysis({
      timestamp: new Date().toISOString(),
      commit_hash: currentHead,
    });
    return;
  }
  logInfo(AGENT, 'Read knowledge files successfully');

  // Create the agent prompt
  const prompt = `Analyze these knowledge files against the codebase:\n\n${knowledgeContent}`;

  try {
    // Start Agent 2 session
    logInfo(AGENT, 'Starting agent session');
    const session = query({
      prompt,
      options: {
        model: 'opus',
        systemPrompt: CHANGES_REVIEWER_SYSTEM_PROMPT,
        canUseTool: async (tool, input) => {
          if (tool === 'AskUserQuestion') {
            return { behavior: 'deny', message: 'Create a pending review instead' };
          }
          return { behavior: 'allow', updatedInput: input };
        },
        outputFormat: {
          type: 'json_schema',
          schema: getChangesReviewerOutputJsonSchema(),
        },
      },
    });

    // Process agent stream
    for await (const event of session) {
      if (event.type === 'tool_use') {
        logInfo(AGENT, `Using tool: ${event.name}`);
      } else if (event.type === 'result') {
        if (event.subtype === 'success') {
          const output = event.structured_output;

          if (output) {
            // Process auto-fixes
            if (output.auto_fixed && output.auto_fixed.length > 0) {
              for (const fix of output.auto_fixed) {
                logInfo(AGENT, `Auto-fixed: ${fix}`);
              }
            }

            // Process reviews
            if (output.reviews && output.reviews.length > 0) {
              for (const review of output.reviews) {
                // Ensure review has an ID
                if (!review.id) {
                  review.id = generateShortId();
                }
                writePendingReview(review);
                logInfo(AGENT, `Created pending review: ${review.id} - ${review.subject}`);
              }
            }

            logInfo(AGENT, `Analysis complete: ${output.auto_fixed?.length || 0} auto-fixes, ${output.reviews?.length || 0} reviews`);
          }
        } else if (event.subtype === 'error') {
          logError(AGENT, `Agent error: ${event.error}`);
        }
      }
    }

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
}

main().catch((error) => {
  logError(AGENT, `Unhandled error: ${error.message}`);
  process.exit(1);
});
