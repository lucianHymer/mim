#!/usr/bin/env node

import { spawn } from 'child_process';
import { createWriteStream, mkdtempSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';

// ============================================================================
// TYPES
// ============================================================================

interface Session {
  prompts: string[];
}

interface Command {
  name: string;
  sessions: Session[];
}

interface ClaudeOptions {
  prompt: string;
  tools?: string;
  resumeSessionId?: string;
  systemPrompt?: string;
  captureOutput?: boolean;
}

interface DistillOptions {
  noInteractive: boolean;
  customEditor?: string;
  refineOnly: boolean;
}

const Colors = {
  RED: '\x1b[0;31m',
  GREEN: '\x1b[0;32m',
  YELLOW: '\x1b[1;33m',
  BLUE: '\x1b[0;34m',
  NC: '\x1b[0m'  // No Color
} as const;

// ============================================================================
// PROMPTS
// ============================================================================

const COALESCE_COMMAND: Command = {
  name: 'coalesce',
  sessions: [
    {
      prompts: [
        `You are processing remembered knowledge. Execute this MANDATORY checklist:

1. **MUST READ** .claude/knowledge/session.md - Even if empty
2. **MUST PROCESS** each entry from session.md:
   - Determine category (architecture/patterns/dependencies/workflows/gotchas/etc)
   - **MUST CREATE OR UPDATE** appropriate file in .claude/knowledge/{category}/
   - Keep dated entries only for gotchas
3. **MUST UPDATE OR CREATE** BOTH knowledge maps:
   - **KNOWLEDGE_MAP.md** (user-facing): Use markdown links like [Topic Name](path/file.md)
   - **KNOWLEDGE_MAP_CLAUDE.md** (Claude-facing): Use RELATIVE @ references like @patterns/file.md or @gotchas/file.md (NOT full paths)
   - Both maps should have identical structure, just different link formats
   - Include last updated timestamps in user-facing map only
4. **MUST CLEAR** session.md after processing - use Write tool with empty content

**VERIFICATION CHECKLIST - ALL MUST BE TRUE:**
- [ ] Read session.md (even if empty)
- [ ] Created/updated .claude/knowledge/ category files for any new knowledge
- [ ] Created/updated BOTH KNOWLEDGE_MAP.md (markdown links) and KNOWLEDGE_MAP_CLAUDE.md (@ references)
- [ ] Verified no knowledge was lost in the transfer
- [ ] Cleared session.md by writing empty content to it

**IF YOU SKIP ANY STEP, YOU HAVE FAILED THE TASK**

IMPORTANT: CLAUDE.md uses @ references to .claude/knowledge/INSTRUCTIONS.md and .claude/knowledge/KNOWLEDGE_MAP_CLAUDE.md
IMPORTANT: KNOWLEDGE_MAP_CLAUDE.md uses RELATIVE @ references (e.g., @patterns/file.md NOT @.claude/knowledge/patterns/file.md)

Documentation structure to create and maintain:
.claude/knowledge/
|-- session.md           # Current session's raw captures (you must clear this)
|-- INSTRUCTIONS.md     # Knowledge remembering instructions (referenced by CLAUDE.md)
|-- architecture/        # System design, component relationships
|-- patterns/           # Coding patterns, conventions
|-- dependencies/       # External services, libraries
|-- workflows/          # How to do things in this project
|-- gotchas/           # Surprises, non-obvious behaviors
|-- KNOWLEDGE_MAP.md        # User-facing index with markdown links
|-- KNOWLEDGE_MAP_CLAUDE.md # Claude-facing index with RELATIVE @ references

After completing all updates, inform the user that documentation has been updated.`
      ]
    }
  ]
};

const DISTILL_COMMAND: Command = {
  name: 'distill',
  sessions: [
    // Generate session (3 prompts)
    {
      prompts: [
        // Phase 1: Launch inquisitor agents
        `Launch parallel inquisitor agents to research each knowledge entry.

Your task:
1. Read ALL *.md files in .claude/knowledge/ EXCEPT session.md
2. For EACH substantive knowledge entry found, launch an inquisitor agent
3. Each inquisitor researches ONE specific entry to verify it against the codebase
4. Collect all their research findings

The inquisitor agents will return structured reports with:
- What I Found (current state)
- Changes Detected (recent modifications)
- Related Knowledge (similar entries)
- Observations (discrepancies/issues)

Launch as many inquisitor agents as needed to thoroughly verify the knowledge base.
Aim for comprehensive coverage of all knowledge entries.`,

        // Phase 2: Process findings
        `Process all inquisitor findings and create distill-report.md.

Based on the research from all inquisitor agents:

1. **ANALYZE ALL FINDINGS**:
   - Synthesize research from all inquisitors
   - Identify exact duplicates, near-duplicates, conflicts, outdated info, junk
   - Categorize: AUTO_FIX (clear issues) vs REQUIRES_REVIEW (ambiguous)

2. **AUTO-FIX CLEAR ISSUES**:
   - Remove exact duplicate sections
   - Delete junk/useless information
   - Fix broken references
   - Consolidate redundant information
   - Track all changes made

3. **GENERATE ./distill-report.md** with:
   ## Automated Changes
   [List all auto-fixes made with file names and descriptions]

   ## Requires Review
   [List conflicts needing human guidance]

   For each review item:
   - **Issue**: Clear description
   - **Location**: File path(s)
   - **Current State**: What exists now
   - **Options**: Suggested resolutions

   <!-- USER INPUT START -->
   [Your decisions here]
   <!-- USER INPUT END -->

4. **CRITICAL VERIFICATION**: Double-check that EVERY review item has both:
   - <!-- USER INPUT START --> delimiter before the input area
   - <!-- USER INPUT END --> delimiter after the input area
   - These delimiters MUST be present for EACH individual review item

5. Save to ./distill-report.md (repository root)
6. DO NOT commit changes`,

        // Phase 3: Edge case review
        `think hard

Review your synthesis and distill-report.md:

1. **EDGE CASE REVIEW**:
   - Check for circular duplicates (A->B->C->A)
   - Identify partial overlaps with unique info
   - Consider context-dependent accuracy
   - Look for recently deleted code references
   - Flag ambiguous references

2. **VALIDATION**:
   - Ensure no valuable knowledge is accidentally deleted
   - Verify auto-fixes are truly safe
   - Double-check categorization (auto-fix vs review)
   - Confirm all inquisitor findings were addressed

3. **USER INPUT DELIMITER VERIFICATION**:
   - CRITICAL: Verify EACH review item has <!-- USER INPUT START --> and <!-- USER INPUT END --> delimiters
   - Each review item MUST have its own pair of delimiters
   - No review item should be missing these delimiters
   - Fix any missing delimiters immediately

4. **REFINEMENT**:
   - Adjust recommendations if needed
   - Add any missed issues
   - Improve clarity of review items
   - Update distill-report.md with any changes

Take your time to think through edge cases and ensure the report is thorough and accurate.`
      ]
    },
    // Refine session (1 prompt)
    {
      prompts: [
        `Execute this MANDATORY refinement process:

1. **READ DISTILL REPORT FROM ./distill-report.md**:
   - Read ./distill-report.md (repository root) completely
   - Check if there are any <!-- USER INPUT START --> ... <!-- USER INPUT END --> blocks
   - If present, parse the user's decisions/instructions from between these tags

2. **APPLY USER DECISIONS TO KNOWLEDGE FILES (if any)**:
   - If user input blocks exist, apply the requested changes to the appropriate files
   - Knowledge files are in .claude/knowledge/ (various topic .md files)
   - Special files: KNOWLEDGE_MAP.md (user index) and KNOWLEDGE_MAP_CLAUDE.md (Claude index)
   - DO NOT DELETE either KNOWLEDGE_MAP, we want both the markdown-link and claude-reference versions
   - Make precise edits based on user instructions
   - If changes affect the knowledge maps, update both consistently

3. **DELETE THE REPORT**:
   - After successfully applying any refinements (or if only auto-fixes), delete ./distill-report.md
   - This indicates the refinement session is complete

4. **VERIFICATION**:
   - If user decisions were applied, ensure all changes were applied correctly
   - Verify consistency between KNOWLEDGE_MAP.md and KNOWLEDGE_MAP_CLAUDE.md if modified
   - Report completion status and list of files modified (if any)

IMPORTANT: The report is at ./distill-report.md (repository root). If there are no user input blocks, just delete the report to mark completion (changes were already made during distill).`
      ]
    }
  ]
};

// System prompts for different commands/phases
const SYSTEM_PROMPTS = {
  coalesce: "You are Mím's knowledge processor. Your role is to organize raw captured knowledge into structured documentation. You must process every entry, categorize it appropriately, update knowledge maps, and ensure no knowledge is lost.",

  distillPhase1: "You are Mím's distillation orchestrator, Phase 1: Knowledge Verification. You coordinate multiple inquisitor agents to research and verify each knowledge entry against the current codebase. Launch agents systematically to ensure comprehensive coverage.",

  distillPhase2: "You are Mím's distillation synthesizer, Phase 2: Finding Analysis. You process all inquisitor research to identify duplicates, conflicts, and outdated information. You must create a clear distill-report.md with proper USER INPUT delimiters for each review item.",

  distillPhase3: "You are Mím's distillation validator, Phase 3: Quality Assurance. You perform edge case analysis and validation of the distill report. Ensure all USER INPUT delimiters are present, no valuable knowledge is lost, and all recommendations are accurate.",

  refine: "You are Mím's refinement executor. Your role is to apply user decisions from the distill report to the knowledge base. Parse user input sections carefully, apply changes precisely, and clean up the report when complete."
};

// ============================================================================
// CLAUDE CLI WRAPPER
// ============================================================================

const ALLOWED_TOOLS = 'Read,Write,Edit,MultiEdit,Glob,Grep,LS,Bash,Git';
const ALLOWED_TOOLS_WITH_TASK = `${ALLOWED_TOOLS},Task`;

/**
 * Stream and process claude output from JSON-RPC format
 */
function streamClaudeOutput(line: string): void {
  // Extract content from stream-json format
  if (line.includes('"type":"text"')) {
    // Extract text content between "text":" and next "
    const match = line.match(/"text":"([^"]*)"/);
    if (match && match[1]) {
      console.log(match[1]);
    }
  } else {
    console.log(line);
  }
}

/**
 * Extract session ID from claude output
 */
function extractSessionId(output: string): string | null {
  const match = output.match(/Session ID: ([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return null;
}

/**
 * Run claude CLI with given options
 */
async function runClaude(options: ClaudeOptions): Promise<{
  success: boolean;
  sessionId?: string;
  tempFile?: string;
}> {
  const {
    prompt,
    tools = ALLOWED_TOOLS,
    resumeSessionId,
    systemPrompt,
    captureOutput = false
  } = options;

  // Build command args
  const args: string[] = [];

  // Add resume flag if provided
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }

  // Add verbose and tools
  args.push('--verbose');
  args.push('--allowedTools', tools);

  // Add system prompt if provided
  if (systemPrompt) {
    args.push('--append-system-prompt', systemPrompt);
  }

  // Add print and output format
  args.push('--print');
  args.push('--output-format', 'stream-json');
  args.push(prompt);

  return new Promise((resolve) => {
    let tempFile: string | undefined;
    let sessionId: string | undefined;
    let fullOutput = '';

    // Create temp file for capture if needed
    if (captureOutput) {
      const tempDir = mkdtempSync(join(tmpdir(), 'mim-'));
      tempFile = join(tempDir, 'output.txt');
    }

    const writeStream = tempFile ? createWriteStream(tempFile) : null;
    const child = spawn('claude', args, {
      shell: false,
      stdio: ['inherit', 'pipe', 'pipe']
    });

    // Process stdout
    const rl = createInterface({
      input: child.stdout,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      if (captureOutput) {
        fullOutput += line + '\n';
        if (writeStream) {
          writeStream.write(line + '\n');
        }
      }
      streamClaudeOutput(line);
    });

    // Process stderr
    child.stderr.on('data', (data) => {
      const text = data.toString();
      if (captureOutput) {
        fullOutput += text;
        if (writeStream) {
          writeStream.write(text);
        }
      }
      process.stderr.write(data);
    });

    child.on('close', (code) => {
      if (writeStream) {
        writeStream.end();
      }

      // Extract session ID if we captured output
      if (captureOutput && fullOutput) {
        const extractedId = extractSessionId(fullOutput);
        if (extractedId) {
          sessionId = extractedId;
        }
      }

      resolve({
        success: code === 0,
        sessionId,
        tempFile
      });
    });

    child.on('error', (err) => {
      console.error(`${Colors.RED}Failed to start claude: ${err.message}${Colors.NC}`);
      resolve({ success: false });
    });
  });
}

/**
 * Ensure the inquisitor agent exists
 */
function ensureInquisitorAgent(): boolean {
  const fs = require('fs');
  const path = require('path');

  const agentPath = path.join(process.cwd(), '.claude', 'agents', 'inquisitor.md');
  if (!fs.existsSync(agentPath)) {
    console.warn(`${Colors.YELLOW}⚠️  Inquisitor agent not found at ${agentPath}${Colors.NC}`);
    console.warn('   Please ensure Mim is properly installed');
    return false;
  }
  return true;
}

// ============================================================================
// COMMANDS
// ============================================================================

/**
 * Coalesce command - Process session.md into organized documentation
 */
async function coalesce(): Promise<void> {
  console.log('🔄 Running mim coalesce...');
  console.log('Processing remembered knowledge from session.md...');
  console.log('');

  // Get the single session with single prompt for coalesce
  const session = COALESCE_COMMAND.sessions[0];
  const prompt = session.prompts[0];

  const result = await runClaude({
    prompt,
    systemPrompt: SYSTEM_PROMPTS.coalesce
  });

  if (result.success) {
    console.log('');
    console.log('✨ Coalesce complete!');
    console.log('');
    console.log('📚 Knowledge processed and organized');
    console.log('📍 Check .claude/knowledge/ for updated documentation');
  } else {
    console.error(`${Colors.RED}❌ Coalesce failed${Colors.NC}`);
    process.exit(1);
  }
}

/**
 * Run the distill generate phase (3 prompts in sequence)
 */
async function distillGenerate(): Promise<boolean> {
  // Ensure inquisitor agent exists
  if (!ensureInquisitorAgent()) {
    return false;
  }

  // Get the generate session (first session with 3 prompts)
  const generateSession = DISTILL_COMMAND.sessions[0];
  let sessionId: string | undefined;

  // Phase 1: Launch inquisitor agents
  console.log('🔍 Phase 1: Launching inquisitor agents...');
  const phase1Result = await runClaude({
    prompt: generateSession.prompts[0],
    tools: ALLOWED_TOOLS_WITH_TASK,
    systemPrompt: SYSTEM_PROMPTS.distillPhase1,
    captureOutput: true
  });

  if (!phase1Result.success) {
    console.error(`${Colors.RED}❌ Phase 1 failed${Colors.NC}`);
    return false;
  }

  // Extract session ID for resuming
  if (phase1Result.sessionId) {
    sessionId = phase1Result.sessionId;
  }

  // Clean up temp file
  if (phase1Result.tempFile) {
    try {
      unlinkSync(phase1Result.tempFile);
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  // Phase 2: Process findings
  console.log('');
  console.log('🔄 Phase 2: Processing findings...');
  const phase2Result = await runClaude({
    prompt: generateSession.prompts[1],
    tools: ALLOWED_TOOLS,
    resumeSessionId: sessionId,
    systemPrompt: SYSTEM_PROMPTS.distillPhase2
  });

  if (!phase2Result.success) {
    console.error(`${Colors.RED}❌ Phase 2 failed${Colors.NC}`);
    return false;
  }

  // Phase 3: Edge case review
  console.log('');
  console.log('🔄 Phase 3: Edge case review...');
  const phase3Result = await runClaude({
    prompt: generateSession.prompts[2],
    tools: ALLOWED_TOOLS,
    resumeSessionId: sessionId,
    systemPrompt: SYSTEM_PROMPTS.distillPhase3
  });

  if (!phase3Result.success) {
    console.error(`${Colors.RED}❌ Phase 3 failed${Colors.NC}`);
    return false;
  }

  console.log('');
  console.log('✨ Distillation complete!');

  if (existsSync('./distill-report.md')) {
    console.log('');
    console.log('📋 Distill report generated at ./distill-report.md');

    // Check if there are review items
    const report = readFileSync('./distill-report.md', 'utf-8');
    if (report.includes('## Requires Review')) {
      return true; // Success with review needed
    } else {
      console.log('   ✓ Only automatic fixes found, no manual review needed');
      return true;
    }
  }

  return true;
}

/**
 * Run the distill refine phase
 */
async function distillRefine(): Promise<void> {
  if (!existsSync('./distill-report.md')) {
    console.warn(`${Colors.YELLOW}⚠️  No distill report found at ./distill-report.md${Colors.NC}`);
    console.warn('   Run \'mim distill\' first to generate a report');
    return;
  }

  console.log('📋 Applying refinements from distill-report.md...');
  console.log('');

  // Get the refine session (second session with 1 prompt)
  const refineSession = DISTILL_COMMAND.sessions[1];
  const prompt = refineSession.prompts[0];

  const result = await runClaude({
    prompt,
    systemPrompt: SYSTEM_PROMPTS.refine
  });

  if (result.success) {
    console.log('');
    console.log('✨ Refinement complete!');
    console.log('');

    // Check if report still exists (it should be deleted after successful refine)
    if (existsSync('./distill-report.md')) {
      console.warn(`${Colors.YELLOW}⚠️  Note: distill-report.md still exists${Colors.NC}`);
      console.warn('   This might indicate the refinement was incomplete');
    } else {
      console.log('✓ All refinements applied successfully');
      console.log('✓ Distill report cleaned up');
    }
  } else {
    console.error(`${Colors.RED}❌ Refinement failed${Colors.NC}`);
    console.error('   Check distill-report.md and try again');
    process.exit(1);
  }
}

/**
 * Main distill command
 */
async function distill(options: DistillOptions): Promise<void> {
  console.log('🧹 Running mim distill...');
  console.log('🔍 Scanning documentation for duplicates, conflicts, junk, and outdated information...');
  console.log('');
  console.log('   [This may take several minutes to analyze all documentation]');
  console.log('');

  const { noInteractive, customEditor, refineOnly } = options;

  // Determine which editor to use
  const editorCmd = customEditor || process.env.EDITOR || 'nano';

  // If --refine-only, skip directly to refine step
  if (refineOnly) {
    if (!existsSync('./distill-report.md')) {
      console.warn(`${Colors.YELLOW}⚠️  No distill-report.md found. Run 'mim distill' first.${Colors.NC}`);
      process.exit(1);
    }
    console.log('📋 Found existing distill-report.md');
    console.log('🔄 Applying refinements...');
    await distillRefine();
    return;
  }

  // Run the full distill workflow
  const generateSuccess = await distillGenerate();
  if (!generateSuccess) {
    process.exit(1);
  }

  // Handle post-generation based on mode
  if (noInteractive) {
    // Non-interactive mode
    console.log('');
    console.log(`${Colors.YELLOW}📋 Review required before applying changes${Colors.NC}`);
    console.log('');
    console.log('Next steps:');
    console.log(`  1. Review and edit: ${Colors.BLUE}${editorCmd} ./distill-report.md${Colors.NC}`);
    console.log('  2. Add your decisions in the <!-- USER INPUT --> sections');
    console.log(`  3. Apply changes: ${Colors.BLUE}mim distill --refine-only${Colors.NC}`);
    console.log('');
    console.log(`Or use interactive mode: ${Colors.BLUE}mim distill${Colors.NC} (opens editor automatically)`);
  } else {
    // Interactive mode - open editor if review needed
    if (existsSync('./distill-report.md')) {
      const report = readFileSync('./distill-report.md', 'utf-8');
      if (report.includes('## Requires Review')) {
        await new Promise<void>((resolve) => {
          console.log('');
          console.log('📝 Opening distill-report.md for your review...');
          console.log('   Please add your decisions in the <!-- USER INPUT --> sections');
          console.log('');

          const child = spawn(editorCmd, ['./distill-report.md'], {
            stdio: 'inherit',
            shell: true
          });

          child.on('close', () => {
            resolve();
          });

          child.on('error', (err) => {
            console.error(`${Colors.RED}Failed to open editor: ${err.message}${Colors.NC}`);
            resolve();
          });
        });

        console.log('');
        console.log('🔄 Applying your refinements...');
        await distillRefine();
      } else {
        // No review needed, just auto-fixes
        console.log('');
        console.log('✨ No manual review needed - only automatic fixes were found');
        console.log('🔄 Applying automatic fixes...');
        await distillRefine();
      }
    } else {
      console.log('');
      console.log('✨ Distillation complete! No issues found.');
    }
  }
}

/**
 * Display help message
 */
function showHelp(): void {
  console.log(`Mím - Persistent Memory for Claude Code

Usage: mim <command> [options]

Commands:
  coalesce    Process session.md into organized documentation
  distill     Clean duplicates, conflicts, and outdated information
              Options:
                --no-interactive, -n   Manual two-step process (no auto-editor)
                --editor <cmd>         Override $EDITOR for this session
                --refine-only         Skip to applying existing distill report
  help        Show this help message

Examples:
  mim coalesce              # Process remembered knowledge
  mim distill               # Interactive cleanup (auto-opens editor)
  mim distill -n            # Non-interactive (manual review)
  mim distill --refine-only # Apply existing distill-report.md

Learn more: https://github.com/lucianHymer/mim`);
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Parse distill command options
 */
function parseDistillOptions(args: string[]): DistillOptions {
  const options: DistillOptions = {
    noInteractive: false,
    refineOnly: false
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case '--no-interactive':
      case '-n':
        options.noInteractive = true;
        i++;
        break;
      case '--editor':
        options.customEditor = args[i + 1];
        if (!options.customEditor) {
          console.error(`${Colors.RED}--editor requires a value${Colors.NC}`);
          console.error('Usage: mim distill [--no-interactive|-n] [--editor <command>] [--refine-only]');
          process.exit(1);
        }
        i += 2;
        break;
      case '--refine-only':
        options.refineOnly = true;
        i++;
        break;
      default:
        console.error(`${Colors.RED}Unknown option: ${arg}${Colors.NC}`);
        console.error('Usage: mim distill [--no-interactive|-n] [--editor <command>] [--refine-only]');
        process.exit(1);
    }
  }

  return options;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'coalesce':
      await coalesce();
      break;

    case 'distill':
      const distillOptions = parseDistillOptions(args.slice(1));
      await distill(distillOptions);
      break;

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      showHelp();
      break;

    default:
      console.error(`${Colors.RED}Unknown command: ${command}${Colors.NC}`);
      console.error('');
      showHelp();
      process.exit(1);
  }
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (err) => {
  console.error(`${Colors.RED}Uncaught error: ${err.message}${Colors.NC}`);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error(`${Colors.RED}Unhandled rejection: ${err}${Colors.NC}`);
  process.exit(1);
});

// Run main
main().catch((err) => {
  console.error(`${Colors.RED}Fatal error: ${err.message}${Colors.NC}`);
  process.exit(1);
});