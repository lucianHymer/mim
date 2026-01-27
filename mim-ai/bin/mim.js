#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const KNOWLEDGE_DIR = '.claude/knowledge';
const PENDING_DIR = path.join(KNOWLEDGE_DIR, 'pending-review');

const KNOWLEDGE_SUBDIRS = [
  'remember-queue',
  'pending-review',
  'architecture',
  'patterns',
  'dependencies',
  'workflows',
  'gotchas',
];

// ============================================
// V1 Templates - Battle-tested language
// ============================================

const INSTRUCTIONS_MD = `# 🧠 Knowledge Remembering Protocol

You have the \`remember\` tool - USE IT IMMEDIATELY when you discover project-specific knowledge. This creates persistent memory that survives context resets.

## 🎯 Remember Parameters
- **category**: Knowledge type (architecture, patterns, dependencies, workflows, gotchas, or any descriptive category)
- **topic**: Clear title for your discovery
- **details**: Complete specifics with context
- **files**: Related file paths (recommended)

## ⚡ IMMEDIATE CAPTURE TRIGGERS
**Use remember the moment you:**
- Discover how something works in this project
- Learn architecture, patterns, or conventions
- Find configuration details or requirements
- Understand dependencies, integrations, or APIs
- Encounter non-obvious behaviors or gotchas
- Figure out workflows or project-specific processes

## 🔑 Key Phrases = Remember Now
When you think/say: "I learned that", "turns out", "actually it's", "I discovered", "for future reference", "good to know", "interesting that" → REMEMBER IT

## 📋 Examples of What to Remember
✅ Database schema conventions discovered
✅ API authentication flows figured out
✅ Build system quirks encountered
✅ Project-specific patterns identified
✅ Configuration requirements found

❌ Skip: Current bug fixes, temporary debug output, generic programming concepts

**ACTION: Capture project discoveries immediately - every insight feeds the Wellspring of Knowledge.**

## ⚠️ Remember Knowledge First

Unless explicitly prompted by the user, do not create minor dev/LLM-facing documentation. Use remember instead.
`;

const KNOWLEDGE_MAP_CLAUDE_MD = `# Knowledge Map (Claude Reference)

This file provides Claude with quick access to all project knowledge via @ references.
Structure mirrors KNOWLEDGE_MAP.md but uses @ references instead of markdown links.

## Architecture
<!-- @architecture/*.md entries will be added here -->

## Patterns
<!-- @patterns/*.md entries will be added here -->

## Dependencies
<!-- @dependencies/*.md entries will be added here -->

## Workflows
<!-- @workflows/*.md entries will be added here -->

## Gotchas
<!-- @gotchas/*.md entries will be added here -->
`;

const KNOWLEDGE_MAP_MD = `# Knowledge Map

This is the human-readable index of all project knowledge.
Use markdown links to navigate to specific documentation.

## Architecture
<!-- [Topic](architecture/file.md) entries will be added here -->

## Patterns
<!-- [Topic](patterns/file.md) entries will be added here -->

## Dependencies
<!-- [Topic](dependencies/file.md) entries will be added here -->

## Workflows
<!-- [Topic](workflows/file.md) entries will be added here -->

## Gotchas
<!-- [Topic](gotchas/file.md) entries will be added here -->
`;

const args = process.argv.slice(2);
const command = args[0] || 'status';

/**
 * Print the gradient title art
 */
async function printTitle() {
  try {
    const { printTitleArt } = await import('../dist/tui/title-screen.js');
    printTitleArt();
  } catch {
    // Fallback if title screen module not available
    console.log('\n  MIM - Persistent Memory for Claude Code\n');
  }
}

async function main() {
  // Show title for most commands (not help)
  if (command !== 'help' && command !== '--help' && command !== '-h') {
    await printTitle();
  }

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
      await printTitle();
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
    console.log('All questions are answered.\nPass, wanderer.\nYour words are carved into \x1b[3maskr Yggdrasils\x1b[23m, the World Tree.');
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
      console.log('All questions are answered.\nPass, wanderer.\nYour words are carved into \x1b[3maskr Yggdrasils\x1b[23m, the World Tree.');
    }
  } catch (err) {
    console.log('All questions are answered.\nPass, wanderer.\nYour words are carved into \x1b[3maskr Yggdrasils\x1b[23m, the World Tree.');
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
  const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');
  let created = [];
  let skipped = [];

  // Create base directory
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
    created.push('.claude/knowledge/');
  }

  // Create subdirectories
  for (const subdir of KNOWLEDGE_SUBDIRS) {
    const dir = path.join(baseDir, subdir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(`.claude/knowledge/${subdir}/`);
    }
  }

  // Create INSTRUCTIONS.md (idempotent - don't overwrite)
  const instructionsPath = path.join(baseDir, 'INSTRUCTIONS.md');
  if (!fs.existsSync(instructionsPath)) {
    fs.writeFileSync(instructionsPath, INSTRUCTIONS_MD);
    created.push('INSTRUCTIONS.md');
  } else {
    skipped.push('INSTRUCTIONS.md (exists)');
  }

  // Create KNOWLEDGE_MAP_CLAUDE.md (idempotent - don't overwrite)
  const mapClaudePath = path.join(baseDir, 'KNOWLEDGE_MAP_CLAUDE.md');
  if (!fs.existsSync(mapClaudePath)) {
    fs.writeFileSync(mapClaudePath, KNOWLEDGE_MAP_CLAUDE_MD);
    created.push('KNOWLEDGE_MAP_CLAUDE.md');
  } else {
    skipped.push('KNOWLEDGE_MAP_CLAUDE.md (exists)');
  }

  // Create KNOWLEDGE_MAP.md (idempotent - don't overwrite)
  const mapPath = path.join(baseDir, 'KNOWLEDGE_MAP.md');
  if (!fs.existsSync(mapPath)) {
    fs.writeFileSync(mapPath, KNOWLEDGE_MAP_MD);
    created.push('KNOWLEDGE_MAP.md');
  } else {
    skipped.push('KNOWLEDGE_MAP.md (exists)');
  }

  // Update CLAUDE.md with @ references
  const claudeMdUpdated = await updateClaudeMd(claudeMdPath);
  if (claudeMdUpdated) {
    created.push('CLAUDE.md (updated with @ references)');
  } else {
    skipped.push('CLAUDE.md (already configured)');
  }

  // Print summary
  console.log('Knowledge structure initialized.\n');

  if (created.length > 0) {
    console.log('Created:');
    created.forEach(item => console.log(`  ✓ ${item}`));
  }

  if (skipped.length > 0) {
    console.log('\nSkipped (already exists):');
    skipped.forEach(item => console.log(`  - ${item}`));
  }

  console.log('\nKnowledge awaits at the wellspring.');
}

/**
 * Update CLAUDE.md to include knowledge @ references
 * Returns true if updated, false if already configured
 */
async function updateClaudeMd(claudeMdPath) {
  const requiredRefs = [
    '@.claude/knowledge/INSTRUCTIONS.md',
    '@.claude/knowledge/KNOWLEDGE_MAP_CLAUDE.md',
  ];

  let content = '';
  let exists = fs.existsSync(claudeMdPath);

  if (exists) {
    content = fs.readFileSync(claudeMdPath, 'utf-8');

    // Check if already configured
    const hasAllRefs = requiredRefs.every(ref => content.includes(ref));
    if (hasAllRefs) {
      return false; // Already configured
    }
  }

  // Build the knowledge section
  const knowledgeSection = `
## Mim Knowledge

${requiredRefs.join('\n')}
`;

  if (exists) {
    // Append to existing file if refs not present
    const missingRefs = requiredRefs.filter(ref => !content.includes(ref));
    if (missingRefs.length > 0) {
      // Check if there's already a Mim Knowledge section
      if (content.includes('## Mim Knowledge')) {
        // Add missing refs after the section header
        const lines = content.split('\n');
        const sectionIndex = lines.findIndex(line => line.includes('## Mim Knowledge'));
        if (sectionIndex !== -1) {
          // Insert missing refs after the header
          lines.splice(sectionIndex + 1, 0, '', ...missingRefs);
          content = lines.join('\n');
        }
      } else {
        // Append new section
        content = content.trimEnd() + '\n' + knowledgeSection;
      }
      fs.writeFileSync(claudeMdPath, content);
      return true;
    }
  } else {
    // Create new CLAUDE.md
    fs.writeFileSync(claudeMdPath, knowledgeSection.trim() + '\n');
    return true;
  }

  return false;
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
